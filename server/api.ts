/**
 * Todas as rotas /api/*. Recebe o banco e a configuração de quem chama
 * (servidor do Bun ou Cloudflare Worker) e devolve null se a rota não for da API.
 *
 *   POST /api/auth/signup   { username, password, code }   cria conta (código geral ou convite pessoal de um amigo)
 *   POST /api/auth/login    { username, password }
 *   POST /api/auth/logout
 *   GET  /api/me
 *   GET  /api/invite        convite pessoal { code, link, friends, badges, badge } (o código nasce no 1º pedido)
 *   POST /api/badge         { badge }   coloca um selo conquistado (null tira)
 *   GET  /api/progress      progresso salvo do usuário
 *   PUT  /api/progress      { data, updatedAt }
 *   POST /api/chat          conversa com IA (só logado)
 *   GET  /api/ai/session    estado da sessão com a IA do app (pronta, em andamento ou em espera)
 *   POST /api/story         { phrases }   historinha com frases que a pessoa já sabe (limite diário com a IA do app)
 *   GET  /api/push/key      chave pública pra inscrever o aparelho nas notificações
 *   POST /api/push/subscribe   { endpoint, keys: { p256dh, auth } }
 *   POST /api/push/unsubscribe { endpoint }
 *   GET  /api/push/latest   texto da última notificação (o service worker busca quando o push chega)
 *   GET  /api/reminder      lembrete diário { time, tz, enabled } ou null
 *   PUT  /api/reminder      { time: "HH:MM", tz: "America/Sao_Paulo", enabled }
 *   GET  /api/music/search?q=   vídeos do YouTube (precisa da chave do YouTube no servidor)
 *   GET  /api/music/video?url=  dados de um link do YouTube colado (sem chave)
 *   GET  /api/music/lyrics?q=&duration=  ou  ?id=   letra sincronizada (LRCLIB)
 *   GET  /api/admin/stats   números do app (só dono, ADMIN_USERS)
 *   GET  /api/admin/users   lista de usuários (só dono)
 *   POST /api/admin/reset-password { username }   senha temporária, mostrada uma vez (só dono)
 *   POST /api/rooms         { size: 2|4, level }   cria uma Sala ao vivo e devolve o código
 *   GET  /api/rooms/:code/ws   WebSocket da sala (o login é conferido aqui, antes de chegar na sala)
 */
import { z } from "zod";
import {
  clearCookie, createSession, destroySession, hashPassword, LOCK_MINUTES, MAX_FAILED,
  sessionCookie, userFromRequest, verifyPassword, type SessionUser,
} from "./auth";
import { adminStats, adminUsers, countAiMessage, isAdmin, resetPassword, touchSeen } from "./admin";
import { handleChat, providerFor, type ChatAuth } from "./chat";
import { badgeState, equipBadge, inviteInfo, inviterByCode, recordInvitedBy } from "./invites";
import { BADGES, type BadgeId } from "../src/lib/invites";
import type { Db } from "./db";
import { latestOutbox, schedulePush, type Vapid } from "./push";
import { HHMM, validTimeZone } from "./reminders";
import { findLyrics, lyricsById, MusicError, searchVideos, videoIdFrom, videoInfo } from "./music";
import { DEFAULT_SESSION, sessionState, type SessionConfig, type SessionRow } from "./session";
import { countStory, DEFAULT_STORIES_PER_DAY, handleStory, storiesToday } from "./story";
import { geoOf, saveGeo } from "./geo";
import { checkSignup, DEFAULT_SIGNUP_LIMITS, networkKey, signupDone, type SignupLimits } from "./signup-guard";
import { CODE_RE, newRoomCode, RoomCreate, type RoomInit } from "./room-core";

/**
 * Onde as Salas ao vivo moram: Durable Object no Cloudflare, memória no `bun dev`/`bun preview`.
 * A API só cria e confere o login; o resto (palavra, avisos, tempo) é com a sala.
 */
export interface RoomsHost {
  /** false = o código já existia (a API sorteia outro). */
  create(init: RoomInit): Promise<boolean>;
  /** Abre o WebSocket da sala pra quem já está logado. */
  connect(req: Request, code: string, user: SessionUser): Promise<Response>;
}

