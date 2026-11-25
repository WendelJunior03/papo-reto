/**
 * Historinhas: contos curtos montados com frases que a pessoa já sabe.
 * Parte pura, compartilhada entre o app e o servidor (sem zod aqui, pra não pesar no app).
 */
import { plain } from "./html";
import { isKnown, type Progress } from "./srs";
import type { DateKey } from "./dates";

export interface StoryLine {
  en: string;
  pt: string;
}

export interface Story {
  /** Único por historinha (data + sorteio), usado pra juntar entre aparelhos. */
  id: string;
  date: DateKey;
  /** Momento em que foi criada (ms), pra ordenar as do mesmo dia. */
  at: number;
  title: string;
  title_pt: string;
  lines: StoryLine[];
}

/** Precisa saber pelo menos isso pra ter graça. */
export const MIN_KNOWN = 3;
/** Frases sorteadas por historinha. */
export const MAX_STORY_PHRASES = 8;
/** Quantas ficam guardadas (abrem sem internet). */
export const MAX_SAVED_STORIES = 5;
/** Falas aceitas da IA (pedimos 5 a 8; poucas demais é resposta quebrada). */
export const MIN_LINES = 4;
export const MAX_LINES = 8;
const MAX_TITLE = 80;
const MAX_LINE = 220;

/**
 * Texto em inglês (sem colchetes) das frases que a pessoa sabe, embaralhado, no máximo `n`.
 * Recebe a lista de frases (o app passa `allPhrases`), assim o servidor não carrega o conteúdo.
 */
export function pickKnownPhrases(
  phrases: readonly { id: string; en: string }[],
  progress: Progress,
  n = MAX_STORY_PHRASES,
  rand: () => number = Math.random,
): string[] {
  const known = [...new Set(phrases.filter((p) => isKnown(progress[p.id])).map((p) => plain(p.en).trim()))];
  // Fisher–Yates com o sorteio injetável (os testes passam um fixo).
  for (let i = known.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [known[i], known[j]] = [known[j]!, known[i]!];
  }
  return known.slice(0, n);
}

/**
 * Limpa um texto vindo da IA: tira caracteres de controle e tags, junta espaços
 * e deixa só colchetes bem formados (um par por trecho, sem aninhar, sem vazio).
 */
export function cleanText(raw: string, max: number, brackets: boolean): string {
  let s = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (brackets) {
    // Mantém [trecho] sem colchete dentro; qualquer colchete solto some.
    const parts: string[] = [];
    s = s.replace(/\[([^[\]]*)\]/g, (_, inner: string) => {
      const t = inner.trim();
      if (!t) return "";
      parts.push(t);
      return `\u0001${parts.length - 1}\u0002`;
    });
    s = s.replace(/[[\]]/g, "").replace(/\u0001(\d+)\u0002/g, (_, i: string) => `[${parts[Number(i)]}]`);
    s = s.replace(/\s+/g, " ").trim();
  } else {
    s = s.replace(/[[\]]/g, "");
  }
  if (s.length <= max) return s;
  // Cortado no meio de um [trecho]: tira o colchete aberto pra não marcar o resto.
  const cut = s.slice(0, max).trimEnd();
  const open = cut.lastIndexOf("[");
  return open > cut.lastIndexOf("]") ? cut.slice(0, open) + cut.slice(open + 1) : cut;
}

/** Historinha da IA (já no formato certo) → limpa e dentro dos limites; null se não sobrar uma historinha de verdade. */
export function sanitizeStory(raw: { title: string; title_pt: string; lines: { en: string; pt: string }[] }): Omit<Story, "id" | "date" | "at"> | null {
  const title = cleanText(raw.title, MAX_TITLE, false);
  const title_pt = cleanText(raw.title_pt, MAX_TITLE, false);
  const lines = raw.lines
    .map((l) => ({ en: cleanText(l.en, MAX_LINE, true), pt: cleanText(l.pt, MAX_LINE, false) }))
    .filter((l) => plain(l.en).trim() && l.pt)
    .slice(0, MAX_LINES);
  if (!title || lines.length < MIN_LINES) return null;
  return { title, title_pt: title_pt || title, lines };
}

/** Confere uma historinha guardada (do aparelho ou do servidor): formato estranho fica de fora. */
export function isStory(x: unknown): x is Story {
  const o = x as Story | null;
  return !!o && typeof o === "object" && typeof o.id === "string" && typeof o.date === "string" && typeof o.at === "number"
    && typeof o.title === "string" && typeof o.title_pt === "string" && Array.isArray(o.lines)
    && o.lines.every((l) => !!l && typeof l.en === "string" && typeof l.pt === "string");
}

/** Junta duas listas (qualquer coisa que não seja lista vale vazia): mais recentes primeiro, sem repetir id, no máximo MAX_SAVED_STORIES. */
export function mergeStories(a: unknown, b: unknown): Story[] {
  const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
  const byId = new Map<string, Story>();
  for (const st of [...list(a), ...list(b)]) if (isStory(st) && !byId.has(st.id)) byId.set(st.id, st);
  return [...byId.values()].sort((x, y) => y.at - x.at || y.id.localeCompare(x.id)).slice(0, MAX_SAVED_STORIES);
}
