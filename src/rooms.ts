/**
 * Salas ao vivo no aparelho: conexão com a sala (WebSocket, com reconexão), botão de
 * apertar-e-falar (grava + transcreve no mesmo aperto), fila de áudio dos outros e o
 * estado das telas (lobby, espera, ao vivo, quitado, resumo).
 * A tela em si fica em views/rooms.ts; aqui não tem HTML.
 */
import { allPhrases } from "./data";
import { canListen, listenHold, type HoldResult } from "./lib/listen";
import { detectPortuguese } from "./lib/ptdetect";
import { canRecord, enqueueClip, onClipChange, playClipNow, record, stopClips, unlockAudio, type Recording } from "./lib/ptt";
import { decodeFrame, encodeFrame, MAX_AUDIO_BYTES, MAX_TEXT, MAX_TURN_MS, normalizeCode } from "./lib/room-wire";
import type { AudioHeader, LogEntry, RoomLevel, RoomSummary, RoomView, ServerMsg } from "../server/room-core";

export type RoomScreen = "lobby" | "room" | "kicked" | "summary";

export interface RoomUi {
  screen: RoomScreen;
  create: { size: 2 | 4; level: RoomLevel };
  busy: boolean;
  error: string | null;
  code: string | null;
  you: string | null;
  room: RoomView | null;
  log: LogEntry[];
  conn: "off" | "connecting" | "open" | "retrying" | "lost";
  /** idle → asking (pediu a vez) → recording (tem a vez) → sending. */
  talking: "idle" | "asking" | "recording" | "sending";
  partial: string;
  /** Quem está tocando agora na fila de áudio. */
  playing: string | null;
  summary: RoomSummary | null;
  /** Aviso grande na tela ("Aviso 1 de 3: só inglês aqui!"). */
  banner: string | null;
  /** O aparelho não transcreveu a última fala (o áudio foi mesmo assim). */
  noTranscript: boolean;
  /** Frases de apoio (nível Iniciante): ids de frases do app. */
  helpers: string[];
  /** Diferença entre o relógio do servidor e o daqui. */
  offset: number;
  /** Já liberou o microfone neste aparelho (o pedido de permissão não cai no meio de uma fala). */
  micReady: boolean;
}

export const roomUi: RoomUi = {
  screen: "lobby",
  create: { size: 2, level: "iniciante" },
  busy: false,
  error: null,
  code: null,
  you: null,
  room: null,
  log: [],
  conn: "off",
  talking: "idle",
  partial: "",
  playing: null,
  summary: null,
  banner: null,
  noTranscript: false,
  helpers: [],
  offset: 0,
  micReady: false,
};

interface Deps {
  /** Redesenha a tela (se a aba Salas estiver aberta). */
  render(): void;
  toast(msg: string, ok?: boolean): void;
  /** A aba Salas está aberta? */
  visible(): boolean;
}
let deps: Deps = { render: () => {}, toast: () => {}, visible: () => false };

export function initRooms(d: Deps): void {
  deps = d;
}

/** Redesenha mantendo a rolagem da conversa (colada no fim, se estava no fim). */
const rerender = (): void => {
  if (!deps.visible()) return;
  const log = document.getElementById("room-log");
  const atEnd = !log || log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
  const top = log?.scrollTop ?? 0;
  deps.render();
  const now = document.getElementById("room-log");
  if (now) now.scrollTop = atEnd ? now.scrollHeight : top;
};

/* ---------- link de convite ---------- */
export const roomLink = (code: string): string => `${location.origin}${location.pathname}?sala=${code}`;

/**
 * Lê o ?sala=CODE do link uma vez só (no boot) e tira da barra de endereço,
 * pra não reentrar na sala a cada recarga.
 */
export function takeRoomParam(): string | null {
  const url = new URL(location.href);
  const raw = url.searchParams.get("sala");
  if (raw === null) return null;
  url.searchParams.delete("sala");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
  return normalizeCode(raw);
}

/* ---------- frases de apoio (Iniciante) ---------- */
const HELPER_POOL = allPhrases.filter((p) => p.tag === "casual" || p.tag === "neutro");
function shuffleHelpers(): void {
  const picked = new Set<string>();
  while (picked.size < 3 && picked.size < HELPER_POOL.length) {
    picked.add(HELPER_POOL[Math.floor(Math.random() * HELPER_POOL.length)]!.id);
  }
  roomUi.helpers = [...picked];
}

