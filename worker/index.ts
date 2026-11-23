/**
 * Cloudflare Worker para publicar: serve o dist/ (assets estáticos) e as rotas /api/*.
 * Segredos: `bunx wrangler secret put ANTHROPIC_API_KEY` e `bunx wrangler secret put SIGNUP_CODE`.
 * Banco: D1 (`bunx wrangler d1 create papo-reto` e `bunx wrangler d1 migrations apply papo-reto --remote`).
 */
import { handleApi, type ApiConfig } from "../server/api";
import { sendDuePushes } from "../server/push";
import { d1Db, type D1Database } from "../server/db";

interface Env {
  DB: D1Database;
  GEMINI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  SIGNUP_CODE?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  PIX_KEY?: string;
  PIX_NAME?: string;
  PIX_CITY?: string;
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

function config(env: Env): ApiConfig {
  return {
    db: d1Db(env.DB),
    signupCode: env.SIGNUP_CODE,
    geminiKey: env.GEMINI_API_KEY,
    anthropicKey: env.ANTHROPIC_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
    pix: env.PIX_KEY ? { key: env.PIX_KEY, name: env.PIX_NAME ?? "", city: env.PIX_CITY ?? "" } : undefined,
    vapid:
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: env.VAPID_PRIVATE_KEY, subject: "https://papo-reto.papo-reto.workers.dev" }
        : undefined,
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname.startsWith("/audio/")) return audio(req, env);
    const res = await handleApi(req, config(env));
    return res ?? env.ASSETS.fetch(req);
  },

  /** Cron (a cada minuto): manda as notificações agendadas, como "sua conversa liberou". */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const cfg = config(env);
    if (cfg.vapid) await sendDuePushes(cfg.db, cfg.vapid);
  },
};
