/**
 * Todas as rotas /api/*. Recebe o banco e a configuração de quem chama
 * (servidor do Bun ou Cloudflare Worker) e devolve null se a rota não for da API.
 *
 *   POST /api/auth/signup   { username, password, code }   cria conta (precisa do código de convite)
 *   POST /api/auth/login    { username, password }
 *   POST /api/auth/logout
 *   GET  /api/me
 *   GET  /api/progress      progresso salvo do usuário
 *   PUT  /api/progress      { data, updatedAt }
 *   POST /api/chat          conversa com IA (só logado)
 *   GET  /api/ai/session    estado da sessão com a IA do app (pronta, em andamento ou em espera)
 *   GET  /api/push/key      chave pública pra inscrever o aparelho nas notificações
 *   POST /api/push/subscribe   { endpoint, keys: { p256dh, auth } }
 *   POST /api/push/unsubscribe { endpoint }
 */
import { z } from "zod";
import {
  clearCookie, createSession, destroySession, hashPassword, LOCK_MINUTES, MAX_FAILED,
  sessionCookie, userFromRequest, verifyPassword,
} from "./auth";
import { handleChat, providerFor, type ChatAuth } from "./chat";
import type { Db } from "./db";
import { schedulePush, type Vapid } from "./push";
import { DEFAULT_SESSION, sessionState, type SessionConfig, type SessionRow } from "./session";

export interface ApiConfig {
  db: Db;
  /** Código de convite para criar conta. Sem ele, o cadastro fica fechado. */
  signupCode?: string;
  /** Chaves do servidor (opcionais). Quem colocar a própria chave no app usa a dela. */
  geminiKey?: string;
  anthropicKey?: string;
  openaiKey?: string;
  /** Sessão com a IA do app (padrão: 7 min de conversa, 1 h de espera, 40 mensagens). */
  session?: Partial<SessionConfig>;
  /** Chaves das notificações; sem elas o app não oferece aviso. */
  vapid?: Vapid;
  /** PIX pra doações (chave, nome e cidade do recebedor). Sem chave, o app não mostra o apoio. */
  pix?: { key: string; name: string; city: string };
}

const serverAuthOf = (cfg: ApiConfig): ChatAuth | null =>
  cfg.geminiKey ? { provider: "gemini", key: cfg.geminiKey }
  : cfg.anthropicKey ? { provider: "anthropic", key: cfg.anthropicKey }
  : cfg.openaiKey ? { provider: "openai", key: cfg.openaiKey }
  : null;

const PushSub = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "Endpoint inválido."),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

const MAX_BODY_BYTES = 400_000;

/** Nome, apelido ou e-mail: aceita acentos e espaços (espaços repetidos viram um só). */
const Username = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(3, "O usuário precisa de pelo menos 3 caracteres.")
      .max(40, "O usuário pode ter no máximo 40 caracteres.")
      .regex(/^[\p{L}\p{N}][\p{L}\p{N} ._@+'-]*$/u, "O usuário pode ter letras, números, espaço e . _ - @"),
  );
const Password = z.string().min(8, "A senha precisa de pelo menos 8 caracteres.").max(128);

const Signup = z.object({ username: Username, password: Password, code: z.string().max(100) });
const Login = z.object({
  username: z.string().transform((s) => s.trim().replace(/\s+/g, " ")).pipe(z.string().min(1).max(40)),
  password: z.string().min(1).max(128),
});
const ProgressBody = z.object({ data: z.record(z.string(), z.unknown()), updatedAt: z.string().max(40) });
const MAX_PROGRESS_BYTES = 300_000;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });

async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
}

