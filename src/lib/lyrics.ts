/**
 * Jogo de completar a letra (treino de ouvido): lê a letra sincronizada (formato LRC),
 * escolhe palavras pra sumir e monta 4 opções parecidas pra cada lacuna.
 */

export interface LyricLine {
  /** Início da linha em segundos. */
  t: number;
  text: string;
}

export interface Blank {
  line: number;
  /** Posição da palavra dentro da linha (contando só palavras). */
  word: number;
  answer: string;
  options: string[];
}

export type Level = "facil" | "medio" | "dificil";

/** "[01:23.45] texto" → { t: 83.45, text: "texto" }. Linhas vazias ou só de tempo são ignoradas. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    if (!text) continue;
    for (const m of stamps) {
      const frac = m[3] ? Number(`0.${m[3]}`) : 0;
      out.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Palavras da linha, mantendo a pontuação de fora (pra mostrar a lacuna no lugar certo). */
export function tokenize(text: string): { word: string; before: string; after: string }[] {
  return text.split(/\s+/).filter(Boolean).map((tok) => {
    const m = /^([^A-Za-z0-9']*)([A-Za-z0-9']+(?:[-'][A-Za-z0-9]+)*)([^A-Za-z0-9']*)$/.exec(tok);
    return m ? { before: m[1]!, word: m[2]!, after: m[3]! } : { before: tok, word: "", after: "" };
  });
}

const norm = (w: string): string => w.toLowerCase().replace(/[^a-z']/g, "");

/** Palavras curtas e muito comuns não viram lacuna (não treinam nada). */
const SKIP = new Set(
  "a an the i you he she it we they me my your our to of in on at for and or but so is am are was were be been do does did oh ooh yeah hey la na uh".split(" "),
);

/** Palavras comuns que servem de opção errada quando a letra não tem parecidas suficientes. */
const COMMON = (
  "love life light night right time mine line fire higher hold home heart hard part start stand hand land " +
  "name same came day way say stay pray praise raise grace place face faith safe know show grow go so " +
  "need feel real heal free see be sea give live leave believe never ever forever over alone along long strong " +
  "every thing nothing something more shore door before call fall all world word worth worthy holy only lonely " +
  "provide provider divide beside inside outside guide side ride wide wonder under thunder sound found around ground"
).split(" ");

/** Distância de edição (Levenshtein), pra achar palavras com som/escrita parecidos. */
export function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

/** Gerador pseudoaleatório com semente: a mesma música sempre dá as mesmas lacunas. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const seedOf = (s: string): number => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

/** 3 opções erradas parecidas com a resposta (escrita/tamanho), da própria letra ou da lista comum. */
export function distractors(answer: string, vocab: string[], rand: () => number): string[] {
  const a = norm(answer);
  const pool = [...new Set([...vocab, ...COMMON].map(norm))].filter((w) => w.length >= 3 && w !== a && !SKIP.has(w));
  const scored = pool
    .map((w) => ({ w, d: distance(a, w) + Math.abs(a.length - w.length) * 0.5 - (w[0] === a[0] ? 0.8 : 0) + rand() * 0.6 }))
    .sort((x, y) => x.d - y.d);
  return scored.slice(0, 3).map((x) => x.w);
}

/** Quantas linhas por lacuna em cada nível. */
const EVERY: Record<Level, number> = { facil: 3, medio: 2, dificil: 1 };

/** Escolhe as lacunas da música (uma por linha escolhida) e as opções de cada uma. */
export function makeBlanks(lines: LyricLine[], level: Level, seedKey: string): Blank[] {
  const rand = rng(seedOf(seedKey + level));
  const vocab = lines.flatMap((l) => tokenize(l.text).map((t) => t.word)).filter(Boolean);
  const blanks: Blank[] = [];
  const seen = new Map<string, number>();
  lines.forEach((line, i) => {
    if (i % EVERY[level] !== 0) return;
    const candidates = tokenize(line.text)
      .map((t, idx) => ({ idx, w: t.word }))
      .filter(({ w }) => w.length >= 3 && !SKIP.has(norm(w)) && !/^\d+$/.test(w));
    if (!candidates.length) return;
    // Prefere palavras que ainda não viraram lacuna muitas vezes (refrão repete).
    candidates.sort((x, y) => (seen.get(norm(x.w)) ?? 0) - (seen.get(norm(y.w)) ?? 0) || rand() - 0.5);
    const pick = candidates[0]!;
    seen.set(norm(pick.w), (seen.get(norm(pick.w)) ?? 0) + 1);
    const wrong = distractors(pick.w, vocab, rand);
    const options = [norm(pick.w), ...wrong].sort(() => rand() - 0.5);
    blanks.push({ line: i, word: pick.idx, answer: norm(pick.w), options });
  });
  return blanks;
}

/** Índice da linha que está tocando no segundo `t` (-1 antes da primeira). */
export function lineAt(lines: LyricLine[], t: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Limpa o título do YouTube pra buscar a letra: tira "(Official Video)", "Lyrics", "ft."… */
export function cleanTitle(title: string): string {
  return title
    .replace(/\((?:[^)]*?(?:official|lyric|video|audio|live|ao vivo|legendado|tradução|traducao|hd|4k)[^)]*)\)/gi, "")
    .replace(/\[(?:[^\]]*?(?:official|lyric|video|audio|live|hd|4k)[^\]]*)\]/gi, "")
    .replace(/\b(?:official\s+(?:music\s+)?video|lyric\s+video|lyrics?|letra|legendado|ft\.?|feat\.?)\b.*$/i, "")
    .replace(/\s+[|·•-]\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
