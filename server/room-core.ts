/**
 * Salas ao vivo: a máquina de estados de uma sala, pura (sem rede, sem relógio, sem banco).
 * Quem embrulha (o Durable Object no Cloudflare e o servidor local do Bun) passa o horário,
 * guarda o estado (JSON pequeno) e entrega as mensagens que cada função devolve.
 *
 * Regras: walkie-talkie (uma pessoa com a palavra por vez, o servidor concede e solta),
 * no máximo 10 minutos, português dá aviso e o último aviso tira da sala (sem volta).
 */
import { z } from "zod";
import { detectPortuguese } from "../src/lib/ptdetect";
import { ROOM_TOPICS } from "../src/lib/room-topics";
import { CODE_ALPHABET, CODE_LEN, MAX_AUDIO_BYTES, MAX_TEXT, MAX_TURN_MS } from "../src/lib/room-wire";

export { CODE_ALPHABET, CODE_LEN, CODE_RE, MAX_AUDIO_BYTES, MAX_TEXT, MAX_TURN_MS, normalizeCode } from "../src/lib/room-wire";

export type RoomLevel = "iniciante" | "intermediario" | "nativo";
export const ROOM_LEVELS: readonly RoomLevel[] = ["iniciante", "intermediario", "nativo"];
export type RoomSize = 2 | 4;

/** Avisos até sair da sala: o último aviso tira. */
export const STRIKES: Record<RoomLevel, number> = { iniciante: 3, intermediario: 2, nativo: 1 };

export const ROOM_MS = 10 * 60_000;
/** Sala que ninguém começou some depois disso. */
export const WAIT_MS = 30 * 60_000;
/** Folga pro áudio chegar depois que a pessoa solta o botão. */
export const TURN_GRACE_MS = 5_000;
/** Uma fala a cada 2 s por pessoa (pedido de palavra). */
export const TURN_GAP_MS = 2_000;
/** Últimas falas guardadas (só texto, pra quem reconecta). O áudio nunca fica guardado. */
export const LOG_MAX = 60;
/** Limite geral de mensagens por pessoa (protege a sala de enxurrada). */
export const RATE_WINDOW_MS = 10_000;
export const RATE_MAX = 30;
const TOPIC_GAP_MS = 4_000;

/* ---------- códigos de fechamento do WebSocket (o aparelho não reconecta nesses) ---------- */
export const CLOSE = {
  kicked: 4001,
  ended: 4002,
  full: 4003,
  notFound: 4004,
  replaced: 4005,
  banned: 4006,
  left: 4007,
} as const;

export interface Member {
  id: number;
  name: string;
  /** Conexão atual (uma por pessoa; a nova derruba a antiga). */
  conn: string | null;
  online: boolean;
  strikes: number;
  turns: number;
  words: number;
  talkMs: number;
  kicked: boolean;
}

export interface LogEntry {
  id: number;
  name: string;
  text: string;
  pt: boolean;
  at: number;
}

export interface RoomState {
  v: 1;
  code: string;
  size: RoomSize;
  level: RoomLevel;
  creatorId: number | null;
  createdAt: number;
  phase: "waiting" | "live" | "ended";
  members: Member[];
  floor: { userId: number; id: number; since: number } | null;
  startedAt: number | null;
  endsAt: number | null;
  endedAt: number | null;
  endReason: EndReason | null;
  seq: number;
  topic: number;
  lastTopicAt: number;
  log: LogEntry[];
  /** Último pedido de palavra concedido, por pessoa. */
  lastGrant: Record<string, number>;
  rate: Record<string, { start: number; n: number }>;
}

export type EndReason = "time" | "expired" | "alone";

export interface RoomInit {
  code: string;
  size: RoomSize;
  level: RoomLevel;
  creator: { id: number; name: string };
}

/* ---------- o que vai pro aparelho ---------- */
export interface MemberView {
  name: string;
  online: boolean;
  strikes: number;
  turns: number;
  kicked: boolean;
}

export interface RoomView {
  code: string;
  size: RoomSize;
  level: RoomLevel;
  maxStrikes: number;
  phase: RoomState["phase"];
  creator: string | null;
  members: MemberView[];
  floor: { name: string; id: number; since: number } | null;
  startedAt: number | null;
  endsAt: number | null;
  topic: number;
  /** Relógio do servidor, pro aparelho acertar a contagem regressiva. */
  now: number;
}