/* ---------- conexão ---------- */
let ws: WebSocket | null = null;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;
/** Sair de propósito (ou fechamento final): não reconecta. */
let closing = false;
const RETRY_MS = [500, 1000, 2000, 4000, 8000, 8000];

/** Áudios recebidos (e os meus), pra "ouvir de novo". Só na memória, os últimos 20. */
const clips = new Map<number, { url: string; name: string }>();
function keepClip(id: number, url: string, name: string): void {
  clips.set(id, { url, name });
  while (clips.size > 20) {
    const [old, c] = clips.entries().next().value as [number, { url: string }];
    URL.revokeObjectURL(c.url);
    clips.delete(old);
  }
}
export const hasClip = (id: number): boolean => clips.has(id);

function wsUrl(code: string): string {
  const u = new URL(`./api/rooms/${code}/ws`, location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.href;
}

function send(msg: object): boolean {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

function connect(code: string): void {
  clearTimeout(retryTimer);
  closing = false;
  roomUi.code = code;
  roomUi.conn = retries ? "retrying" : "connecting";
  const sock = new WebSocket(wsUrl(code));
  sock.binaryType = "arraybuffer";
  ws = sock;
  sock.onopen = () => {
    retries = 0;
    roomUi.conn = "open";
    clearInterval(pingTimer);
    // Mantém a conexão viva no 4G (o Durable Object responde sem acordar a sala).
    pingTimer = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send("ping"), 25_000);
    rerender();
  };
  sock.onmessage = (e) => {
    if (typeof e.data !== "string") return onAudio(e.data as ArrayBuffer);
    if (e.data === "pong") return;
    try {
      onMessage(JSON.parse(e.data) as ServerMsg);
    } catch {
      // mensagem estranha: ignora
    }
  };
  sock.onclose = (e) => {
    if (ws !== sock) return; // conexão antiga
    ws = null;
    clearInterval(pingTimer);
    abortTalk();
    if (e.code >= 4000 && e.code < 4100) return finalClose(e.code);
    if (closing) return;
    // Queda de rede: tenta de novo, cada vez esperando mais.
    if (retries >= RETRY_MS.length) {
      roomUi.conn = "lost";
      return rerender();
    }
    roomUi.conn = "retrying";
    retryTimer = setTimeout(() => roomUi.code && connect(roomUi.code), RETRY_MS[retries++]);
    rerender();
  };
}

/** Fechamentos com motivo (o servidor mandou antes uma mensagem explicando). */
function finalClose(code: number): void {
  closing = true;
  roomUi.conn = "off";
  if (code === 4001 || code === 4006) roomUi.screen = "kicked";
  else if (code === 4002) roomUi.screen = roomUi.summary ? "summary" : "lobby";
  else {
    // 4003 cheia, 4004 não existe, 4005 aberta em outro lugar, 4007 saiu
    if (code === 4005) roomUi.error = "Você abriu essa sala em outro aparelho ou aba.";
    roomUi.screen = "lobby";
    roomUi.room = null;
  }
  rerender();
}

window.addEventListener("online", () => {
  if (roomUi.code && !ws && (roomUi.conn === "retrying" || roomUi.conn === "lost")) {
    retries = 0;
    connect(roomUi.code);
  }
});
document.addEventListener("visibilitychange", () => {
  // Voltou pro app (o iPhone derruba a conexão com a tela apagada): reconecta na hora.
  if (document.visibilityState === "visible" && roomUi.code && !ws && roomUi.screen === "room" && !closing) {
    retries = 0;
    connect(roomUi.code);
  }
});

onClipChange((name) => {
  roomUi.playing = name;
  const el = document.getElementById("room-status");
  if (el) rerender();
});

/* ---------- mensagens da sala ---------- */
let bannerTimer: ReturnType<typeof setTimeout> | undefined;
function showBanner(text: string): void {
  roomUi.banner = text;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    roomUi.banner = null;
    rerender();
  }, 5000);
}

