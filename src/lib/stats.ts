/** Números da tela "Sua evolução", calculados a partir do que o app já guarda. */
import { addDays, daysBetween, parseKey, type DateKey } from "./dates";
import type { Progress } from "./srs";
import type { DayStats, SavedData, SongRecord } from "./storage";

/* ---------- nível ---------- */
export const LEVELS = [
  { min: 0, name: "Primeiros passos" },
  { min: 20, name: "Já se vira" },
  { min: 60, name: "Conversa do dia a dia" },
  { min: 120, name: "Papo solto" },
  { min: 200, name: "Quase nativo no dia a dia" },
  { min: 300, name: "Papo reto total" },
] as const;

export function levelFor(known: number) {
  let i = 0;
  while (i + 1 < LEVELS.length && known >= LEVELS[i + 1]!.min) i++;
  const cur = LEVELS[i]!;
  const next = LEVELS[i + 1];
  return {
    index: i + 1,
    name: cur.name,
    next: next ?? null,
    /** 0 a 1 até o próximo nível. */
    progress: next ? (known - cur.min) / (next.min - cur.min) : 1,
    missing: next ? next.min - known : 0,
  };
}

/* ---------- semana ---------- */
export interface Week {
  days: number;
  learned: number;
  reviews: number;
  /** Média da nota da fala (0–1) ou null se não falou. */
  spoken: number | null;
}

function sumWeek(data: SavedData, end: DateKey): Week {
  let days = 0, learned = 0, reviews = 0, spoken = 0, spokenSum = 0;
  const visits = new Set(data.visits);
  for (let i = 0; i < 7; i++) {
    const day = addDays(end, -i);
    const h = data.history[day];
    if (visits.has(day)) days++;
    if (!h) continue;
    learned += h.learned;
    reviews += h.reviews;
    spoken += h.spoken;
    spokenSum += h.spokenSum;
  }
  return { days, learned, reviews, spoken: spoken ? spokenSum / spoken : null };
}

/** Últimos 7 dias contra os 7 anteriores. */
export const weekSummary = (data: SavedData, today: DateKey) => ({
  now: sumWeek(data, today),
  before: sumWeek(data, addDays(today, -7)),
});

/* ---------- constância ---------- */
export function longestStreak(visits: Iterable<DateKey>): number {
  const days = [...new Set(visits)].sort();
  let best = 0, run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && daysBetween(days[i - 1]!, days[i]!) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

export function daysThisMonth(visits: Iterable<DateKey>, today: DateKey): number {
  const prefix = today.slice(0, 7);
  return [...new Set(visits)].filter((d) => d.startsWith(prefix)).length;
}

export interface HeatCell {
  date: DateKey;
  /** 0 = não estudou; 1–4 = quanto fez no dia. */
  level: 0 | 1 | 2 | 3 | 4;
  actions: number;
  future: boolean;
}

const actionsOf = (h: DayStats | undefined): number => (h ? h.learned + h.reviews + h.spoken + h.ai : 0);

/** Semanas (colunas, domingo→sábado) terminando na semana de hoje. */
export function heatmap(data: SavedData, today: DateKey, weeks = 16): HeatCell[][] {
  const visits = new Set(data.visits);
  const end = addDays(today, 6 - parseKey(today).getDay()); // sábado desta semana
  const start = addDays(end, -(weeks * 7 - 1));
  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      const actions = actionsOf(data.history[date]);
      const studied = visits.has(date) || actions > 0;
      const level: HeatCell["level"] = !studied ? 0 : actions >= 25 ? 4 : actions >= 12 ? 3 : actions >= 4 ? 2 : 1;
      col.push({ date, level, actions, future: date > today });
    }
    cols.push(col);
  }
  return cols;
}

/* ---------- memória ---------- */
export const MEMORY = [
  { key: "review", label: "Pra revisar", hint: "errou da última vez" },
  { key: "learning", label: "Aprendendo", hint: "volta amanhã" },
  { key: "fixing", label: "Fixando", hint: "volta em 3 dias" },
  { key: "solid", label: "Firme", hint: "volta em 1 semana" },
  { key: "mastered", label: "Dominada", hint: "volta em 2+ semanas" },
] as const;

export function memoryBuckets(progress: Progress): number[] {
  const counts = [0, 0, 0, 0, 0];
  for (const c of Object.values(progress)) counts[Math.min(c.box, 4)]!++;
  return counts;
}

/* ---------- séries no tempo ---------- */
export interface Point {
  date: DateKey;
  value: number;
}

/** Frases dominadas dia a dia (repete o último valor nos dias sem uso). */
export function knownSeries(data: SavedData, today: DateKey, days = 30): Point[] {
  const out: Point[] = [];
  let last = 0;
  // valor inicial: a última foto antes da janela
  const first = addDays(today, -(days - 1));
  for (const [d, h] of Object.entries(data.history).sort()) if (d < first) last = h.known;
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const h = data.history[date];
    if (h) last = h.known;
    out.push({ date, value: last });
  }
  return out;
}

/** Média diária da nota da fala no diálogo (só dias em que falou). */
export function spokenSeries(data: SavedData, today: DateKey, days = 60): Point[] {
  const first = addDays(today, -(days - 1));
  return Object.entries(data.history)
    .filter(([d, h]) => d >= first && d <= today && h.spoken > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, h]) => ({ date, value: h.spokenSum / h.spoken }));
}