/** Mesmo código do convite comparado em tempo constante. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface UserRow {
  id: number;
  username: string;
  pass_hash: string;
  pass_salt: string;
  failed_logins: number;
  locked_until: number;
}

export async function handleApi(req: Request, cfg: ApiConfig): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith("/api/")) return null;
  const route = `${req.method} ${pathname}`;
  const { db } = cfg;

  if (req.method !== "GET") {
    // Outro site não pode disparar ações aqui usando o cookie de quem está logado (CSRF).
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) return json({ error: "Origem não permitida." }, 403);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "Pedido grande demais." }, 413);
  }

  switch (route) {
    case "POST /api/auth/signup": {
      const b = await body(req, Signup);
      if (b instanceof Response) return b;
      if (!cfg.signupCode) return json({ error: "O cadastro está fechado. Peça uma conta pra quem administra o app." }, 403);
      if (!sameText(b.code.trim(), cfg.signupCode)) return json({ error: "Código de convite incorreto." }, 403);
      const exists = await db.first("SELECT 1 FROM users WHERE username = ?", b.username);
      if (exists) return json({ error: "Esse usuário já existe. Escolha outro." }, 409);
      const { hash, salt } = await hashPassword(b.password);
      await db.run("INSERT INTO users (username, pass_hash, pass_salt) VALUES (?, ?, ?)", b.username, hash, salt);
      const user = (await db.first<{ id: number }>("SELECT id FROM users WHERE username = ?", b.username))!;
      const s = await createSession(db, user.id);
      return json({ username: b.username }, 201, { "Set-Cookie": sessionCookie(req, s.token, s.expires) });
    }

    case "POST /api/auth/login": {
      const b = await body(req, Login);
      if (b instanceof Response) return b;
      const now = Date.now();
      const user = await db.first<UserRow>(
        "SELECT id, username, pass_hash, pass_salt, failed_logins, locked_until FROM users WHERE username = ?",
        b.username,
      );
      if (user && user.locked_until > now) {
        const min = Math.ceil((user.locked_until - now) / 60_000);
        return json({ error: `Muitas tentativas. Tente de novo em ${min} min.` }, 429);
      }
      const ok = user ? await verifyPassword(b.password, user.pass_hash, user.pass_salt) : await hashPassword(b.password).then(() => false);
      if (!user || !ok) {
        if (user) {
          const failed = user.failed_logins + 1;
          const lock = failed >= MAX_FAILED ? now + LOCK_MINUTES * 60_000 : 0;
          await db.run("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?", lock ? 0 : failed, lock, user.id);
        }
        return json({ error: "Usuário ou senha incorretos." }, 401);
      }
      await db.run("UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?", user.id);
      const s = await createSession(db, user.id, now);
      return json({ username: user.username }, 200, { "Set-Cookie": sessionCookie(req, s.token, s.expires) });
    }

    case "POST /api/auth/logout":
      await destroySession(db, req);
      return json({ ok: true }, 200, { "Set-Cookie": clearCookie });
  }

  // Daqui pra baixo, só logado.
  const user = await userFromRequest(db, req);
  if (!user) return json({ error: "Faça login pra continuar." }, 401);

  switch (route) {
    case "GET /api/me":
      return json({
        username: user.username,
        serverAi: !!serverAuthOf(cfg),
        push: !!cfg.vapid,
        pix: cfg.pix?.key ? cfg.pix : null,
      });

    case "GET /api/progress": {
      const row = await db.first<{ progress: string | null; progress_at: string | null }>(
        "SELECT progress, progress_at FROM users WHERE id = ?",
        user.id,
      );
      return json({ data: row?.progress ? JSON.parse(row.progress) : null, updatedAt: row?.progress_at ?? null });
    }

    case "PUT /api/progress": {
      const b = await body(req, ProgressBody);
      if (b instanceof Response) return b;
      const text = JSON.stringify(b.data);
      if (text.length > MAX_PROGRESS_BYTES) return json({ error: "Progresso grande demais." }, 413);
      await db.run("UPDATE users SET progress = ?, progress_at = ? WHERE id = ?", text, b.updatedAt, user.id);
      return json({ ok: true });
    }

    case "GET /api/ai/session": {
      const row = await db.first<SessionRow>("SELECT started_at, ends_at, messages FROM ai_sessions WHERE user_id = ?", user.id);
      return json(sessionState(row, Date.now(), { ...DEFAULT_SESSION, ...cfg.session }));
    }

    case "POST /api/chat": {
      // Chave do próprio usuário: vem do aparelho dele a cada pedido e não é guardada nem registrada. Sem limite de sessão.
      const userKey = req.headers.get("x-ai-key")?.trim();
      const model = req.headers.get("x-ai-model")?.trim().slice(0, 60) || undefined;
      if (userKey) {
        const provider = providerFor(userKey);
        if (!provider) return json({ error: "Chave não reconhecida. Use uma chave do Google (Gemini), da OpenAI (sk-...) ou da Anthropic (sk-ant-...)." }, 400);
        if (model && !/^[a-zA-Z0-9._:-]+$/.test(model)) return json({ error: "Nome de modelo inválido." }, 400);
        return handleChat(req, { provider, key: userKey, model });
      }

      const serverAuth = serverAuthOf(cfg);
      if (!serverAuth) return json({ error: "Adicione sua chave de IA pra conversar.", needsKey: true }, 403);

      // IA do app: sessões de X minutos com espera entre elas.
      const sc = { ...DEFAULT_SESSION, ...cfg.session };
      const now = Date.now();
      const row = await db.first<SessionRow>("SELECT started_at, ends_at, messages FROM ai_sessions WHERE user_id = ?", user.id);
      let st = sessionState(row, now, sc, true);
      if (st.state === "cooldown") {
        return json({ error: "Sua sessão de conversa acabou. A próxima libera em breve.", session: st }, 429);
      }
      if (st.state === "active" && st.messagesLeft <= 0) {
        return json({ error: "Você usou todas as mensagens desta sessão.", session: st }, 429);
      }
      const startNew = st.state === "ready";
      // A sessão só começa (e a mensagem só conta) se a IA responder de verdade.
      return handleChat(req, serverAuth, async () => {
        if (startNew) {
          const endsAt = now + sc.minutes * 60_000;
          await db.run(
            "INSERT INTO ai_sessions (user_id, started_at, ends_at, messages) VALUES (?, ?, ?, 1) ON CONFLICT(user_id) DO UPDATE SET started_at = excluded.started_at, ends_at = excluded.ends_at, messages = 1",
            user.id,
            now,
            endsAt,
          );
          // Avisa quando a próxima sessão liberar (se o aparelho aceitou notificações).
          await schedulePush(db, user.id, "ai-ready", endsAt + sc.cooldownMinutes * 60_000);
        } else {
          await db.run("UPDATE ai_sessions SET messages = messages + 1 WHERE user_id = ?", user.id);
        }
        const row2 = await db.first<SessionRow>("SELECT started_at, ends_at, messages FROM ai_sessions WHERE user_id = ?", user.id);
        return { session: sessionState(row2, now, sc) };
      });
    }

    case "GET /api/push/key":
      return cfg.vapid ? json({ publicKey: cfg.vapid.publicKey }) : json({ error: "Notificações não configuradas." }, 404);

    case "POST /api/push/subscribe": {
      if (!cfg.vapid) return json({ error: "Notificações não configuradas." }, 404);
      const b = await body(req, PushSub);
      if (b instanceof Response) return b;
      await db.run(
        "INSERT INTO push_subs (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth",
        b.endpoint,
        user.id,
        b.keys.p256dh,
        b.keys.auth,
      );
      return json({ ok: true });
    }

    case "POST /api/push/unsubscribe": {
      const b = await body(req, z.object({ endpoint: z.string().max(1000) }));
      if (b instanceof Response) return b;
      await db.run("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?", b.endpoint, user.id);
      return json({ ok: true });
    }
  }

  return json({ error: "Rota não encontrada." }, 404);
}