function onMessage(m: ServerMsg): void {
  switch (m.t) {
    case "welcome":
      roomUi.you = m.you;
      roomUi.room = m.room;
      roomUi.log = m.log;
      roomUi.offset = m.room.now - Date.now();
      roomUi.screen = "room";
      roomUi.error = null;
      if (m.room.level === "iniciante" && !roomUi.helpers.length) shuffleHelpers();
      break;
    case "state": {
      const wasLive = roomUi.room?.phase === "live";
      roomUi.room = m.room;
      roomUi.offset = m.room.now - Date.now();
      if (!wasLive && m.room.phase === "live") deps.toast("Valendo! Só inglês daqui pra frente.", true);
      if (roomUi.talking === "asking" && m.room.floor?.name === roomUi.you) roomUi.talking = "recording";
      break;
    }
    case "turn":
      if (!roomUi.log.some((x) => x.id === m.entry.id)) roomUi.log.push(m.entry);
      if (m.entry.name === roomUi.you && pendingMine) {
        keepClip(m.entry.id, pendingMine, m.entry.name);
        pendingMine = null;
      }
      rerender();
      scrollLog();
      return;
    case "strike":
      if (m.name === roomUi.you) {
        showBanner(`Aviso ${m.strikes} de ${m.max}: só inglês aqui!`);
        navigator.vibrate?.(200);
      } else deps.toast(`${m.name} levou um aviso (português!)`);
      break;
    case "kicked":
      if (m.you) {
        roomUi.screen = "kicked";
        closing = true;
        abortTalk();
        stopClips();
      } else deps.toast(`${m.name} foi quitado da sala 😅`);
      break;
    case "denied":
      deps.toast(m.reason);
      if (roomUi.talking === "asking") abortTalk();
      break;
    case "summary":
      roomUi.summary = m.summary;
      roomUi.screen = "summary";
      closing = true;
      abortTalk();
      break;
    case "error":
      roomUi.error = m.message;
      break;
    case "pong":
      return;
  }
  rerender();
}

function onAudio(buf: ArrayBuffer): void {
  const f = decodeFrame(buf);
  const h = f?.header as AudioHeader | undefined;
  if (!f || h?.t !== "audio" || typeof h.mime !== "string" || !/^audio\//.test(h.mime)) return;
  const url = URL.createObjectURL(new Blob([f.audio.slice()], { type: h.mime }));
  keepClip(h.id, url, h.name);
  // Enquanto eu falo, não toca nada por cima (fica pro "ouvir de novo").
  if (roomUi.talking === "idle") enqueueClip(url, h.name);
}

function scrollLog(): void {
  requestAnimationFrame(() => {
    const el = document.getElementById("room-log");
    if (el) el.scrollTop = el.scrollHeight;
  });
}

/* ---------- apertar e falar ---------- */
interface Capture {
  hold: { stop(): Promise<HoldResult>; cancel(): void } | null;
  rec: Recording | null;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}
let capture: Capture | null = null;
/** URL do meu último áudio, esperando o "turn" pra virar "ouvir de novo". */
let pendingMine: string | null = null;

function abortTalk(): void {
  if (capture) {
    clearTimeout(capture.timer);
    capture.hold?.cancel();
    capture.rec?.cancel();
    capture = null;
  }
  if (roomUi.talking !== "idle") {
    roomUi.talking = "idle";
    roomUi.partial = "";
  }
}

/** Aperto do botão: pede a vez e já começa a gravar e transcrever (sem esperar a resposta). */
function pressStart(): void {
  const room = roomUi.room;
  if (roomUi.talking !== "idle" || capture || !room || room.phase !== "live") return;
  if (ws?.readyState !== WebSocket.OPEN) return deps.toast("Reconectando à sala…");
  if (room.floor && room.floor.name !== roomUi.you) return deps.toast(`${room.floor.name} está falando`);
  if (!canRecord() && !canListen) return deps.toast("Este navegador não grava áudio nem reconhece voz.");
  unlockAudio();
  stopClips();
  send({ t: "floor" });
  roomUi.talking = room.floor?.name === roomUi.you ? "recording" : "asking";
  roomUi.partial = "";
  // Reconhecimento primeiro: no iPhone ele só liga dentro do toque.
  capture = {
    hold: canListen ? listenHold((p) => updatePartial(p)) : null,
    rec: canRecord() ? record() : null,
    startedAt: Date.now(),
    // 15 s no máximo: solta sozinho um pouco antes do limite do servidor.
    timer: setTimeout(() => void pressEnd(), MAX_TURN_MS - 300),
  };
  navigator.vibrate?.(30);
  rerender();
}

function updatePartial(text: string): void {
  roomUi.partial = text;
  const el = document.getElementById("room-partial");
  if (el) el.textContent = text || "Ouvindo… fale em inglês";
}

/** Espera o servidor dar a vez (rede lenta) por até `ms`. */
async function waitFloor(ms: number): Promise<number | null> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const f = roomUi.room?.floor;
    if (f && f.name === roomUi.you) return f.id;
    if (roomUi.talking === "idle") return null; // negado no meio do caminho
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/** Soltou o botão: fecha a gravação e a transcrição e manda tudo num quadro só. */
async function pressEnd(): Promise<void> {
  const c = capture;
  if (!c) return;
  capture = null;
  clearTimeout(c.timer);
  if (Date.now() - c.startedAt < 400) {
    c.hold?.cancel();
    c.rec?.cancel();
    send({ t: "release" });
    roomUi.talking = "idle";
    deps.toast("Segure o botão enquanto fala");
    return rerender();
  }
  roomUi.talking = "sending";
  rerender();
  // Os dois terminam juntos; se um falhar, o outro vai sozinho.
  const [heard, clip] = await Promise.all([
    c.hold ? c.hold.stop() : Promise.resolve<HoldResult>({ text: "" }),
    c.rec ? c.rec.stop() : Promise.resolve(null),
  ]);
  const id = await waitFloor(2500);
  if (id === null) {
    roomUi.talking = "idle";
    deps.toast("Não deu pra pegar a vez. Tenta de novo.");
    return rerender();
  }
  let audio = clip?.audio ?? new Uint8Array();
  if (audio.length > MAX_AUDIO_BYTES) {
    audio = new Uint8Array();
    deps.toast("Áudio grande demais: foi só o texto");
  }
  const text = heard.text.slice(0, MAX_TEXT);
  if (!audio.length && !text) {
    send({ t: "release" });
    roomUi.talking = "idle";
    deps.toast(heard.error ?? "Não consegui gravar. Permita o microfone e tente de novo.");
    return rerender();
  }
  const header = {
    t: "turn",
    id,
    text,
    ...(heard.confidence ? { conf: Math.min(1, Math.max(0, heard.confidence)) } : {}),
    mime: audio.length ? clip!.mime : "",
    // Palpite daqui (quem decide o aviso é o servidor).
    pt: text ? detectPortuguese(text, heard.confidence).isPortuguese : false,
  };
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(encodeFrame(header, audio));
    if (audio.length) pendingMine = URL.createObjectURL(new Blob([audio.slice()], { type: clip!.mime }));
  } else deps.toast("A conexão caiu antes de enviar. Fala de novo quando voltar.");
  roomUi.noTranscript = !text;
  roomUi.talking = "idle";
  roomUi.partial = "";
  rerender();
}

