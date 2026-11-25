import { firstTrackOf, type ListenItem, type Playlist } from "./playlist";
import { plain } from "./html";

/**
 * Player do modo "Ouvir no carro": um único <audio> que encadeia os arquivos no evento `ended`.
 * Nada de setTimeout nem voz do sistema — no iPhone com a tela bloqueada os dois param.
 * As pausas são arquivos de silêncio (veja SILENCE em spoken.ts).
 *
 * A Media Session põe a frase na tela de bloqueio e liga os botões do fone/carro (tocar, pausar,
 * próxima, anterior). O Wake Lock (opcional) mantém a tela acesa, quando o aparelho deixa.
 */

export interface CarStatus {
  playlist: Playlist | null;
  /** Posição na fila de arquivos. */
  pos: number;
  /** Item na tela (frase ou fala). */
  item: number;
  playing: boolean;
  ended: boolean;
}

const audio = typeof Audio !== "undefined" ? new Audio() : null;
const session = typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;

let playlist: Playlist | null = null;
let pos = 0;
let playing = false;
let ended = false;
let rate = 1;
let failures = 0;
/** Trocando de arquivo: o `pause` que o navegador dispara nessa hora não é a pessoa pausando. */
let switching = false;
let onChange: () => void = () => {};

export const carStatus = (): CarStatus => ({
  playlist,
  pos,
  item: playlist?.tracks[pos]?.item ?? 0,
  playing,
  ended,
});

/** Quem desenha a tela quer saber quando a frase muda ou o player para. */
export const onCarChange = (fn: () => void): void => {
  onChange = fn;
};

/** Troca a lista. Começa no item `item` e só toca se `autoplay` (precisa vir de um toque, no iPhone). */
export function loadPlaylist(pl: Playlist, item = 0, autoplay = false): void {
  playlist = pl;
  ended = false;
  pos = firstTrackOf(pl, Math.min(item, Math.max(pl.items.length - 1, 0)));
  if (autoplay) playTrack();
  else {
    pause();
    if (audio) audio.removeAttribute("src");
  }
  updateMetadata();
}

export function play(): void {
  if (!playlist?.tracks.length) return;
  if (ended || pos >= playlist.tracks.length) {
    ended = false;
    pos = 0;
  }
  // Retoma do ponto em que parou se o arquivo ainda está carregado.
  if (audio?.getAttribute("src") && !audio.ended) {
    playing = true;
    applyRate();
    audio.play().catch(blocked);
    setState();
    return;
  }
  playTrack();
}

export function pause(): void {
  playing = false;
  audio?.pause();
  releaseWake();
  setState();
}

export const toggle = (): void => (playing ? pause() : play());

/** Pula pro começo do item seguinte (+1) ou anterior (-1). "Anterior" no meio do item volta pro começo dele. */
export function skip(dir: 1 | -1): void {
  if (!playlist?.tracks.length) return;
  const item = playlist.tracks[pos]?.item ?? playlist.items.length - 1;
  let target = item + dir;
  if (dir < 0 && pos > firstTrackOf(playlist, item)) target = item;
  target = Math.min(Math.max(target, 0), playlist.items.length - 1);
  pos = firstTrackOf(playlist, target);
  ended = false;
  if (playing) playTrack();
  else {
    audio?.removeAttribute("src");
    updateMetadata();
    setState();
  }
}

/** Vai direto pra um item (tocar na lista). */
export function jump(item: number): void {
  if (!playlist) return;
  pos = firstTrackOf(playlist, item);
  ended = false;
  playTrack();
}

/** Para tudo e esquece a lista (sair da tela). */
export function stopCar(): void {
  pause();
  audio?.removeAttribute("src");
  playlist = null;
  ended = false;
  if (session) session.metadata = null;
}

/** Devagar = 0,85 com o tom preservado (a voz não fica grave). */
export function setSlow(slow: boolean): void {
  rate = slow ? 0.85 : 1;
  applyRate();
}

function applyRate(): void {
  if (!audio) return;
  audio.preservesPitch = true;
  // O Safari volta pro defaultPlaybackRate a cada arquivo novo: os dois precisam do valor.
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
}

