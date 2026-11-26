/**
 * Reconhecimento de fala do próprio navegador (Chrome/Android, Safari/iPhone, Edge).
 * A pessoa fala, e o texto aparece ao vivo. Onde não existir, o app mostra uma caixa
 * de texto, e o microfone do teclado do celular (ditado) faz o mesmo papel.
 */
interface RecognitionAlternative { transcript: string; confidence?: number }
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
/** Quanto esperar o reconhecedor anterior soltar o microfone antes de começar de novo. */
const RELEASE_MS = 1200;

/**
 * Um único reconhecedor, reaproveitado a cada fala. No iPhone, criar um novo enquanto o
 * anterior ainda está soltando o microfone faz a segunda escuta falhar ("Tentar de novo").
 */
let rec: Recognition | null = null;
let running = false;
let ended: (() => void) | null = null;
/** Quem recebe os eventos da escuta atual (as anteriores são ignoradas). */
let current: { onResult: (e: RecognitionEvent) => void; onError: (code: string) => void; onEnd: () => void } | null = null;

/**
 * O reconhecedor da vez. Com o anterior já parado, cria um novo a cada escuta: no iPhone,
 * reaproveitar o mesmo depois da primeira fala às vezes não ouve mais nada (a 2ª vez "morre").
 * Enquanto o anterior ainda solta o microfone, reaproveita (criar outro aí é que dá conflito).
 */
function recognizer(): Recognition {
  if (rec && running) return rec;
  if (rec) {
    rec.onresult = rec.onerror = rec.onend = null;
    try {
      rec.abort();
    } catch {
      // já estava parado
    }
  }
  rec = new Ctor!();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  rec.continuous = false;
  rec.onresult = (e) => current?.onResult(e);
  rec.onerror = (e) => current?.onError(e.error);
  rec.onend = () => {
    running = false;
    ended?.();
    ended = null;
    current?.onEnd();
  };
  return rec;
}

/** Espera o reconhecedor terminar de verdade (ou desiste depois de um tempo). */
function whenReleased(): Promise<void> {
  if (!running) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      running = false;
      resolve();
    }, RELEASE_MS);
    ended = () => {
      clearTimeout(t);
      resolve();
    };
  });
}

function tryStart(r: Recognition): boolean {
  try {
    r.start();
    running = true;
    return true;
  } catch {
    return false;
  }
}

let finishCurrent: ((deliver: boolean) => void) | null = null;

/**
 * Começa a ouvir; devolve uma função que encerra na hora (entregando o que já ouviu).
 * Feito pra nunca ficar preso em "ouvindo": encerra por silêncio, tem tempo limite e
 * entrega o resultado mesmo se o navegador não disparar o fim (acontece no iPhone).
 * Chame dentro do toque do usuário: o iPhone só libera o microfone nesse momento.
 */
export function listen(h: ListenHandlers): () => void {
  if (!Ctor) {
    h.onError("Este navegador não reconhece voz. Use o microfone do teclado.");
    return () => {};
  }
  // Uma escuta por vez: a anterior é descartada (sem entregar resultado).
  finishCurrent?.(false);
  const r = recognizer();

  let finals: string[] = [];
  let partial = "";
  let done = false;
  let silence: ReturnType<typeof setTimeout> | undefined;
  let nothing: ReturnType<typeof setTimeout> | undefined;

  function finish(deliver: boolean, error?: string): void {
    if (done) return;
    done = true;
    clearTimeout(silence);
    clearTimeout(nothing);
    if (current === session) current = null;
    if (finishCurrent === finish) finishCurrent = null;
    // Pede pra parar (sem forçar): o microfone é solto do jeito que o Safari espera.
    if (running) {
      try {
        r.stop();
      } catch {
        // já tinha parado
      }
    }
    if (!deliver) return;
    if (error) return h.onError(error);
    const alts = finals.length ? finals : partial.trim() ? [partial.trim()] : [];
    if (alts.length) h.onDone(alts);
    else h.onError(ERRORS["no-speech"]!);
  }

  const session = {
    onResult(e: RecognitionEvent) {
      partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) finals = Array.from({ length: res.length }, (_, k) => res[k]!.transcript.trim()).filter(Boolean);
        else partial += res[0]!.transcript;
      }
      h.onPartial(partial || finals[0] || "");
      clearTimeout(nothing);
      clearTimeout(silence);
      silence = setTimeout(() => finish(true), SILENCE_MS);
    },
    onError(code: string) {
      if (code === "aborted") return;
      finish(true, ERRORS[code] ?? `Não consegui ouvir (${code}). Toque no microfone de novo.`);
    },
    onEnd() {
      finish(true);
    },
  };

  function begin(): void {
    if (done) return;
    current = session;
    r.continuous = false; // a escuta "segurando" (Salas ao vivo) liga o contínuo
    nothing = setTimeout(() => finish(true), NOTHING_MS);
    if (tryStart(r)) return;
    // O iPhone ainda não soltou o microfone: espera um pouco e tenta mais uma vez.
    setTimeout(() => {
      if (done) return;
      if (!tryStart(r)) finish(true, "O microfone ainda estava ocupado (start). Toque de novo.");
    }, 400);
  }

  finishCurrent = finish;
  // Começa já, dentro do toque, quando o reconhecedor está livre (o caso normal).
  if (!running) begin();
  else void whenReleased().then(begin);
  return () => finish(true);
}