// Ponteiro (dedo ou mouse): apertar e segurar. Ouvido no documento porque a tela é redesenhada.
document.addEventListener("pointerdown", (e) => {
  const btn = (e.target as Element).closest?.("[data-ptt]");
  if (!btn || e.button > 0) return;
  e.preventDefault();
  pressStart();
});
const release = (): void => {
  if (capture) void pressEnd();
};
document.addEventListener("pointerup", release);
document.addEventListener("pointercancel", release);
window.addEventListener("blur", release);
document.addEventListener("contextmenu", (e) => {
  if ((e.target as Element).closest?.("[data-ptt]")) e.preventDefault();
});
// Teclado: espaço segurado no botão funciona igual.
document.addEventListener("keydown", (e) => {
  if ((e.key === " " || e.key === "Enter") && (e.target as Element).closest?.("[data-ptt]")) {
    e.preventDefault();
    if (!e.repeat) pressStart();
  }
});
document.addEventListener("keyup", (e) => {
  if ((e.key === " " || e.key === "Enter") && (e.target as Element).closest?.("[data-ptt]")) release();
});

// Quem entrou pelo link não tocou em nada ainda: o primeiro toque na tela destrava o som
// (no iPhone, o áudio dos outros só toca depois disso).
const unlockOnTouch = (): void => {
  if (roomUi.code) unlockAudio();
};
document.addEventListener("touchend", unlockOnTouch, { passive: true });
document.addEventListener("click", unlockOnTouch);

// Entrar com código (o submit geral do app já cancela o envio da página).
document.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  if (form.dataset.form !== "room-join") return;
  const input = form.querySelector<HTMLInputElement>("#room-code");
  const code = normalizeCode(input?.value ?? "");
  if (!code) {
    roomUi.error = "O código tem 8 letras e números (ex.: ABCD 2345).";
    return rerender();
  }
  unlockAudio();
  joinRoom(code);
});

/* ---------- relógio ---------- */
/** Segundos que faltam (relógio do servidor). */
export function secondsLeft(room: RoomView | null): number {
  if (!room?.endsAt) return 0;
  return Math.max(0, Math.ceil((room.endsAt - (Date.now() + roomUi.offset)) / 1000));
}
export const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

