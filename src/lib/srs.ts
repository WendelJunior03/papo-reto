import { addDays, type DateKey } from "./dates";

/**
 * Repetição espaçada no estilo Leitner: cada acerto sobe a frase de caixa
 * e empurra a próxima revisão para mais longe; um erro devolve para o começo.
 */
export interface CardState {
  box: number;
  due: DateKey;
  /** Primeiro dia em que a frase foi dominada (pra "Sua coleção"). */
  at?: DateKey;
}

export type Progress = Record<string, CardState>;

/** Intervalo em dias para cada caixa (índice = caixa). */
export const INTERVALS = [0, 1, 3, 7, 16, 35] as const;
export const MAX_BOX = INTERVALS.length - 1;

const intervalFor = (box: number): number => INTERVALS[Math.min(box, MAX_BOX)] ?? 0;

export const isKnown = (card: CardState | undefined): boolean => (card?.box ?? 0) >= 1;
export const isDue = (card: CardState | undefined, today: DateKey): boolean =>
  card !== undefined && card.due <= today;

/** "Sei essa" na tela do dia: entra pelo menos na caixa 1. */
export function markKnown(card: CardState | undefined, today: DateKey): CardState {
  const box = Math.max(card?.box ?? 0, 1);
  return { box, due: addDays(today, intervalFor(box)), at: card?.at ?? today };
}

/** Resultado de um card no treino. */
export function grade(card: CardState | undefined, hit: boolean, today: DateKey): CardState {
  if (!hit) return { box: 0, due: today, ...(card?.at ? { at: card.at } : {}) };
  const box = Math.min((card?.box ?? 0) + 1, MAX_BOX);
  return { box, due: addDays(today, intervalFor(box)), at: card?.at ?? today };
}

/** IDs que já passaram da data de revisão, mais atrasados primeiro. */
export function dueIds(progress: Progress, today: DateKey, exclude: ReadonlySet<string> = new Set()): string[] {
  return Object.entries(progress)
    .filter(([id, c]) => !exclude.has(id) && isDue(c, today))
    .sort((a, b) => a[1].due.localeCompare(b[1].due) || a[1].box - b[1].box)
    .map(([id]) => id);
}