export interface ApiConfig {
  db: Db;
  /**
   * Código de convite geral para criar conta. Sem ele, o cadastro fica fechado
   * (inclusive pelos convites pessoais: é o jeito de fechar tudo de uma vez).
   */
  signupCode?: string;
  /** Chaves do servidor (opcionais). Quem colocar a própria chave no app usa a dela. */
  geminiKey?: string;
  anthropicKey?: string;
  openaiKey?: string;
  /** Sessão com a IA do app (padrão: 7 min de conversa, 1 h de espera, 40 mensagens). */
  session?: Partial<SessionConfig>;
  /** Historinhas por dia com a IA do app (padrão: 3). Não gasta a sessão de conversa. */
  storiesPerDay?: number;
  /** Chaves das notificações; sem elas o app não oferece aviso. */
  vapid?: Vapid;
  /** Chave da YouTube Data API pra busca na aba Música (sem ela, só colar link). */
  youtubeKey?: string;
  /** PIX pra doações (chave, nome e cidade do recebedor). Sem chave, o app não mostra o apoio. */
  pix?: { key: string; name: string; city: string };
  /** Donos do app (ADMIN_USERS, sem diferenciar maiúscula): veem o painel com números e usuários. */
  adminUsers?: string[];
  /** Salas ao vivo (sem isso, a aba avisa que não estão ligadas). */
  rooms?: RoomsHost;
  /** Endereço oficial do app: o link de convite usa ele mesmo quando a pessoa está numa prévia. */
  publicUrl?: string;
  /** Cadastro aberto (OPEN_SIGNUP): o código de convite vira opcional. */
  openSignup?: boolean;
  /** Limites do cadastro (padrão: 3 contas/h por rede, 10 tentativas/h, 100 contas/dia). */
  signupLimits?: Partial<SignupLimits>;
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

const ReminderBody = z.object({
  time: z.string().regex(HHMM, "Horário inválido. Use HH:MM."),
  tz: z.string().min(1).max(64).refine(validTimeZone, "Fuso horário inválido."),
  enabled: z.boolean(),
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

const Signup = z.object({
  username: Username,
  password: Password,
  code: z.string().max(100).default(""),
  /** Campo invisível na tela: gente não preenche, robô sim. */
  website: z.string().max(200).optional(),
});
const Login = z.object({
  username: z.string().transform((s) => s.trim().replace(/\s+/g, " ")).pipe(z.string().min(1).max(40)),
  password: z.string().min(1).max(128),
});
const BadgeBody = z.object({
  badge: z.enum(BADGES.map((b) => b.id) as [BadgeId, ...BadgeId[]]).nullable(),
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
    case "GET /api/auth/signup-info":
      return json({ open: !!cfg.openSignup, closed: !cfg.openSignup && !cfg.signupCode });

    case "POST /api/auth/signup": {
      const b = await body(req, Signup);
      if (b instanceof Response) return b;
      if (!cfg.openSignup && !cfg.signupCode) return json({ error: "O cadastro está fechado. Peça uma conta pra quem administra o app." }, 403);
      // Limite por rede e teto do dia (a tentativa já fica registrada aqui).
      const net = await networkKey(req);
      const blocked = await checkSignup(db, net, { ...DEFAULT_SIGNUP_LIMITS, ...cfg.signupLimits });
      if (blocked) return json({ error: blocked }, 429);
      if (b.website) return json({ error: "Não deu pra criar a conta agora." }, 400);
      // Código: opcional com o cadastro aberto; se vier, tem que ser o geral (tempo constante) ou o convite de um amigo.
      const code = b.code.trim();
      let inviter: number | null = null;
      if (code) {
        const general = !!cfg.signupCode && sameText(code, cfg.signupCode);
        inviter = general ? null : await inviterByCode(db, code);
        if (!general && inviter === null) return json({ error: "Código de convite incorreto." }, 403);
      } else if (!cfg.openSignup) {
        return json({ error: "Informe o código de convite." }, 403);
      }
      const exists = await db.first("SELECT 1 FROM users WHERE username = ?", b.username);
      if (exists) return json({ error: "Esse usuário já existe. Escolha outro." }, 409);
      const { hash, salt } = await hashPassword(b.password);
      await db.run("INSERT INTO users (username, pass_hash, pass_salt) VALUES (?, ?, ?)", b.username, hash, salt);
      const user = (await db.first<{ id: number }>("SELECT id FROM users WHERE username = ?", b.username))!;
      if (inviter !== null) await recordInvitedBy(db, user.id, inviter);
      await signupDone(db, net);
      await saveGeo(db, user.id, geoOf(req));
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

    // Página de divulgação (/conheca): o PIX de apoio aparece pra quem ainda nem tem conta.
    case "GET /api/pix":
      return json({ pix: cfg.pix?.key ? cfg.pix : null });
  }

  // Daqui pra baixo, só logado.
  const user = await userFromRequest(db, req);
  if (!user) return json({ error: "Faça login pra continuar." }, 401);

  // Salas ao vivo: o WebSocket tem o código no caminho.
  const ws = /^\/api\/rooms\/([^/]+)\/ws$/.exec(pathname);
  if (ws && req.method === "GET") {
    if (!cfg.rooms) return json({ error: "Salas ao vivo não estão ligadas neste servidor." }, 503);
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "Use WebSocket." }, 426);
    // WebSocket não tem CORS: outro site poderia abrir a sala com o cookie de quem está logado.
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) return json({ error: "Origem não permitida." }, 403);
    const code = ws[1]!;
    if (!CODE_RE.test(code)) return json({ error: "Código de sala inválido." }, 400);
    return cfg.rooms.connect(req, code, user);
  }

  switch (route) {
    case "GET /api/me": {
      await touchSeen(db, user.id);
      await saveGeo(db, user.id, geoOf(req));
      const { badges, badge } = await badgeState(db, user.id);
      return json({
        username: user.username,
        ...(isAdmin(cfg.adminUsers, user.username) ? { admin: true } : {}),
        serverAi: !!serverAuthOf(cfg),
        push: !!cfg.vapid,
        musicSearch: !!cfg.youtubeKey,
        pix: cfg.pix?.key ? cfg.pix : null,
        badges,
        badge,
      });
    }

    case "GET /api/invite":
      return json(await inviteInfo(db, user.id, cfg.publicUrl ?? new URL(req.url).origin));

    case "POST /api/badge": {
      const b = await body(req, BadgeBody);
      if (b instanceof Response) return b;
      if (!(await equipBadge(db, user.id, b.badge))) return json({ error: "Você ainda não ganhou esse selo." }, 403);
      return json({ badge: b.badge });
    }

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
        // Conta pro painel do dono (custo da chave do app). Chave própria não entra aqui.
        await countAiMessage(db, user.id, now);
        const row2 = await db.first<SessionRow>("SELECT started_at, ends_at, messages FROM ai_sessions WHERE user_id = ?", user.id);
        return { session: sessionState(row2, now, sc) };
      });
    }

    case "POST /api/story": {
      // Mesma escolha de IA da conversa: chave do próprio usuário (sem limite) ou a do app.
      const userKey = req.headers.get("x-ai-key")?.trim();
      const model = req.headers.get("x-ai-model")?.trim().slice(0, 60) || undefined;
      if (userKey) {
        const provider = providerFor(userKey);
        if (!provider) return json({ error: "Chave não reconhecida. Use uma chave do Google (Gemini), da OpenAI (sk-...) ou da Anthropic (sk-ant-...)." }, 400);
        if (model && !/^[a-zA-Z0-9._:-]+$/.test(model)) return json({ error: "Nome de modelo inválido." }, 400);
        return handleStory(req, { provider, key: userKey, model });
      }
      const serverAuth = serverAuthOf(cfg);
      if (!serverAuth) return json({ error: "Adicione sua chave de IA pra criar historinhas.", needsKey: true }, 403);
      const limit = cfg.storiesPerDay ?? DEFAULT_STORIES_PER_DAY;
      const now = Date.now();
      const used = await storiesToday(db, user.id, now);
      if (used >= limit) {
        return json({ error: `Você já criou ${limit} historinhas hoje. Amanhã tem mais! Enquanto isso, releia as suas.`, limit: true, left: 0 }, 429);
      }
      // Só conta se a historinha vier de verdade.
      return handleStory(req, serverAuth, async () => {
        await countStory(db, user.id, now);
        // Conta pro painel do dono (custo da chave do app), como uma mensagem.
        await countAiMessage(db, user.id, now);
        return { left: Math.max(0, limit - used - 1) };
      });
    }

    case "GET /api/music/search":
    case "GET /api/music/video":
    case "GET /api/music/lyrics": {
      const p = new URL(req.url).searchParams;
      try {
        if (route === "GET /api/music/search") {
          if (!cfg.youtubeKey) return json({ error: "A busca precisa da chave do YouTube. Por enquanto, cole o link do vídeo.", needsKey: true }, 503);
          const q = (p.get("q") ?? "").trim().slice(0, 120);
          if (!q) return json({ error: "Digite o nome da música." }, 400);
          return json({ videos: await searchVideos(q, cfg.youtubeKey) });
        }
        if (route === "GET /api/music/video") {
          const id = videoIdFrom(p.get("url") ?? "");
          if (!id) return json({ error: "Esse link não parece ser de um vídeo do YouTube." }, 400);
          return json({ video: await videoInfo(id) });
        }
        const id = Number(p.get("id"));
        const found = id > 0
          ? await lyricsById(id)
          : await findLyrics((p.get("q") ?? "").trim().slice(0, 160), Number(p.get("duration")) || 0);
        return found ? json(found) : json({ error: "Não achei a letra sincronizada dessa música.", notFound: true }, 404);
      } catch (error) {
        if (error instanceof MusicError) return json({ error: error.message }, error.status);
        return json({ error: "Sem conexão com o YouTube ou com o banco de letras agora." }, 502);
      }
    }

    case "POST /api/rooms": {
      if (!cfg.rooms) return json({ error: "Salas ao vivo não estão ligadas neste servidor." }, 503);
      const b = await body(req, RoomCreate);
      if (b instanceof Response) return b;
      for (let i = 0; i < 3; i++) {
        const code = newRoomCode();
        if (await cfg.rooms.create({ code, size: b.size, level: b.level, creator: { id: user.id, name: user.username } })) {
          return json({ code }, 201);
        }
      }
      return json({ error: "Não deu pra criar a sala agora. Tenta de novo." }, 503);
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

    case "GET /api/push/latest":
      return json(await latestOutbox(db, user.id));

    case "GET /api/reminder": {
      if (!cfg.vapid) return json({ error: "Notificações não configuradas." }, 404);
      const row = await db.first<{ time: string; tz: string; enabled: number }>(
        "SELECT time, tz, enabled FROM reminders WHERE user_id = ?",
        user.id,
      );
      return json(row ? { time: row.time, tz: row.tz, enabled: !!row.enabled } : null);
    }

    case "PUT /api/reminder": {
      if (!cfg.vapid) return json({ error: "Notificações não configuradas." }, 404);
      const b = await body(req, ReminderBody);
      if (b instanceof Response) return b;
      // Mudou o horário ou o fuso: zera last_sent pra o lembrete poder sair ainda hoje no novo horário.
      await db.run(
        "INSERT INTO reminders (user_id, time, tz, enabled) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET last_sent = CASE WHEN reminders.time = excluded.time AND reminders.tz = excluded.tz THEN reminders.last_sent ELSE NULL END, time = excluded.time, tz = excluded.tz, enabled = excluded.enabled",
        user.id,
        b.time,
        b.tz,
        b.enabled ? 1 : 0,
      );
      return json({ time: b.time, tz: b.tz, enabled: b.enabled });
    }
  }

  // Painel do dono: conferido aqui no servidor a cada pedido.
  if (pathname.startsWith("/api/admin/")) {
    if (!isAdmin(cfg.adminUsers, user.username)) return json({ error: "Só o dono do app pode ver isso." }, 403);
    switch (route) {
      case "GET /api/admin/stats":
        return json(await adminStats(db));
      case "GET /api/admin/users":
        return json({ users: await adminUsers(db) });
      case "POST /api/admin/reset-password": {
        const b = await body(req, z.object({ username: Login.shape.username }));
        if (b instanceof Response) return b;
        const r = await resetPassword(db, b.username);
        if (!r) return json({ error: "Usuário não encontrado." }, 404);
        return json({ username: r.username, password: r.password });
      }
    }
  }

  return json({ error: "Rota não encontrada." }, 404);
}