export interface SummaryMember {
  name: string;
  turns: number;
  words: number;
  talkMs: number;
  strikes: number;
  kicked: boolean;
}

export interface RoomSummary {
  code: string;
  level: RoomLevel;
  reason: EndReason;
  durationMs: number;
  members: SummaryMember[];
}

export type ServerMsg =
  | { t: "welcome"; you: string; room: RoomView; log: LogEntry[] }
  | { t: "state"; room: RoomView }
  | { t: "turn"; entry: LogEntry }
  | { t: "strike"; name: string; strikes: number; max: number }
  | { t: "kicked"; name: string; you: boolean }
  | { t: "denied"; reason: string }
  | { t: "summary"; summary: RoomSummary }
  | { t: "error"; code: keyof typeof CLOSE; message: string }
  | { t: "pong" };

/** Cabeçalho do áudio repassado (o quadro binário leva os bytes logo depois). */
export interface AudioHeader {
  t: "audio";
  id: number;
  name: string;
  mime: string;
}

/**
 * O que entregar. Os destinatários já vêm resolvidos (conexões), do jeito que estavam na hora:
 * assim quem acabou de ser quitado ainda recebe o aviso antes de a conexão fechar.
 */
export type Out =
  | { kind: "send"; conns: string[]; msg: ServerMsg }
  | { kind: "audio"; conns: string[]; header: AudioHeader }
  | { kind: "close"; conn: string; code: number; reason: string }
  | { kind: "closeAll"; code: number; reason: string };

export interface Result {
  ok: boolean;
  /** Mudou o estado (quem embrulha salva). */
  changed: boolean;
  out: Out[];
}