export interface HoldResult {
  text: string;
  /** Média da confiança das partes finais (o Safari às vezes manda 0 = desconhecida). */
  confidence?: number;
  error?: string;
}

/**
 * Escuta enquanto o botão estiver apertado (Salas ao vivo, walkie-talkie). Usa o MESMO
 * reconhecedor da escuta normal (no iPhone, dois ao mesmo tempo brigam pelo microfone).
 * Sem tempo limite por silêncio: quem decide o fim é o soltar do botão. Se o navegador
 * encerrar sozinho no meio (pausa longa, iPhone), religa enquanto o botão estiver apertado.
 * Nunca trava: `stop()` sempre resolve, no máximo RELEASE_MS depois, com o que ouviu.
 */
export function listenHold(onPartial: (text: string) => void): { stop(): Promise<HoldResult>; cancel(): void } {
  if (!Ctor) return { stop: () => Promise.resolve({ text: "", error: "Este navegador não reconhece voz." }), cancel: () => {} };
  finishCurrent?.(false);
  const r = recognizer();

  let kept: string[] = []; // partes de escutas anteriores (quando religou)
  let finals: string[] = [];
  let partial = "";
  const confs: number[] = [];
  let error: string | undefined;
  let held = true;
  let done = false;
  let restarts = 0;
  let onFinished: (() => void) | null = null;

  const text = (): string => [...kept, ...finals.filter(Boolean), partial].join(" ").replace(/\s+/g, " ").trim();
  const result = (): HoldResult => {
    const t = text();
    const conf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : undefined;
    return { text: t, confidence: conf, error: t ? undefined : error };
  };

  function finish(): void {
    if (done) return;
    done = true;
    held = false;
    if (current === session) current = null;
    if (finishCurrent === cancelHold) finishCurrent = null;
    if (running) {
      try {
        r.stop();
      } catch {
        // já tinha parado
      }
    }
    onFinished?.();
  }
  const cancelHold = (): void => finish();

  const session = {
    onResult(e: RecognitionEvent) {
      partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) {
          finals[i] = res[0]!.transcript.trim();
          if (res[0]!.confidence) confs.push(res[0]!.confidence);
        } else partial += res[0]!.transcript;
      }
      onPartial(text());
    },
    onError(code: string) {
      if (code === "aborted" || code === "no-speech") return;
      error = ERRORS[code] ?? `Não consegui ouvir (${code}).`;
    },
    onEnd() {
      if (held && !done && restarts < 3) {
        // Encerrou sozinho com o botão ainda apertado: guarda o que já ouviu e religa.
        kept = [...kept, ...finals.filter(Boolean), ...(partial.trim() ? [partial.trim()] : [])];
        finals = [];
        partial = "";
        restarts++;
        if (tryStart(r)) return;
      }
      finish();
    },
  };

  function begin(): void {
    if (done) return;
    if (!held) return finish(); // soltou antes de o microfone liberar
    current = session;
    r.continuous = true;
    if (tryStart(r)) return;
    setTimeout(() => {
      if (done) return;
      if (!tryStart(r)) {
        error = "O microfone estava ocupado.";
        finish();
      }
    }, 400);
  }

  finishCurrent = cancelHold;
  if (!running) begin();
  else void whenReleased().then(begin);

  return {
    stop: () =>
      new Promise<HoldResult>((resolve) => {
        held = false;
        if (done) return resolve(result());
        onFinished = () => resolve(result());
        if (!running) return finish();
        try {
          r.stop(); // o onend entrega (com as últimas palavras)
        } catch {
          finish();
        }
        setTimeout(finish, RELEASE_MS); // o Safari às vezes não dispara o fim
      }),
    cancel: cancelHold,
  };
}

/** Cancela a escuta atual sem entregar resultado (ao trocar de tela, por exemplo). */
export function cancelListening(): void {
  finishCurrent?.(false);
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
