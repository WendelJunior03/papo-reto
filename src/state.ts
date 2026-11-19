import { allPhrases, packs, phraseId } from "./data";
import { dateKey, type DateKey } from "./lib/dates";
import { packIndexFor, shuffle, streak } from "./lib/schedule";
import { dueIds, grade, isKnown, markKnown } from "./lib/srs";
import { load, save, type SavedData } from "./lib/storage";
import type { MatchResult } from "./lib/match";

export type Tab = "hoje" | "dialogo" | "ia" | "treino" | "situacoes";
export const TABS: readonly Tab[] = ["hoje", "dialogo", "ia", "treino", "situacoes"];
export type PracticeMode = "falar" | "ouvir";

export interface Practice {
  mode: PracticeMode;
  /** Pacote que gerou o baralho; se a pessoa trocar de pacote, o baralho é refeito. */
  packIndex: number;
  deck: string[];
  pos: number;
  revealed: boolean;
  score: number;
}

export interface DialogueTurn {
  said: string;
  result: MatchResult;
}

export interface Dialogue {
  packIndex: number;
  /** Quantas falas da cena já apareceram. A próxima, se for do aluno, é a vez dele. */
  shown: number;
  turns: Record<number, DialogueTurn>;
  listening: boolean;
  hint: boolean;
  error: string | null;
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
  pt?: string;
  correction?: string | null;
  note?: string | null;
}

export interface AiChat {
  packIndex: number;
  messages: AiMessage[];
  loading: boolean;
  error: string | null;
  draft: string;
  openPt: Set<number>;
}

export interface AppState {
  /** Usuário logado (dono do progresso). */
  user: string;
  tab: Tab;
  today: DateKey;
  todayIndex: number;
  /** Pacote aberto na tela (pode ser diferente do pacote do dia). */
  packIndex: number;
  data: SavedData;
  openTips: Set<string>;
  showChatPt: boolean;
  practice: Practice | null;
  dialogue: Dialogue | null;
  ai: AiChat | null;
  showDialoguePt: boolean;
  canInstall: boolean;
}

/** Quantas revisões atrasadas entram junto com o pacote no treino. */
const REVIEW_LIMIT = 10;

export function createState(user: string, now = new Date(), initial?: SavedData): AppState {
  const data = initial ?? load(user);
  const today = dateKey(now);
  data.start ??= today;
  if (!data.visits.includes(today)) data.visits.push(today);
  save(user, data);
  const todayIndex = packIndexFor(data.start, today, packs.length);
  const hash = location.hash.slice(1);
  return {
    user,
    tab: (TABS as readonly string[]).includes(hash) ? (hash as Tab) : "hoje",
    today,
    todayIndex,
    packIndex: todayIndex,
    data,
    openTips: new Set(),
    showChatPt: false,
    practice: null,
    dialogue: null,
    ai: null,
    showDialoguePt: false,
    canInstall: false,
  };
}

let onPersist: ((s: AppState) => void) | null = null;
/** Quem quiser saber de cada mudança salva (a sincronização com o servidor). */
export const setPersistListener = (fn: (s: AppState) => void): void => {
  onPersist = fn;
};

export function persist(s: AppState): void {
  save(s.user, s.data);
  onPersist?.(s);
}

export const currentPack = (s: AppState) => packs[s.packIndex]!;

export const knownCount = (s: AppState): number =>
  allPhrases.reduce((n, p) => n + (isKnown(s.data.progress[p.id]) ? 1 : 0), 0);

export const knownInPack = (s: AppState, packIndex: number): number => {
  const pack = packs[packIndex]!;
  return pack.phrases.filter((_, i) => isKnown(s.data.progress[phraseId(pack, i)])).length;
};

export const streakDays = (s: AppState): number => streak(s.data.visits, s.today);

const packIds = (packIndex: number): string[] => {
  const pack = packs[packIndex]!;
  return pack.phrases.map((_, i) => phraseId(pack, i));
};

/** Revisões vencidas de outros pacotes (inclui as que a pessoa errou no treino). */
export const reviewsDue = (s: AppState): string[] =>
  dueIds(s.data.progress, s.today, new Set(packIds(s.packIndex)));

