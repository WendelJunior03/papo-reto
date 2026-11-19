/**
 * Compara o que a pessoa falou (transcrito) com a fala esperada, palavra por palavra.
 * Tolerante ao que o reconhecimento de voz costuma variar: maiúsculas, pontuação,
 * contrações ("I'm" × "I am") e números escritos.
 */
const CONTRACTIONS: Record<string, string> = {
  "i'm": "i am", "you're": "you are", "we're": "we are", "they're": "they are", "he's": "he is",
  "she's": "she is", "it's": "it is", "that's": "that is", "what's": "what is", "there's": "there is",
  "here's": "here is", "who's": "who is", "how's": "how is", "where's": "where is", "let's": "let us",
  "i've": "i have", "you've": "you have", "we've": "we have", "they've": "they have",
  "i'll": "i will", "you'll": "you will", "we'll": "we will", "they'll": "they will", "it'll": "it will",
  "i'd": "i would", "you'd": "you would", "we'd": "we would", "they'd": "they would",
  "can't": "can not", "cannot": "can not", "won't": "will not", "don't": "do not", "doesn't": "does not",
  "didn't": "did not", "isn't": "is not", "aren't": "are not", "wasn't": "was not", "weren't": "were not",
  "haven't": "have not", "hasn't": "has not", "couldn't": "could not", "shouldn't": "should not",
  "wouldn't": "would not", "gonna": "going to", "wanna": "want to", "gotta": "got to", "ya": "you",
  "y'all": "you all", "ok": "okay",
};
const NUMBERS: Record<string, string> = {
  "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six",
  "7": "seven", "8": "eight", "9": "nine", "10": "ten", "12": "twelve", "20": "twenty",
};

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[[\]]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w) => (CONTRACTIONS[w] ?? NUMBERS[w] ?? w).split(" "))
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

export interface MatchResult {
  /** 0 a 1: fração das palavras esperadas que apareceram, na ordem. */
  score: number;
  /** Cada palavra da fala esperada (como escrita) e se foi dita. */
  tokens: { word: string; hit: boolean }[];
  pass: boolean;
}

export const PASS_SCORE = 0.7;

/** Maior subsequência comum entre as palavras normalizadas. */
export function compare(expected: string, said: string): MatchResult {
  const shown = expected.replace(/[[\]]/g, "").split(/\s+/).filter(Boolean);
  // Cada palavra exibida pode virar mais de uma normalizada ("I'm" → "i am").
  const groups = shown.map((w) => words(w));
  const exp = groups.flat();
  const got = words(said);

  const dp = Array.from({ length: exp.length + 1 }, () => new Array<number>(got.length + 1).fill(0));
  for (let i = exp.length - 1; i >= 0; i--) {
    for (let j = got.length - 1; j >= 0; j--) {
      dp[i]![j] = exp[i] === got[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const hits = new Array<boolean>(exp.length).fill(false);
  for (let i = 0, j = 0; i < exp.length && j < got.length; ) {
    if (exp[i] === got[j]) {
      hits[i] = true;
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }

  let k = 0;
  const tokens = shown.map((word, gi) => {
    const n = groups[gi]!.length;
    const slice = hits.slice(k, k + n);
    k += n;
    return { word, hit: n === 0 || slice.filter(Boolean).length * 2 >= n };
  });
  const score = exp.length ? hits.filter(Boolean).length / exp.length : 0;
  return { score, tokens, pass: score >= PASS_SCORE };
}

/** Entre várias transcrições possíveis, fica com a que mais se aproxima. */
export function bestOf(expected: string, alternatives: string[]): { said: string; result: MatchResult } {
  let best = { said: alternatives[0] ?? "", result: compare(expected, alternatives[0] ?? "") };
  for (const said of alternatives.slice(1)) {
    const result = compare(expected, said);
    if (result.score > best.result.score) best = { said, result };
  }
  return best;
}