/* ---------- mensagens do aparelho (tudo conferido) ---------- */
export const ClientMsg = z.discriminatedUnion("t", [
  z.object({ t: z.literal("floor") }),
  z.object({ t: z.literal("release") }),
  z.object({ t: z.literal("start") }),
  z.object({ t: z.literal("leave") }),
  z.object({ t: z.literal("topic") }),
  z.object({ t: z.literal("ping") }),
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

/** Formatos de áudio que o MediaRecorder dos navegadores grava (Safari: mp4; Chrome/Firefox: webm/ogg). */
const MIME = /^audio\/(mp4|webm|ogg|aac|mpeg|x-m4a)(;\s*codecs="?[a-z0-9.,\s]+"?)?$/i;

export const TurnHeader = z.object({
  t: z.literal("turn"),
  id: z.number().int().nonnegative(),
  text: z.string().max(MAX_TEXT),
  conf: z.number().min(0).max(1).optional(),
  mime: z.string().max(60).regex(MIME).or(z.literal("")),
  /** O aparelho achou português (só um palpite: quem decide é o servidor). */
  pt: z.boolean().optional(),
});
export type TurnHeader = z.infer<typeof TurnHeader>;

export const RoomCreate = z.object({
  size: z.union([z.literal(2), z.literal(4)]),
  level: z.enum(["iniciante", "intermediario", "nativo"]),
});

/* ---------- código da sala ---------- */
export function newRoomCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let code = "";
  // Rejeita bytes acima do maior múltiplo do alfabeto (sem viés).
  const limit = 256 - (256 % CODE_ALPHABET.length);
  while (code.length < CODE_LEN) {
    for (const b of random(16)) {
      if (b < limit && code.length < CODE_LEN) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return code;
}

/* ---------- estado ---------- */
export function createRoom(init: RoomInit, now: number): RoomState {
  return {
    v: 1,
    code: init.code,
    size: init.size,
    level: init.level,
    creatorId: init.creator.id,
    createdAt: now,
    phase: "waiting",
    members: [],
    floor: null,
    startedAt: null,
    endsAt: null,
    endedAt: null,
    endReason: null,
    seq: 0,
    topic: 0,
    lastTopicAt: 0,
    log: [],
    lastGrant: {},
    rate: {},
  };
}

const active = (s: RoomState): Member[] => s.members.filter((m) => !m.kicked);
const member = (s: RoomState, id: number): Member | undefined => s.members.find((m) => m.id === id);
export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

export function view(s: RoomState, now: number): RoomView {
  const holder = s.floor ? member(s, s.floor.userId) : undefined;
  return {
    code: s.code,
    size: s.size,
    level: s.level,
    maxStrikes: STRIKES[s.level],
    phase: s.phase,
    creator: (s.creatorId !== null && member(s, s.creatorId)?.name) || null,
    members: s.members.map((m) => ({ name: m.name, online: m.online, strikes: m.strikes, turns: m.turns, kicked: m.kicked })),
    floor: s.floor && holder ? { name: holder.name, id: s.floor.id, since: s.floor.since } : null,
    startedAt: s.startedAt,
    endsAt: s.endsAt,
    topic: s.topic,
    now,
  };
}

export function summary(s: RoomState): RoomSummary {
  return {
    code: s.code,
    level: s.level,
    reason: s.endReason ?? "time",
    durationMs: s.startedAt ? Math.max(0, (s.endedAt ?? s.startedAt) - s.startedAt) : 0,
    members: s.members.map((m) => ({ name: m.name, turns: m.turns, words: m.words, talkMs: m.talkMs, strikes: m.strikes, kicked: m.kicked })),
  };
}

/** Conexões atuais de quem está na sala (menos `except`). */
const conns = (s: RoomState, except?: number): string[] =>
  s.members.filter((m) => m.conn && m.id !== except).map((m) => m.conn!);
const toAll = (s: RoomState, msg: ServerMsg, except?: number): Out => ({ kind: "send", conns: conns(s, except), msg });
const toUser = (s: RoomState, userId: number, msg: ServerMsg): Out => {
  const c = member(s, userId)?.conn;
  return { kind: "send", conns: c ? [c] : [], msg };
};
const stateAll = (s: RoomState, now: number, except?: number): Out => toAll(s, { t: "state", room: view(s, now) }, except);
const deny = (s: RoomState, userId: number, reason: string): Result => ({
  ok: false,
  changed: false,
  out: [toUser(s, userId, { t: "denied", reason })],
});

function start(s: RoomState, now: number, rng: () => number): void {
  s.phase = "live";
  s.startedAt = now;
  s.endsAt = now + ROOM_MS;
  s.topic = Math.floor(rng() * ROOM_TOPICS.length) % ROOM_TOPICS.length;
}

function end(s: RoomState, now: number, reason: EndReason): Out[] {
  s.phase = "ended";
  s.endedAt = now;
  s.endReason = reason;
  s.floor = null;
  const out: Out[] = [
    toAll(s, { t: "summary", summary: summary(s) }),
    { kind: "closeAll", code: CLOSE.ended, reason: "sala encerrada" },
  ];
  for (const m of s.members) {
    m.online = false;
    m.conn = null;
  }
  return out;
}

/** Erro de entrada: quem embrulha responde só pra essa conexão e fecha. */
export type JoinError = { ok: false; code: keyof typeof CLOSE; message: string; summary?: RoomSummary };

/**
 * Alguém (já logado) abriu o WebSocket da sala. `conn` identifica a conexão: se a pessoa já
 * estava (outra aba, rede que caiu), a conexão antiga é derrubada e ela continua de onde parou.
 */
export function join(
  s: RoomState,
  user: { id: number; name: string },
  conn: string,
  now: number,
  rng: () => number = Math.random,
): Result | JoinError {
  if (s.phase === "ended") return { ok: false, code: "ended", message: "Essa sala já acabou.", summary: summary(s) };
  const out: Out[] = [];
  let m = member(s, user.id);
  if (m?.kicked) return { ok: false, code: "banned", message: "Você foi quitado dessa sala e não pode voltar." };
  if (m) {
    if (m.conn && m.conn !== conn) out.push({ kind: "close", conn: m.conn, code: CLOSE.replaced, reason: "aberta em outro lugar" });
  } else {
    if (active(s).length >= s.size) return { ok: false, code: "full", message: "A sala está cheia." };
    m = { id: user.id, name: user.name, conn: null, online: false, strikes: 0, turns: 0, words: 0, talkMs: 0, kicked: false };
    s.members.push(m);
    s.creatorId ??= user.id;
  }
  m.conn = conn;
  m.online = true;
  if (s.phase === "waiting" && active(s).length >= s.size) start(s, now, rng);
  out.push({ kind: "send", conns: [conn], msg: { t: "welcome", you: m.name, room: view(s, now), log: s.log } });
  out.push(stateAll(s, now, user.id));
  return { ok: true, changed: true, out };
}

/** A conexão caiu. Se era a atual da pessoa, ela fica offline (e solta a palavra). */
export function disconnect(s: RoomState, userId: number, conn: string, now: number): Result {
  const m = member(s, userId);
  if (!m || m.conn !== conn || s.phase === "ended") return { ok: true, changed: false, out: [] };
  m.conn = null;
  m.online = false;
  if (s.floor?.userId === userId) s.floor = null;
  return { ok: true, changed: true, out: [stateAll(s, now)] };
}

function rateOk(s: RoomState, userId: number, now: number): boolean {
  const key = String(userId);
  const r = s.rate[key];
  if (!r || now - r.start >= RATE_WINDOW_MS) {
    s.rate[key] = { start: now, n: 1 };
    return true;
  }
  r.n++;
  return r.n <= RATE_MAX;
}

/** Mensagem de texto do aparelho (JSON). Qualquer coisa fora do formato é ignorada. */
export function handleMessage(s: RoomState, userId: number, raw: string, now: number, rng: () => number = Math.random): Result {
  const m = member(s, userId);
  if (!m || m.kicked || s.phase === "ended" || raw.length > 500) return { ok: false, changed: false, out: [] };
  if (!rateOk(s, userId, now)) return { ok: false, changed: true, out: [] };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, changed: true, out: [] };
  }
  const parsed = ClientMsg.safeParse(data);
  if (!parsed.success) return { ok: false, changed: true, out: [] };
  const msg = parsed.data;

  switch (msg.t) {
    case "ping":
      return { ok: true, changed: true, out: [toUser(s, userId, { t: "pong" })] };

    case "start": {
      if (s.phase !== "waiting") return deny(s, userId, "A sala já começou.");
      if (s.creatorId !== userId) return deny(s, userId, "Só quem criou a sala pode começar.");
      if (active(s).length < 2) return deny(s, userId, "Espere pelo menos mais uma pessoa entrar.");
      start(s, now, rng);
      return { ok: true, changed: true, out: [stateAll(s, now)] };
    }

    case "floor": {
      if (s.phase !== "live") return deny(s, userId, "A sala ainda não começou.");
      if (s.floor && s.floor.userId !== userId) {
        const holder = member(s, s.floor.userId);
        return deny(s, userId, `${holder?.name ?? "Alguém"} está falando.`);
      }
      if (s.floor?.userId === userId) return { ok: true, changed: true, out: [stateAll(s, now)] };
      const last = s.lastGrant[String(userId)] ?? 0;
      if (now - last < TURN_GAP_MS) return deny(s, userId, "Calma: espere 2 segundinhos entre uma fala e outra.");
      s.seq++;
      s.floor = { userId, id: s.seq, since: now };
      s.lastGrant[String(userId)] = now;
      return { ok: true, changed: true, out: [stateAll(s, now)] };
    }

    case "release": {
      if (s.floor?.userId !== userId) return { ok: true, changed: true, out: [] };
      s.floor = null;
      return { ok: true, changed: true, out: [stateAll(s, now)] };
    }

    case "topic": {
      if (s.phase !== "live" || s.level !== "intermediario") return { ok: false, changed: true, out: [] };
      if (now - s.lastTopicAt < TOPIC_GAP_MS) return { ok: false, changed: true, out: [] };
      const n = ROOM_TOPICS.length;
      s.topic = (s.topic + 1 + Math.floor(rng() * (n - 1))) % n;
      s.lastTopicAt = now;
      return { ok: true, changed: true, out: [stateAll(s, now)] };
    }

    case "leave": {
      const out: Out[] = [];
      if (m.conn) out.push({ kind: "close", conn: m.conn, code: CLOSE.left, reason: "saiu" });
      if (s.phase === "waiting") {
        // Antes de começar, sair libera a vaga (e passa a sala pra próxima pessoa, se era quem criou).
        s.members = s.members.filter((x) => x.id !== userId);
        if (s.creatorId === userId) s.creatorId = s.members[0]?.id ?? null;
      } else {
        m.online = false;
        m.conn = null;
        if (s.floor?.userId === userId) s.floor = null;
      }
      out.push(stateAll(s, now));
      return { ok: true, changed: true, out };
    }
  }
}

/**
 * Fim de uma fala: o quadro binário com a transcrição e o áudio. Solta a palavra, conta a fala,
 * repassa o áudio pros outros e confere português (aviso; no último, tira da sala).
 */
export function handleTurn(s: RoomState, userId: number, header: unknown, audioBytes: number, now: number): Result {
  const m = member(s, userId);
  if (!m || m.kicked || s.phase !== "live") return { ok: false, changed: false, out: [] };
  if (!rateOk(s, userId, now)) return { ok: false, changed: true, out: [] };
  const parsed = TurnHeader.safeParse(header);
  if (!parsed.success || audioBytes > MAX_AUDIO_BYTES) return deny(s, userId, "Essa fala não pôde ser enviada.");
  const h = parsed.data;
  if (!s.floor || s.floor.userId !== userId || s.floor.id !== h.id) return deny(s, userId, "Sua vez já tinha acabado.");

  const text = h.text.replace(/\s+/g, " ").trim();
  const talk = Math.min(Math.max(0, now - s.floor.since), MAX_TURN_MS);
  s.floor = null;
  if (!text && audioBytes === 0) return { ok: true, changed: true, out: [stateAll(s, now)] };

  m.turns++;
  m.words += wordCount(text);
  m.talkMs += talk;
  const pt = text ? detectPortuguese(text, h.conf).isPortuguese : false;
  const entry: LogEntry = { id: h.id, name: m.name, text, pt, at: now };
  s.log.push(entry);
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);

  const out: Out[] = [];
  if (audioBytes > 0 && h.mime) out.push({ kind: "audio", conns: conns(s, userId), header: { t: "audio", id: h.id, name: m.name, mime: h.mime } });
  out.push(toAll(s, { t: "turn", entry }));

  if (pt) {
    m.strikes++;
    const max = STRIKES[s.level];
    if (m.strikes >= max) {
      m.kicked = true;
      m.online = false;
      out.push(toUser(s, userId, { t: "kicked", name: m.name, you: true }));
      out.push(toAll(s, { t: "kicked", name: m.name, you: false }, userId));
      if (m.conn) out.push({ kind: "close", conn: m.conn, code: CLOSE.kicked, reason: "quitado" });
      m.conn = null;
      if (active(s).length < 2) return { ok: true, changed: true, out: [...out, ...end(s, now, "alone")] };
    } else {
      out.push(toAll(s, { t: "strike", name: m.name, strikes: m.strikes, max }));
    }
  }
  out.push(stateAll(s, now));
  return { ok: true, changed: true, out };
}

