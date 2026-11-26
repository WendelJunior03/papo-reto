/**
 * Painel do dono: números do app, lista de usuários e senha temporária.
 * Quem é dono vem de ADMIN_USERS (nomes separados por vírgula, sem diferenciar maiúscula).
 * Poucos usuários: o progresso (JSON em users.progress) é lido e somado aqui mesmo.
 * Nada de hash, sal ou token sai daqui.
 */
import { streak } from "../src/lib/schedule";
import { hashPassword } from "./auth";
import { placeLabel } from "./geo";
import type { Db } from "./db";

/** Dias contados no horário de Brasília (UTC−3, sem horário de verão desde 2019). */
const TZ_OFFSET = -3 * 3_600_000;
const DAY = 86_400_000;
/** Último acesso só é regravado se o anterior tiver mais de 1 hora. */
export const SEEN_EVERY = 3_600_000;

export const dayOf = (ms: number): string => new Date(ms + TZ_OFFSET).toISOString().slice(0, 10);
/** Início (em ms) do dia de Brasília que contém `ms`. */
const startOfDay = (ms: number): number => Math.floor((ms + TZ_OFFSET) / DAY) * DAY - TZ_OFFSET;
/** Últimos `n` dias, do mais antigo pra hoje. */
const lastDays = (now: number, n: number): string[] => Array.from({ length: n }, (_, i) => dayOf(now - (n - 1 - i) * DAY));
/** created_at do SQLite ("AAAA-MM-DD HH:MM:SS", em UTC) em ms. */
const sqlTime = (s: string): number => Date.parse(`${s.replace(" ", "T")}Z`);

export function isAdmin(list: string[] | undefined, username: string): boolean {
  const u = username.trim().toLowerCase();
  return !!list?.some((a) => a.trim().toLowerCase() === u);
}

/** "a, B ,c" → ["a", "b", "c"]. */
export const parseAdmins = (env: string | undefined): string[] | undefined =>
  env ? env.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : undefined;

/** Marca o último acesso, no máximo uma vez por hora (o WHERE evita escrever à toa). */
export async function touchSeen(db: Db, userId: number, now = Date.now()): Promise<void> {
  await db.run(
    "INSERT INTO user_activity (user_id, last_seen_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at WHERE user_activity.last_seen_at < ?",
    userId,
    now,
    now - SEEN_EVERY,
  );
}

/** Conta uma mensagem com a chave do app (custo da IA), por usuário e dia. */
export async function countAiMessage(db: Db, userId: number, now = Date.now()): Promise<void> {
  await db.run(
    "INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1",
    userId,
    dayOf(now),
  );
}

interface Saved {
  visits: string[];
  known: number;
  supported: boolean;
  songs: number;
}

/** Só o que o painel precisa do progresso salvo; JSON estranho vira zero. */
function readProgress(raw: string | null): Saved {
  try {
    const d = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const visits = Array.isArray(d.visits) ? [...new Set(d.visits.filter((v): v is string => typeof v === "string"))] : [];
    const cards = d.progress && typeof d.progress === "object" ? Object.values(d.progress as Record<string, { box?: unknown }>) : [];
    const known = cards.filter((c) => typeof c?.box === "number" && c.box >= 1).length;
    const songs = d.songs && typeof d.songs === "object" ? Object.keys(d.songs).length : 0;
    return { visits, known, supported: d.supported === true, songs };
  } catch {
    return { visits: [], known: 0, supported: false, songs: 0 };
  }
}

