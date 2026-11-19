import { audioFile, spokenText } from "./spoken";

/**
 * Áudio: toca o arquivo gravado (public/audio, gerado por `bun run audio`).
 * Se o arquivo faltar ou não carregar, cai para a voz do próprio aparelho.
 *
 * Um único <audio> reaproveitado: no iPhone, depois do primeiro toque ele fica
 * "liberado" e consegue tocar a cena inteira em sequência. E diferente da voz
 * do sistema, não é silenciado pela chave de silencioso.
 */
const player = typeof Audio !== "undefined" ? new Audio() : null;
let queue: string[] = [];
let queueSlow = false;

export const speechAvailable = typeof window !== "undefined" && "speechSynthesis" in window;

export function play(text: string, slow = false): void {
  playSequence([text], slow);
}

export function playSequence(texts: string[], slow = false): void {
  stop();
  queue = [...texts];
  queueSlow = slow;
  next();
}

export function stop(): void {
  queue = [];
  seq++;
  if (player) {
    player.onended = player.onerror = null;
    player.pause();
  }
  if (speechAvailable) speechSynthesis.cancel();
}

/** Cada toque invalida os anteriores: um play() interrompido não pode disparar a reserva. */
let seq = 0;

function next(): void {
  const text = queue.shift();
  if (text === undefined) return;
  if (!player) return fallback(text);

  const token = ++seq;
  const fail = (): void => {
    if (token === seq) {
      seq++;
      fallback(text);
    }
  };
  player.onended = () => token === seq && next();
  player.onerror = fail;
  player.src = audioFile(text);
  player.preservesPitch = true;
  player.playbackRate = queueSlow ? 0.72 : 1;
  player.play().catch(fail);
}

/** Fala um texto que não tem arquivo gravado (respostas da IA) direto com a voz do aparelho. */
export function speakTts(text: string, slow = false): void {
  stop();
  queueSlow = slow;
  fallback(text);
}

/* ---------- reserva: voz do aparelho ---------- */
const PREFERRED = /Samantha|Ava|Allison|Google US English|Aria|Jenny|Zira/i;
let voice: SpeechSynthesisVoice | undefined;

function pickVoice(): void {
  const voices = speechSynthesis.getVoices();
  voice =
    voices.find((v) => /en[-_]US/i.test(v.lang) && PREFERRED.test(v.name)) ??
    voices.find((v) => /en[-_]US/i.test(v.lang)) ??
    voices.find((v) => /^en/i.test(v.lang));
}

if (speechAvailable) {
  pickVoice();
  speechSynthesis.addEventListener("voiceschanged", pickVoice);
}

function fallback(text: string): void {
  if (player) player.onended = player.onerror = null;
  if (!speechAvailable) return next();
  const u = new SpeechSynthesisUtterance(spokenText(text));
  u.lang = "en-US";
  u.rate = queueSlow ? 0.7 : 0.95;
  if (voice) u.voice = voice;
  const token = seq;
  u.onend = () => token === seq && next();
  speechSynthesis.cancel();
  speechSynthesis.resume();
  // O Chrome descarta uma fala enviada no mesmo tique de um cancel().
  setTimeout(() => speechSynthesis.speak(u), 60);
}