setInterval(() => {
  const el = document.getElementById("room-clock");
  if (!el || roomUi.room?.phase !== "live") return;
  const sec = secondsLeft(roomUi.room);
  el.textContent = clock(sec);
  el.classList.toggle("low", sec <= 60);
}, 1000);

/* ---------- ações ---------- */
/** Entra numa sala pelo código (link de convite, campo "entrar" ou a futura lista de amigos). */
export function joinRoom(code: string): void {
  if (ws && roomUi.code === code) return rerender();
  leaveSilently();
  Object.assign(roomUi, { screen: "lobby", error: null, room: null, log: [], summary: null, banner: null, you: null, noTranscript: false, helpers: [] });
  retries = 0;
  connect(code);
  rerender();
}

function leaveSilently(): void {
  closing = true;
  clearTimeout(retryTimer);
  abortTalk();
  stopClips();
  if (ws) {
    const old = ws;
    ws = null;
    try {
      old.close(1000, "saiu");
    } catch {
      // já fechada
    }
  }
}

async function createRoom(): Promise<void> {
  if (roomUi.busy) return;
  roomUi.busy = true;
  roomUi.error = null;
  rerender();
  try {
    const res = await fetch("./api/rooms", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(roomUi.create),
    });
    const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
    roomUi.busy = false;
    if (!res.ok || !data.code) {
      roomUi.error = data.error ?? "Não deu pra criar a sala agora.";
      return rerender();
    }
    joinRoom(data.code);
  } catch {
    roomUi.busy = false;
    roomUi.error = "Sem conexão pra criar a sala.";
    rerender();
  }
}

async function shareRoom(): Promise<void> {
  const code = roomUi.code;
  if (!code) return;
  const url = roomLink(code);
  const text = `Bora treinar inglês ao vivo no Papo Reto? Só inglês, hein! Código: ${code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Sala ao vivo · Papo Reto", text, url });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }
  await copyLink();
}

async function copyLink(): Promise<void> {
  if (!roomUi.code) return;
  try {
    await navigator.clipboard.writeText(roomLink(roomUi.code));
    deps.toast("Link copiado — mande pros amigos", true);
  } catch {
    (document.getElementById("room-link") as HTMLInputElement | null)?.select();
    deps.toast("Selecionei o link — copie com segurar e Copiar");
  }
}

/** Pede o microfone (e o reconhecimento de voz) antes de valer, num toque de verdade. */
async function primeMic(): Promise<void> {
  unlockAudio();
  const hold = canListen ? listenHold(() => {}) : null;
  const rec = canRecord() ? record() : null;
  const ok = rec ? await rec.ready : canListen;
  setTimeout(() => {
    hold?.cancel();
    rec?.cancel();
  }, 600);
  roomUi.micReady = ok;
  deps.toast(ok ? "Microfone liberado" : "Sem permissão pro microfone. Libere nos ajustes do navegador.", ok);
  rerender();
}

function backToLobby(): void {
  leaveSilently();
  Object.assign(roomUi, { screen: "lobby", code: null, room: null, log: [], summary: null, banner: null, conn: "off", error: null });
  rerender();
}

export const roomActions: Record<string, (el: HTMLElement) => void> = {
  "room-size": (el) => {
    roomUi.create.size = el.dataset.size === "4" ? 4 : 2;
    rerender();
  },
  "room-level": (el) => {
    roomUi.create.level = el.dataset.level as RoomLevel;
    rerender();
  },
  "room-create": () => {
    unlockAudio();
    void createRoom();
  },
  "room-share": () => void shareRoom(),
  "room-copy": () => void copyLink(),
  "room-start": () => {
    unlockAudio();
    send({ t: "start" });
  },
  "room-topic": () => send({ t: "topic" }),
  "room-mic": () => void primeMic(),
  "room-helpers": () => {
    shuffleHelpers();
    rerender();
  },
  "room-replay": (el) => {
    const c = clips.get(Number(el.dataset.id));
    if (c) {
      unlockAudio();
      playClipNow(c.url, c.name);
    }
  },
  "room-retry": () => {
    if (!roomUi.code) return;
    retries = 0;
    connect(roomUi.code);
    rerender();
  },
  "room-leave": () => {
    send({ t: "leave" });
    backToLobby();
  },
  "room-lobby": () => backToLobby(),
};
