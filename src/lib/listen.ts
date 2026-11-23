/**
 * Reconhecimento de fala do próprio navegador (Chrome/Android, Safari/iPhone, Edge).
 * A pessoa fala, e o texto aparece ao vivo. Onde não existir, o app mostra uma caixa
 * de texto, e o microfone do teclado do celular (ditado) faz o mesmo papel.
 */
interface RecognitionAlternative { transcript: string }
interface RecognitionResult { isFinal: boolean; length: number; [i: number]: RecognitionAlternative }
interface RecognitionEvent { resultIndex: number; results: { length: number; [i: number]: RecognitionResult } }
interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

const Ctor: RecognitionCtor | undefined =
  typeof window === "undefined"
    ? undefined
    : ((window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition);

export const canListen = Ctor !== undefined;

export interface ListenHandlers {
  /** Texto parcial enquanto a pessoa fala. */
  onPartial(text: string): void;
  /** Transcrições finais (a primeira é a mais provável). */
  onDone(alternatives: string[]): void;
  onError(message: string): void;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Permita o uso do microfone pra praticar falando.",
  "service-not-allowed": "Permita o uso do microfone pra praticar falando.",
  "no-speech": "Não ouvi nada. Toque no microfone e fale.",
  "audio-capture": "Nenhum microfone encontrado.",
  network: "O reconhecimento de voz precisa de internet neste aparelho.",
};

/** Silêncio depois da última palavra que encerra a escuta (o Safari às vezes não encerra sozinho). */
const SILENCE_MS = 1600;
/** Sem ouvir nada nesse tempo, desiste e libera o botão. */
const NOTHING_MS = 8000;

let active: { rec: Recognition; finish: (deliver: boolean) => void } | null = null;

/**
 * Começa a ouvir; devolve uma função que encerra na hora (entregando o que já ouviu).
 * Feito pra nunca ficar preso em "ouvindo": encerra por silêncio, tem tempo limite e
 * entrega o resultado mesmo se o navegador não disparar o fim (acontece no iPhone).
 */
export function listen(h: ListenHandlers): () => void {
  if (!Ctor) {
    h.onError("Este navegador não reconhece voz. Use o microfone do teclado.");
    return () => {};
  }
  // Uma escuta por vez: a anterior é descartada antes de começar outra.
  active?.finish(false);

  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  rec.continuous = false;

  let finals: string[] = [];
  let partial = "";
  let done = false;
  let silence: ReturnType<typeof setTimeout> | undefined;
  const nothing = setTimeout(() => finish(true), NOTHING_MS);

  function finish(deliver: boolean, error?: string): void {
    if (done) return;
    done = true;
    clearTimeout(silence);
    clearTimeout(nothing);
    rec.onresult = rec.onerror = rec.onend = null;
    try {
      rec.abort();
    } catch {
      // já tinha parado
    }
    if (active?.rec === rec) active = null;
    if (!deliver) return;
    if (error) return h.onError(error);
    const alts = finals.length ? finals : partial.trim() ? [partial.trim()] : [];
    if (alts.length) h.onDone(alts);
    else h.onError(ERRORS["no-speech"]!);
  }

  rec.onresult = (e) => {
    partial = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) finals = Array.from({ length: r.length }, (_, k) => r[k]!.transcript.trim()).filter(Boolean);
      else partial += r[0]!.transcript;
    }
    h.onPartial(partial || finals[0] || "");
    clearTimeout(nothing);
    clearTimeout(silence);
    silence = setTimeout(() => finish(true), SILENCE_MS);
  };
  rec.onerror = (e) => {
    if (e.error === "aborted") return;
    finish(true, ERRORS[e.error] ?? "Não consegui ouvir. Toque no microfone de novo.");
  };
  rec.onend = () => finish(true);

  active = { rec, finish };
  try {
    rec.start();
  } catch {
    finish(true, "O microfone ainda estava ocupado. Toque de novo.");
  }
  return () => finish(true);
}

/** Cancela a escuta atual sem entregar resultado (ao trocar de tela, por exemplo). */
export function cancelListening(): void {
  active?.finish(false);
}

const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);

/** O que dizer quando o reconhecimento devolve português. */
export const PORTUGUESE_HELP = isIOS
  ? "Entendi em português. No iPhone, o microfone usa os idiomas do Ditado: vá em Ajustes → Geral → Teclado → Teclados → Adicionar Teclado → English (US). Depois toque no microfone de novo."
  : "Entendi em português. Fale a frase em inglês e toque no microfone de novo.";

/**
 * A transcrição parece português? Acontece quando o iPhone usa o idioma do Ditado
 * em vez do inglês pedido pelo app.
 */
export function looksPortuguese(text: string): boolean {
  if (/[ãõçáéíóúâêôà]/i.test(text)) return true;
  const pt = text.toLowerCase().match(/\b(você|voce|não|nao|que|pra|para|tá|ta|eu|um|uma|é|tô|to|com|isso|esse|meu|minha|obrigado|oi)\b/g) ?? [];
  const en = text.toLowerCase().match(/\b(i|you|the|a|to|is|it|can|my|me|we|and|what|that|get|go)\b/g) ?? [];
  return pt.length >= 2 && pt.length > en.length;
}