export function toggleKnown(s: AppState, id: string): boolean {
  const p = s.data.progress;
  if (isKnown(p[id])) {
    delete p[id];
  } else {
    p[id] = markKnown(p[id], s.today);
  }
  persist(s);
  return isKnown(p[id]);
}

export function goToPack(s: AppState, index: number): void {
  s.packIndex = ((index % packs.length) + packs.length) % packs.length;
  s.openTips.clear();
}

export function startPractice(s: AppState, mode: PracticeMode = s.practice?.mode ?? "falar"): Practice {
  const deck = shuffle([...packIds(s.packIndex), ...reviewsDue(s).slice(0, REVIEW_LIMIT)]);
  s.practice = { mode, packIndex: s.packIndex, deck, pos: 0, revealed: false, score: 0 };
  return s.practice;
}

export function ensurePractice(s: AppState): Practice {
  return s.practice && s.practice.packIndex === s.packIndex ? s.practice : startPractice(s);
}

export function answer(s: AppState, hit: boolean): void {
  const pr = s.practice;
  const id = pr?.deck[pr.pos];
  if (!pr || !id) return;
  s.data.progress[id] = grade(s.data.progress[id], hit, s.today);
  if (hit) pr.score++;
  pr.pos++;
  pr.revealed = false;
  persist(s);
}

/* ---------- diálogo guiado ---------- */

/** Mostra as falas da outra pessoa até chegar a vez do aluno. Devolve as que apareceram. */
function revealUntilLearner(d: Dialogue): number[] {
  const chat = packs[d.packIndex]!.chat;
  const shownNow: number[] = [];
  while (d.shown < chat.length && !chat[d.shown]!.me) shownNow.push(d.shown++);
  return shownNow;
}

export function startDialogue(s: AppState): number[] {
  s.dialogue = { packIndex: s.packIndex, shown: 0, turns: {}, listening: false, hint: false, error: null };
  return revealUntilLearner(s.dialogue);
}

/** Garante um diálogo do pacote aberto; devolve falas novas pra tocar (se começou agora). */
export function ensureDialogue(s: AppState): number[] {
  return s.dialogue && s.dialogue.packIndex === s.packIndex ? [] : startDialogue(s);
}

export function dialogueTurnIndex(d: Dialogue): number | null {
  const chat = packs[d.packIndex]!.chat;
  return d.shown < chat.length && chat[d.shown]!.me ? d.shown : null;
}

export function recordTurn(s: AppState, turn: DialogueTurn): void {
  const d = s.dialogue;
  const i = d && dialogueTurnIndex(d);
  if (!d || i === null || i === undefined) return;
  d.turns[i] = turn;
  d.error = null;
}

/** Avança depois da fala do aluno; devolve as falas da outra pessoa que apareceram. */
export function advanceDialogue(s: AppState): number[] {
  const d = s.dialogue;
  if (!d) return [];
  d.shown++;
  d.hint = false;
  const revealed = revealUntilLearner(d);
  if (dialogueDone(d)) saveDialogueScore(s);
  return revealed;
}

export const dialogueDone = (d: Dialogue): boolean => d.shown >= packs[d.packIndex]!.chat.length;

export function dialogueScore(d: Dialogue): number {
  const chat = packs[d.packIndex]!.chat;
  const mine = chat.map((c, i) => (c.me ? i : -1)).filter((i) => i >= 0);
  if (!mine.length) return 1;
  return mine.reduce((sum, i) => sum + (d.turns[i]?.result.score ?? 0), 0) / mine.length;
}

function saveDialogueScore(s: AppState): void {
  const d = s.dialogue!;
  const id = packs[d.packIndex]!.id;
  const score = dialogueScore(d);
  const prev = s.data.dialogues[id];
  if (!prev || score >= prev.best) s.data.dialogues[id] = { best: score, date: s.today };
  persist(s);
}

/* ---------- conversa com IA ---------- */

export function ensureAi(s: AppState): AiChat {
  if (!s.ai || s.ai.packIndex !== s.packIndex) {
    s.ai = { packIndex: s.packIndex, messages: [], loading: false, error: null, draft: "", openPt: new Set() };
  }
  return s.ai;
}
