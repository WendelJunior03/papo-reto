/**
 * Gravação e reprodução das Salas ao vivo (walkie-talkie).
 *
 * Gravação: o microfone é aberto a cada aperto e fechado ao soltar. Manter aberto daria
 * menos atraso, mas no iPhone o microfone ligado joga o som pro alto-falante de ligação
 * (baixinho) e briga com o reconhecimento de voz. Assim, entre uma fala e outra o
 * aparelho fica como um player normal.
 *
 * Reprodução: um único <audio>, destravado num toque (o iPhone só deixa tocar som
 * sem toque num elemento que já tocou a partir de um toque).
 */

export interface Clip {
  audio: Uint8Array;
  /** Tipo sem parâmetros ("audio/mp4", "audio/webm"). */
  mime: string;
}

export interface Recording {
  /** true quando o microfone abriu e a gravação começou. */
  ready: Promise<boolean>;
  stop(): Promise<Clip | null>;
  cancel(): void;
}

/** mp4 primeiro: é o que o Safari grava e o que todo navegador toca. */
const MIMES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

export const canRecord = (): boolean =>
  typeof MediaRecorder !== "undefined" && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

function pickMime(): string {
  return MIMES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
}

/** Começa a gravar já (chame no aperto do botão). Nunca lança: falhou, `stop()` devolve null. */
export function record(): Recording {
  let rec: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let cancelled = false;
  const chunks: Blob[] = [];
  const release = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };

  const ready = navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })
    .then((s) => {
      stream = s;
      if (cancelled) {
        release();
        return false;
      }
      const mime = pickMime();
      rec = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      // Em pedaços de 1 s: alguns Safaris não entregam nada quando gravam sem pedaços.
      rec.start(1000);
      return true;
    })
    .catch(() => false);

  return {
    ready,
    async stop() {
      if (!(await ready) || !rec) {
        release();
        return null;
      }
      const r = rec;
      if (r.state !== "inactive") {
        await new Promise<void>((resolve) => {
          r.onstop = () => resolve();
          try {
            r.stop();
          } catch {
            resolve();
          }
          setTimeout(resolve, 1500);
        });
      }
      release();
      const type = (r.mimeType || pickMime() || "audio/mp4").split(";")[0]!.trim();
      if (!chunks.length) return null;
      const blob = new Blob(chunks, { type });
      return { audio: new Uint8Array(await blob.arrayBuffer()), mime: type };
    },
    cancel() {
      cancelled = true;
      try {
        if (rec && rec.state !== "inactive") rec.stop();
      } catch {
        // já tinha parado
      }
      release();
    },
  };
}

/* ---------- reprodução em fila ---------- */
let el: HTMLAudioElement | null = null;
const queue: { url: string; name: string }[] = [];
let onChange: (playing: string | null) => void = () => {};
let playing: string | null = null;

function player(): HTMLAudioElement {
  if (el) return el;
  el = new Audio();
  el.setAttribute("playsinline", "");
  el.onended = el.onerror = () => next();
  return el;
}

/** WAV de silêncio (100 ms) feito na hora: o CSP não deixa data: no áudio, blob: sim. */
function silentUrl(): string {
  const n = 800;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  v.setUint32(4, 36 + n, true);
  w(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  w(36, "data");
  v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

let unlocked = false;
/** Chame dentro de um toque (criar/entrar na sala, apertar o botão). */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  const a = player();
  if (playing) return;
  a.src = silentUrl();
  a.play().catch(() => {
    unlocked = false;
  });
}

function next(): void {
  const item = queue.shift();
  playing = item?.name ?? null;
  onChange(playing);
  if (!item) return;
  const a = player();
  a.src = item.url;
  a.play().catch(() => next());
}

/** Põe a fala na fila (toca na hora se nada estiver tocando). */
export function enqueueClip(url: string, name: string): void {
  queue.push({ url, name });
  if (!playing) next();
}

/** Toca uma fala agora (botão "ouvir de novo"), passando na frente da fila. */
export function playClipNow(url: string, name: string): void {
  queue.unshift({ url, name });
  next();
}

/** Para tudo (quem vai falar não quer ouvir ninguém por cima). */
export function stopClips(): void {
  queue.length = 0;
  el?.pause();
  if (playing) {
    playing = null;
    onChange(null);
  }
}

export const onClipChange = (fn: (playing: string | null) => void): void => {
  onChange = fn;
};
