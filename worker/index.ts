/**
 * Cloudflare Worker para publicar: serve o dist/ (assets estáticos) e as rotas /api/*.
 * Segredos: `bunx wrangler secret put ANTHROPIC_API_KEY` e `bunx wrangler secret put SIGNUP_CODE`.
 * Banco: D1 (`bunx wrangler d1 create papo-reto` e `bunx wrangler d1 migrations apply papo-reto --remote`).
 */
import { handleApi, type ApiConfig, type RoomsHost } from "../server/api";
import { sendDuePushes } from "../server/push";
import { sendDueReminders } from "../server/reminders";
import { d1Db, type D1Database } from "../server/db";
import { parseAdmins } from "../server/admin";
import type { DurableObjectNamespace } from "./room";

// Durable Object das Salas ao vivo (precisa estar exportado na entrada do Worker).
export { Room } from "./room";

interface Env {
  DB: D1Database;
  GEMINI_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  SIGNUP_CODE?: string;
  /** "1" abre o cadastro pra qualquer pessoa (código de convite opcional). */
  OPEN_SIGNUP?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  PIX_KEY?: string;
  PIX_NAME?: string;
  PIX_CITY?: string;
  /** Donos do app, separados por vírgula (veem o painel do dono). */
  ADMIN_USERS?: string;
  /** Salas ao vivo (Durable Object `Room`, um por código). */
  ROOMS?: DurableObjectNamespace;
  ASSETS: { fetch(req: Request): Promise<Response> };
}

/**
 * Os arquivos estáticos do Cloudflare ignoram o cabeçalho Range, e o Safari só toca áudio
 * servido em pedaços (206). Então o áudio passa pelo Worker, que recorta o arquivo.
 */
async function audio(req: Request, env: Env): Promise<Response> {
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  const res = await env.ASSETS.fetch(new Request(req.url, { method: "GET" }));
  if (!res.ok) return res;
  const headers = new Headers(res.headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Type", "audio/mp4");
  headers.set("Cache-Control", "public, max-age=31536000, immutable"); // nome do arquivo = hash do texto
  if (!range) return new Response(res.body, { status: 200, headers });

  const buf = await res.arrayBuffer();
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), buf.byteLength - 1) : buf.byteLength - 1;
  if (start > end || start >= buf.byteLength) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${buf.byteLength}` } });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${buf.byteLength}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(buf.slice(start, end + 1), { status: 206, headers });
}

/** Cada sala é um Durable Object com o nome do código. A API cria e encaminha o WebSocket. */
function roomsHost(ns: DurableObjectNamespace): RoomsHost {
  const stub = (code: string) => ns.get(ns.idFromName(code));
  return {
    async create(init) {
      const res = await stub(init.code).fetch("https://sala/init", { method: "POST", body: JSON.stringify(init) });
      return res.status === 201;
    },
    connect(req, code, user) {
      const headers = new Headers(req.headers);
      // Sempre sobrescrito aqui: quem é a pessoa vem do login, nunca do aparelho.
      headers.set("x-room-user", encodeURIComponent(JSON.stringify({ id: user.id, name: user.username })));
      return stub(code).fetch("https://sala/ws", { headers });
    },
  };
}

/** Endereço do app no ar (convites e assinatura das notificações apontam pra cá, nunca pra prévia). */
const PUBLIC_URL = "https://papo-reto.papo-reto.workers.dev";

function config(env: Env): ApiConfig {
  return {
    db: d1Db(env.DB),
    publicUrl: PUBLIC_URL,
    signupCode: env.SIGNUP_CODE,
    openSignup: env.OPEN_SIGNUP === "1" || env.OPEN_SIGNUP === "true",
    geminiKey: env.GEMINI_API_KEY,
    youtubeKey: env.YOUTUBE_API_KEY,
    anthropicKey: env.ANTHROPIC_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
    adminUsers: parseAdmins(env.ADMIN_USERS),
    rooms: env.ROOMS ? roomsHost(env.ROOMS) : undefined,
    pix: env.PIX_KEY ? { key: env.PIX_KEY, name: env.PIX_NAME ?? "", city: env.PIX_CITY ?? "" } : undefined,
    vapid:
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: env.VAPID_PRIVATE_KEY, subject: PUBLIC_URL }
        : undefined,
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (/^\/audio(-pt)?\//.test(new URL(req.url).pathname)) return audio(req, env);
    const res = await handleApi(req, config(env));
    return res ?? env.ASSETS.fetch(req);
  },

  /** Cron (a cada minuto): manda as notificações agendadas ("sua conversa liberou") e os lembretes diários. */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const cfg = config(env);
    if (!cfg.vapid) return;
    await sendDuePushes(cfg.db, cfg.vapid);
    await sendDueReminders(cfg.db, cfg.vapid);
  },
};