function playTrack(): void {
  const track = playlist?.tracks[pos];
  if (!audio || !track) return finish();
  const changed = audio.dataset.item !== String(track.item);
  playing = true;
  audio.dataset.item = String(track.item);
  switching = true;
  audio.src = track.src;
  applyRate();
  audio.play().catch(blocked);
  if (changed) updateMetadata();
  setState();
  void keepAwake();
  onChange();
}

function finish(): void {
  playing = false;
  ended = true;
  pos = playlist?.tracks.length ?? 0;
  releaseWake();
  setState();
  onChange();
}

/**
 * play() recusado. Sem toque da pessoa (NotAllowedError) só pausa; arquivo que não carregou
 * é tratado pelo evento `error`, e AbortError é só a troca rápida de arquivo.
 */
function blocked(e: unknown): void {
  if ((e as { name?: string } | null)?.name !== "NotAllowedError") return;
  switching = false;
  pause();
  onChange();
}

/** Arquivo que não carregou (sem internet e fora do cache): pula, mas não fica em loop se tudo falhar. */
function failed(): void {
  switching = false;
  if (!playing) return;
  if (++failures > 3) {
    failures = 0;
    pause();
    onChange();
    return;
  }
  pos++;
  playTrack();
}

if (audio) {
  audio.preload = "auto";
  audio.addEventListener("ended", () => {
    if (!playing) return;
    failures = 0;
    pos++;
    playTrack();
  });
  audio.addEventListener("error", () => failed());
  audio.addEventListener("playing", () => {
    switching = false;
    failures = 0;
    setPosition();
  });
  audio.addEventListener("loadedmetadata", setPosition);
  // Pausou por fora (fone desconectado, ligação, Siri): reflete na tela.
  audio.addEventListener("pause", () => {
    if (playing && !switching && !audio.ended && audio.getAttribute("src")) {
      playing = false;
      releaseWake();
      setState();
      onChange();
    }
  });
}

/* ---------- tela de bloqueio, fone e carro ---------- */
function current(): ListenItem | undefined {
  const t = playlist?.tracks[pos];
  return t ? playlist!.items[t.item] : undefined;
}

function updateMetadata(): void {
  const it = current();
  if (!session || typeof MediaMetadata === "undefined") return;
  if (!it) {
    session.metadata = null;
    return;
  }
  const art = new URL("./icons/icon-512.png", location.href).href;
  session.metadata = new MediaMetadata({
    title: plain(it.en),
    artist: "Papo Reto",
    album: it.album,
    artwork: [{ src: art, sizes: "512x512", type: "image/png" }],
  });
}

function setState(): void {
  if (session) session.playbackState = playing ? "playing" : playlist ? "paused" : "none";
}

function setPosition(): void {
  if (!session?.setPositionState || !audio || !Number.isFinite(audio.duration)) return;
  try {
    session.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) });
  } catch {
    // alguns navegadores recusam valores no meio da troca de arquivo; não faz falta
  }
}

if (session) {
  const on = (action: MediaSessionAction, fn: () => void): void => {
    try {
      session.setActionHandler(action, fn);
    } catch {
      // ação não suportada neste navegador
    }
  };
  on("play", () => {
    play();
    onChange();
  });
  on("pause", () => {
    pause();
    onChange();
  });
  on("nexttrack", () => skip(1));
  on("previoustrack", () => skip(-1));
  on("stop", () => {
    pause();
    onChange();
  });
}

/* ---------- tela acesa (opcional) ---------- */
let awake = false;
let lock: WakeLockSentinel | null = null;

export const wakeLockAvailable = typeof navigator !== "undefined" && "wakeLock" in navigator;

export function setAwake(on: boolean): void {
  awake = on;
  if (on) void keepAwake();
  else releaseWake();
}

async function keepAwake(): Promise<void> {
  if (!awake || !playing || lock || !wakeLockAvailable || document.visibilityState !== "visible") return;
  try {
    lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => (lock = null));
  } catch {
    lock = null; // modo economia de bateria ou navegador sem suporte: segue sem
  }
}

function releaseWake(): void {
  void lock?.release().catch(() => {});
  lock = null;
}

// O sistema solta o Wake Lock quando a página some; pega de volta ao voltar.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => void keepAwake());
}
