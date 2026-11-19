import { addDays, daysBetween, type DateKey } from "./dates";

/** Índice do pacote do dia: o primeiro dia de uso abre o pacote 0 e segue um por dia. */
export function packIndexFor(start: DateKey, today: DateKey, total: number): number {
  if (total <= 0) return 0;
  const n = daysBetween(start, today);
  return ((n % total) + total) % total;
}

/** Dias seguidos com visita, contando hoje (ou ontem, se hoje ainda não abriu). */
export function streak(visits: Iterable<DateKey>, today: DateKey): number {
  const set = new Set(visits);
  let day = set.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (set.has(day)) {
    count++;
    day = addDays(day, -1);
  }
  return count;
}

/** Embaralhamento Fisher–Yates com gerador injetável (facilita teste). */
export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}
