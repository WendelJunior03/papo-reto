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
 */
import { z } from "zod";
import {
  clearCookie, createSession, destroySession, hashPassword, LOCK_MINUTES, MAX_FAILED,
  sessionCookie, userFromRequest, verifyPassword,
} from "./auth";
import { handleChat } from "./chat";
import type { Db } from "./db";

export interface ApiConfig {
  db: Db;
  /** Código de convite para criar conta. Sem ele, o cadastro fica fechado. */
  signupCode?: string;
  anthropicKey?: string;
  /** Mensagens pra IA por usuário por dia (padrão 60). */
  aiDailyLimit?: number;
}

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
      return json({ username: user.username });

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

    case "POST /api/chat": {
      const day = new Date().toISOString().slice(0, 10);
      await db.run(
        "INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1",
        user.id,
        day,
      );
      const used = await db.first<{ count: number }>("SELECT count FROM ai_usage WHERE user_id = ? AND day = ?", user.id, day);
      if ((used?.count ?? 0) > (cfg.aiDailyLimit ?? 60)) {
        return json({ error: "Você chegou no limite de conversas com a IA hoje. Amanhã libera de novo." }, 429);
      }
      return handleChat(req, cfg.anthropicKey);
    }
  }

  return json({ error: "Rota não encontrada." }, 404);
}