/** Relógio: fim dos 10 minutos, sala abandonada e palavra presa (o áudio nunca chegou). */
export function tick(s: RoomState, now: number): Result {
  if (s.phase === "waiting" && now >= s.createdAt + WAIT_MS) return { ok: true, changed: true, out: end(s, now, "expired") };
  if (s.phase !== "live") return { ok: true, changed: false, out: [] };
  if (s.endsAt !== null && now >= s.endsAt) return { ok: true, changed: true, out: end(s, now, "time") };
  if (s.floor && now >= s.floor.since + MAX_TURN_MS + TURN_GRACE_MS) {
    s.floor = null;
    return { ok: true, changed: true, out: [stateAll(s, now)] };
  }
  return { ok: true, changed: false, out: [] };
}

/** Quando chamar `tick` de novo (null = nada agendado). */
export function nextAlarm(s: RoomState): number | null {
  if (s.phase === "waiting") return s.createdAt + WAIT_MS;
  if (s.phase !== "live" || s.endsAt === null) return null;
  return s.floor ? Math.min(s.endsAt, s.floor.since + MAX_TURN_MS + TURN_GRACE_MS) : s.endsAt;
}

/* ---------- entrega (igual no Durable Object e no Bun) ---------- */
export interface Peer {
  conn: string;
  send(data: string | Uint8Array): void;
  close(code: number, reason: string): void;
}

/** Entrega o que a sala devolveu. `audio` são os bytes da fala (repassados, nunca guardados). */
export function deliver(out: Out[], peers: Peer[], audio?: Uint8Array, frame?: (h: AudioHeader, a: Uint8Array) => Uint8Array): void {
  const safe = (fn: () => void) => {
    try {
      fn();
    } catch {
      // conexão já fechada
    }
  };
  for (const o of out) {
    if (o.kind === "send" || o.kind === "audio") {
      if (o.kind === "audio" && (!audio || !frame)) continue;
      const data = o.kind === "send" ? JSON.stringify(o.msg) : frame!(o.header, audio!);
      const to = new Set(o.conns);
      for (const p of peers) if (to.has(p.conn)) safe(() => p.send(data));
    } else if (o.kind === "close") {
      for (const p of peers) if (p.conn === o.conn) safe(() => p.close(o.code, o.reason));
    } else {
      for (const p of peers) safe(() => p.close(o.code, o.reason));
    }
  }
}
