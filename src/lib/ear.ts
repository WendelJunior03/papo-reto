/**
 * Palavras que a pessoa errou nas músicas viram revisão (modo "Músicas" do Treinar).
 * A chave é só a palavra normalizada ("don't", "heart"): a mesma palavra errada em
 * duas músicas é um card só, com o trecho da música mais recente.
 */
import type { DateKey } from "./dates";
import { tokenize } from "./lyrics";
import { dueIds, grade, type CardState } from "./srs";

export interface EarWord {
  word: string;
  /** A linha da letra onde a palavra apareceu (só ela, nunca a letra inteira). */
  line: string;
  title: string;
  videoId: string;
  /** Início da linha na música, em segundos. */
  t: number;
  card: CardState;
  /** Último dia em que a palavra foi errada (pra saber quais são as mais antigas). */
  seen: DateKey;
}

export type EarWords = Record<string, EarWord>;

/** Limite de palavras guardadas (o progresso inteiro vai pro servidor). */
export const MAX_EAR = 300;
/** Tamanho máximo do trecho e do título guardados. */
const MAX_LINE = 120;
const MAX_TITLE = 80;
/** Quantos cards entram num treino de músicas. */
export const EAR_DECK = 15;

export const earKey = (w: string): string => w.toLowerCase().replace(/[^a-z']/g, "");

export interface EarAnswer {
  word: string;
  line: string;
  title: string;
  videoId: string;
  t: number;
}

/**
 * Resposta numa lacuna de música: erro guarda (ou volta pro começo) a palavra;
 * acerto só conta pra quem já está na revisão e venceu hoje (o refrão repetido
 * não pode subir a palavra várias caixas de uma vez).
 */
export function earAnswer(ear: EarWords, a: EarAnswer, ok: boolean, today: DateKey): void {
  const key = earKey(a.word);
  if (!key) return;
  const prev = ear[key];
  if (ok) {
    if (prev && prev.card.due <= today) prev.card = grade(prev.card, true, today);
    return;
  }
  ear[key] = {
    word: key,
    line: a.line.slice(0, MAX_LINE),
    title: a.title.slice(0, MAX_TITLE),
    videoId: a.videoId,
    t: Math.round(a.t * 10) / 10,
    card: grade(prev?.card, false, today),
    seen: today,
  };
  capEar(ear);
}

/** Passou do limite: sai primeiro quem está mais dominado e, no empate, o mais antigo. */
export function capEar(ear: EarWords, max = MAX_EAR): void {
  const keys = Object.keys(ear);
  if (keys.length <= max) return;
  keys
    .sort((a, b) => ear[b]!.card.box - ear[a]!.card.box || ear[a]!.seen.localeCompare(ear[b]!.seen))
    .slice(0, keys.length - max)
    .forEach((k) => delete ear[k]);
}

/** Palavras vencidas, mais atrasadas primeiro. */
export const earDue = (ear: EarWords, today: DateKey, limit = Infinity): string[] =>
  dueIds(Object.fromEntries(Object.entries(ear).map(([k, e]) => [k, e.card])), today).slice(0, limit);

/** Divide a linha em volta da palavra (pra mostrar a lacuna ou o grifo). Sem achar, devolve null. */
export function splitLine(line: string, word: string): [before: string, match: string, after: string] | null {
  const toks = tokenize(line);
  const i = toks.findIndex((t) => t.word && earKey(t.word) === earKey(word));
  if (i < 0) return null;
  const t = toks[i]!;
  const join = (list: typeof toks) => list.map((x) => `${x.before}${x.word}${x.after}`).join(" ");
  const before = join(toks.slice(0, i));
  const after = join(toks.slice(i + 1));
  return [`${before}${before ? " " : ""}${t.before}`, t.word, `${t.after}${after ? " " : ""}${after}`];
}