/* ---------- conquistas ---------- */
export interface Badge {
  id: string;
  title: string;
  desc: string;
  done: boolean;
  /** Quanto falta, quando ainda não liberou. */
  left?: string;
}

export function badges(input: {
  known: number; studyDays: number; packsDone: number; dialogues: number; perfect: boolean; aiMsgs: number;
  songs?: number; bestSong?: number;
}): Badge[] {
  const n = (have: number, need: number, unit: string) => {
    if (have >= need) return undefined;
    const left = need - have;
    return left === 1 ? `falta 1 ${unit.replace(/s$/, "")}` : `faltam ${left} ${unit}`;
  };
  const { known, studyDays, packsDone, dialogues, perfect, aiMsgs, songs = 0, bestSong = 0 } = input;
  return [
    { id: "first", title: "Primeira frase", desc: "Dominou a primeira expressão", done: known >= 1, left: n(known, 1, "frases") },
    { id: "week", title: "7 dias de estudo", desc: "Não precisa ser seguido", done: studyDays >= 7, left: n(studyDays, 7, "dias") },
    { id: "talk", title: "Primeiro diálogo", desc: "Completou uma cena falando", done: dialogues >= 1, left: n(dialogues, 1, "diálogos") },
    { id: "fifty", title: "50 frases", desc: "Já se vira em várias situações", done: known >= 50, left: n(known, 50, "frases") },
    { id: "perfect", title: "Diálogo perfeito", desc: "100% numa cena", done: perfect, left: perfect ? undefined : "tire 100% num diálogo" },
    { id: "packs", title: "10 situações", desc: "10 pacotes completos", done: packsDone >= 10, left: n(packsDone, 10, "pacotes") },
    { id: "ai", title: "Papo com a IA", desc: "Conversou com um nativo virtual", done: aiMsgs >= 1, left: aiMsgs ? undefined : "mande uma mensagem pra IA" },
    { id: "month", title: "30 dias de estudo", desc: "Inglês virou hábito", done: studyDays >= 30, left: n(studyDays, 30, "dias") },
    { id: "150", title: "150 frases", desc: "Metade de todo o conteúdo", done: known >= 150, left: n(known, 150, "frases") },
    { id: "song", title: "Primeira música", desc: "Completou uma música no treino de ouvido", done: songs >= 1, left: songs ? undefined : "complete uma música" },
    { id: "ear", title: "Ouvido afiado", desc: "90% numa música", done: bestSong >= 0.9, left: bestSong >= 0.9 ? undefined : "acerte 90% numa música" },
    { id: "songs5", title: "5 músicas", desc: "Treinou com 5 músicas diferentes", done: songs >= 5, left: n(songs, 5, "músicas") },
  ];
}

/* ---------- ouvido (aba Música) ---------- */
export interface ListenWeek {
  answered: number;
  /** 0–1, ou null se não respondeu nada. */
  pct: number | null;
}

function listenWeek(data: SavedData, end: DateKey): ListenWeek {
  let answered = 0, hits = 0;
  for (let i = 0; i < 7; i++) {
    const h = data.history[addDays(end, -i)];
    if (!h) continue;
    answered += h.listen ?? 0;
    hits += h.listenHits ?? 0;
  }
  return { answered, pct: answered ? hits / answered : null };
}

export function listeningSummary(data: SavedData, today: DateKey) {
  let answered = 0, hits = 0;
  for (const h of Object.values(data.history)) {
    answered += h.listen ?? 0;
    hits += h.listenHits ?? 0;
  }
  return {
    answered,
    hits,
    pct: answered ? hits / answered : null,
    songs: Object.keys(data.songs).length,
    now: listenWeek(data, today),
    before: listenWeek(data, addDays(today, -7)),
  };
}

/** Acerto por dia no treino de ouvido (só dias com respostas). */
export function listenSeries(data: SavedData, today: DateKey, days = 60): Point[] {
  const first = addDays(today, -(days - 1));
  return Object.entries(data.history)
    .filter(([d, h]) => d >= first && d <= today && (h.listen ?? 0) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, h]) => ({ date, value: (h.listenHits ?? 0) / (h.listen || 1) }));
}

export interface SongProgress {
  id: string;
  title: string;
  attempts: number;
  /** 0–1 */
  first: number;
  last: number;
  best: number;
  lastLevel: string;
  lastDate: DateKey;
}

/** Comparativo por música: primeira tentativa, última e a melhor. */
export function songProgress(data: SavedData): SongProgress[] {
  const pct = (h: number, t: number) => (t ? h / t : 0);
  return Object.entries(data.songs)
    .map(([id, sg]: [string, SongRecord]) => {
      const att = sg.attempts?.length ? sg.attempts : [{ date: sg.date, hits: sg.best, total: sg.total, level: sg.level }];
      const first = att[0]!, last = att[att.length - 1]!;
      return {
        id,
        title: sg.title,
        attempts: att.length,
        first: pct(first.hits, first.total),
        last: pct(last.hits, last.total),
        best: Math.max(...att.map((a) => pct(a.hits, a.total))),
        lastLevel: last.level,
        lastDate: last.date,
      };
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}