interface Row {
  id: number;
  username: string;
  created_at: string;
  progress: string | null;
  last_seen_at: number | null;
  push: number;
  ai7: number;
  invites: number;
  invited_by: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

async function loadUsers(db: Db, now: number): Promise<(Row & Saved & { lastStudy: string | null })[]> {
  const since7 = dayOf(now - 6 * DAY);
  const rows = await db.all<Row>(
    `SELECT u.id, u.username, u.created_at, u.progress, a.last_seen_at,
       (SELECT COUNT(*) FROM push_subs p WHERE p.user_id = u.id) AS push,
       (SELECT COALESCE(SUM(count), 0) FROM ai_usage g WHERE g.user_id = u.id AND g.day >= ?) AS ai7,
       (SELECT COUNT(*) FROM invites i WHERE i.invited_by = u.id) AS invites,
       (SELECT p.username FROM invites i JOIN users p ON p.id = i.invited_by WHERE i.user_id = u.id) AS invited_by,
       g.city, g.region, g.country
     FROM users u LEFT JOIN user_activity a ON a.user_id = u.id LEFT JOIN user_geo g ON g.user_id = u.id`,
    since7,
  );
  return rows.map((r) => {
    const p = readProgress(r.progress);
    const lastStudy = p.visits.length ? p.visits.reduce((a, b) => (a > b ? a : b)) : null;
    return { ...r, ...p, lastStudy };
  });
}

/** Ativo num período: acesso registrado no servidor ou dia de estudo salvo dentro dele. */
const activeSince = (u: { last_seen_at: number | null; lastStudy: string | null }, fromMs: number): boolean =>
  (u.last_seen_at ?? 0) >= fromMs || (u.lastStudy ?? "") >= dayOf(fromMs);

export async function adminStats(db: Db, now = Date.now()) {
  const users = await loadUsers(db, now);
  const days = lastDays(now, 30);
  const today = startOfDay(now);

  const signups = new Map(days.map((d) => [d, 0]));
  for (const u of users) {
    const d = dayOf(sqlTime(u.created_at));
    if (signups.has(d)) signups.set(d, signups.get(d)! + 1);
  }

  const ai = new Map(days.map((d) => [d, 0]));
  const aiRows = await db.all<{ day: string; n: number }>(
    "SELECT day, SUM(count) AS n FROM ai_usage WHERE day >= ? GROUP BY day",
    days[0],
  );
  for (const r of aiRows) if (ai.has(r.day)) ai.set(r.day, r.n);
  const aiSeries = days.map((date) => ({ date, value: ai.get(date)! }));

  const sessions = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM ai_sessions WHERE started_at >= ?", today);
  const push = await db.first<{ n: number }>("SELECT COUNT(DISTINCT user_id) AS n FROM push_subs");

  return {
    users: users.length,
    signupsByDay: days.map((date) => ({ date, value: signups.get(date)! })),
    active: {
      today: users.filter((u) => activeSince(u, today)).length,
      d7: users.filter((u) => activeSince(u, today - 6 * DAY)).length,
      d30: users.filter((u) => activeSince(u, today - 29 * DAY)).length,
    },
    aiMessagesByDay: aiSeries,
    aiMessages: {
      today: aiSeries[aiSeries.length - 1]!.value,
      d7: aiSeries.slice(-7).reduce((n, p) => n + p.value, 0),
    },
    /** Pessoas que abriram uma sessão com a IA do app hoje (a tabela guarda só a última de cada uma). */
    aiSessionsToday: sessions?.n ?? 0,
    pushSubscribers: push?.n ?? 0,
    supporters: users.filter((u) => u.supported).length,
    songsPracticed: users.reduce((n, u) => n + u.songs, 0),
    phrasesKnown: users.reduce((n, u) => n + u.known, 0),
    /** De onde vem a turma: as cidades com mais gente (aproximado, pela conexão). */
    places: topPlaces(users),
  };
}

export async function adminUsers(db: Db, now = Date.now()) {
  const users = await loadUsers(db, now);
  const today = dayOf(now);
  return users
    .map((u) => ({
      username: u.username,
      createdAt: new Date(sqlTime(u.created_at)).toISOString(),
      /** Último acesso registrado no servidor (null pra quem não abriu o app desde o painel existir). */
      lastSeen: u.last_seen_at ? new Date(u.last_seen_at).toISOString() : null,
      /** Último dia de estudo salvo no progresso (AAAA-MM-DD, no fuso do aparelho). */
      lastStudy: u.lastStudy,
      known: u.known,
      days: u.visits.length,
      streak: streak(u.visits, today),
      supporter: u.supported,
      push: u.push > 0,
      ai7d: u.ai7,
      /** Amigos que entraram com o convite pessoal dele. */
      invites: u.invites,
      /** Quem convidou (null = entrou com o código geral). */
      invitedBy: u.invited_by,
      /** Cidade aproximada pela conexão ("Uberlândia, MG"); null até o próximo acesso. */
      place: placeLabel(u),
    }))
    .sort((a, b) =>
      (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "") || (b.lastStudy ?? "").localeCompare(a.lastStudy ?? "") || a.username.localeCompare(b.username));
}

/** Sem letras e números que se confundem (0/O, 1/l/I). */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Senha temporária legível: "abcde-fgh23" (10 caracteres sorteados com Web Crypto). */
export function tempPassword(): string {
  const out: string[] = [];
  const max = 256 - (256 % ALPHABET.length); // descarta o resto pra não enviesar
  while (out.length < 10) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < max && out.length < 10) out.push(ALPHABET[b % ALPHABET.length]!);
    }
  }
  return `${out.slice(0, 5).join("")}-${out.slice(5).join("")}`;
}

/**
 * Troca a senha por uma temporária, desbloqueia a conta e derruba as sessões abertas.
 * Devolve a senha (uma única vez) ou null se o usuário não existe.
 */
export async function resetPassword(db: Db, username: string): Promise<{ username: string; password: string } | null> {
  const user = await db.first<{ id: number; username: string }>("SELECT id, username FROM users WHERE username = ?", username);
  if (!user) return null;
  const password = tempPassword();
  const { hash, salt } = await hashPassword(password);
  await db.run("UPDATE users SET pass_hash = ?, pass_salt = ?, failed_logins = 0, locked_until = 0 WHERE id = ?", hash, salt, user.id);
  await db.run("DELETE FROM sessions WHERE user_id = ?", user.id);
  return { username: user.username, password };
}

function topPlaces(users: { city: string | null; region: string | null; country: string | null }[], max = 8) {
  const count = new Map<string, number>();
  for (const u of users) {
    const p = placeLabel(u);
    if (p) count.set(p, (count.get(p) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([place, users]) => ({ place, users }));
}
