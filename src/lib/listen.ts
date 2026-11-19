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

/** Começa a ouvir; devolve uma função pra parar. */
export function listen(h: ListenHandlers): () => void {
  if (!Ctor) {
    h.onError("Este navegador não reconhece voz. Use o microfone do teclado.");
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  rec.continuous = false;

  let finals: string[] = [];
  let partial = "";
  let failed = false;

  rec.onresult = (e) => {
    partial = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) {
        finals = Array.from({ length: r.length }, (_, k) => r[k]!.transcript.trim());
      } else {
        partial += r[0]!.transcript;
      }
    }
    h.onPartial(partial || finals[0] || "");
  };
  rec.onerror = (e) => {
    if (e.error === "aborted") return;
    failed = true;
    h.onError(ERRORS[e.error] ?? "Não consegui ouvir. Tenta de novo.");
  };
  rec.onend = () => {
    if (failed) return;
    const alts = finals.length ? finals : partial ? [partial.trim()] : [];
    if (alts.length) h.onDone(alts);
    else h.onError(ERRORS["no-speech"]!);
  };
  rec.start();
  return () => rec.stop();
}
