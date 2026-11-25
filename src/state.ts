import { allPhrases, packs, phraseId } from "./data";
import { dateKey, type DateKey } from "./lib/dates";
import { packIndexFor, shuffle, streak } from "./lib/schedule";
import { dueIds, grade, isKnown, markKnown } from "./lib/srs";
import { EAR_DECK, earDue } from "./lib/ear";
import { emptyDay, load, loadAiKey, save, type AiKey, type DayStats, type SavedData } from "./lib/storage";
import type { MatchResult } from "./lib/match";
import type { PixConfig } from "./lib/pix";
import type { Reminder } from "./lib/api";
import type { SessionState } from "../server/session";
import type { Blank, Level, LyricLine } from "./lib/lyrics";
import { buildPlaylist, type ListenLang, type ListenSource, type Playlist } from "./lib/playlist";
import type { AdminStats, AdminUser } from "./lib/api";
import { mergeStories, pickKnownPhrases, type Story } from "./lib/story";

/**
 * "ouvir" (modo Ouvir no carro), "historia" (historinhas) e "admin" (painel do dono)
 * são telas cheias sem botão na barra, como "evolucao".
 */
export type Tab = "hoje" | "dialogo" | "ia" | "musica" | "treino" | "situacoes" | "evolucao" | "ouvir" | "historia" | "admin";
export const TABS: readonly Tab[] = ["hoje", "dialogo", "ia", "musica", "treino", "situacoes", "evolucao", "ouvir", "historia", "admin"];
export type PracticeMode = "falar" | "ouvir" | "musica";

export interface Practice {
  mode: PracticeMode;
  /** Pacote que gerou o baralho; se a pessoa trocar de pacote, o baralho é refeito. */
  packIndex: number;
  /** IDs de frase; no modo "musica", chaves de `data.earWords`. */
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
  /** A IA já conferiu esta fala (com ou sem correção). */
  checked?: boolean;
  pt?: string;
  correction?: string | null;
  note?: string | null;
}

export interface AiChat {
  /** true = papo livre (padrão); false = no papel da situação do pacote. */
  free: boolean;
  packIndex: number;
  messages: AiMessage[];
  loading: boolean;
  error: string | null;
  draft: string;
  openPt: Set<number>;
}

export interface MusicVideo {
  id: string;
  title: string;
  channel: string;
  thumb: string;
  duration: number;
}

export interface LyricsCandidate {
  id: number;
  track: string;
  artist: string;
  duration: number;
}

/** Aba Música: busca, vídeo escolhido, letra e o jogo de completar. */
export interface Music {
  query: string;
  results: MusicVideo[];
  loading: boolean;
  error: string | null;
  level: Level;
  video: MusicVideo | null;
  lines: LyricLine[];
  blanks: Blank[];
  lyrics: { chosen: LyricsCandidate; candidates: LyricsCandidate[] } | null;
  /** Ajuste da sincronia: segundos somados ao tempo da letra (clipe com introdução). */
  offset: number;
  /** Linha tocando agora. */
  line: number;
  /** Lacuna esperando resposta (música pausada). */
  pending: Blank | null;
  /** Respostas dadas, por linha. */
  answers: Record<number, { chosen: string; ok: boolean }>;
  ended: boolean;
  /** Música parada esperando a pessoa (depois de um erro). */
  paused: boolean;
}

/** Opções do modo "Ouvir no carro" (o player em si fica em lib/carplayer.ts). */
export interface Listen {
  source: ListenSource;
  lang: ListenLang;
  slow: boolean;
  /** Manter a tela acesa (Wake Lock), quando o aparelho deixa. */
  awake: boolean;
  /** Pacote que o "pacote aberto" usa (o que estava na tela ao entrar). */
  packIndex: number;
}

/** Tela das historinhas: a aberta (id em `data.stories`), o pedido em andamento e a tradução. */
export interface StoryScreen {
  current: string | null;
  loading: boolean;
  error: string | null;
  /** Tradução de todas as falas (o interruptor global). */
  showPt: boolean;
  /** Falas tocadas uma a uma: invertem o interruptor global. */
  flipped: Set<number>;
  /** Historinhas que ainda dá pra criar hoje com a IA do app (null = não sabe ou chave própria). */
  left: number | null;
}

/** Painel do dono: números, usuários e a senha temporária gerada (mostrada uma vez). */
export interface AdminPanel {
  loading: boolean;
  error: string | null;
  stats: AdminStats | null;
  users: AdminUser[];
  /** Usuário esperando confirmação pra gerar senha temporária. */
  confirm: string | null;
  busy: boolean;
  temp: { username: string; password: string } | null;
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
  /** Frases com a versão "virada" (pergunta/resposta) aberta. */
  openFlips: Set<string>;
  showChatPt: boolean;
  practice: Practice | null;
  dialogue: Dialogue | null;
  ai: AiChat | null;
  showDialoguePt: boolean;
  canInstall: boolean;
  /** Chave de IA do usuário (só neste aparelho) e se o servidor tem chave própria. */
  aiKey: AiKey | null;
  serverAi: boolean;
  aiSettings: { open: boolean; error: string | null };
  /** Sessão com a IA do app (7 min de conversa, 1 h de espera) e notificações. */
  aiSession: SessionState | null;
  pushAvailable: boolean;
  pushOn: boolean;
  /** Lembrete diário por notificação, como está no servidor (null = nunca ativou). */
  reminder: Reminder | null;
  /** PIX do projeto (null = apoio escondido), janela aberta, valor escolhido e lembrete atual. */
  pix: PixConfig | null;
  support: { open: boolean; amount: number; nudge: string | null; daily: boolean };
  music: Music;
  musicSearch: boolean;
  listen: Listen;
  /** Dono do app (vem do /api/me; o servidor confere de novo em cada rota do painel). */
  admin: boolean;
  adminPanel: AdminPanel | null;
  /** Boas-vindas da primeira entrada: passo aberto (1–3) ou 0 = fechada. */
  onboarding: number;
  story: StoryScreen;
}

/** Quantas revisões atrasadas entram junto com o pacote no treino. */
const REVIEW_LIMIT = 10;

export function createState(
  user: string,
  now = new Date(),
  initial?: SavedData,
  serverAi = false,
  pix: PixConfig | null = null,
): AppState {
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
    openFlips: new Set(),
    showChatPt: false,
    practice: null,
    dialogue: null,
    ai: null,
    showDialoguePt: false,
    canInstall: false,
    aiKey: loadAiKey(user),
    serverAi,
    aiSettings: { open: false, error: null },
    aiSession: null,
    pushAvailable: false,
    pushOn: false,
    reminder: null,
    music: emptyMusic(),
    musicSearch: false,
    admin: false,
    adminPanel: null,
    onboarding: 0,
    story: { current: data.stories[0]?.id ?? null, loading: false, error: null, showPt: false, flipped: new Set(), left: null },
    pix,
    support: { open: false, amount: 0, nudge: null, daily: false },
    listen: { source: "hoje", lang: "enpt", slow: false, awake: false, packIndex: todayIndex },
  };
}

let onPersist: ((s: AppState) => void) | null = null;
/** Quem quiser saber de cada mudança salva (a sincronização com o servidor). */
export const setPersistListener = (fn: (s: AppState) => void): void => {
  onPersist = fn;
};

/** Soma no histórico de hoje (e atualiza a foto de frases dominadas). */
export function track(s: AppState, change: Partial<DayStats>): void {
  const day = (s.data.history[s.today] ??= emptyDay());
  for (const [k, v] of Object.entries(change) as [keyof DayStats, number][]) day[k] += v;
}

export function persist(s: AppState): void {
  const day = (s.data.history[s.today] ??= emptyDay());
  day.known = knownCount(s);
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

/** Palavras das músicas vencidas pra revisar (mais atrasadas primeiro). */
export const earReviewsDue = (s: AppState): string[] => earDue(s.data.earWords, s.today);

export function toggleKnown(s: AppState, id: string): boolean {
  const p = s.data.progress;
  if (isKnown(p[id])) {
    delete p[id];
  } else {
    if (!p[id]?.at) track(s, { learned: 1 });
    p[id] = markKnown(p[id], s.today);
  }
  persist(s);
  return isKnown(p[id]);
}

export function goToPack(s: AppState, index: number): void {
  s.packIndex = ((index % packs.length) + packs.length) % packs.length;
  s.openTips.clear();
  s.openFlips.clear();
}

export function startPractice(s: AppState, mode: PracticeMode = s.practice?.mode ?? "falar"): Practice {
  const deck =
    mode === "musica"
      ? earReviewsDue(s).slice(0, EAR_DECK)
      : shuffle([...packIds(s.packIndex), ...reviewsDue(s).slice(0, REVIEW_LIMIT)]);
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
  if (pr.mode === "musica") {
    const ear = s.data.earWords[id];
    if (ear) ear.card = grade(ear.card, hit, s.today);
    track(s, { reviews: 1, hits: hit ? 1 : 0 });
  } else {
    const firstTime = hit && !s.data.progress[id]?.at;
    s.data.progress[id] = grade(s.data.progress[id], hit, s.today);
    track(s, { reviews: 1, hits: hit ? 1 : 0, learned: firstTime ? 1 : 0 });
  }
  if (hit) pr.score++;
  pr.pos++;
  pr.revealed = false;
  if (pr.pos >= pr.deck.length) s.data.practiceAt = s.today;
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
  if (turn.said !== "(pulou)") {
    track(s, { spoken: 1, spokenSum: turn.result.score });
    persist(s);
  }
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
  s.data.dialogueAt = s.today;
  persist(s);
}

/* ---------- conversa com IA ---------- */

export function ensureAi(s: AppState): AiChat {
  // Papo livre não depende do pacote; no modo situação, trocar de pacote começa outra conversa.
  if (!s.ai || (!s.ai.free && s.ai.packIndex !== s.packIndex)) {
    s.ai = { free: s.ai?.free ?? true, packIndex: s.packIndex, messages: [], loading: false, error: null, draft: "", openPt: new Set() };
  }
  return s.ai;
}

/** A IA do app (sem chave própria) está liberada pra conversar agora? */
export const aiLocked = (s: AppState): boolean => !s.aiKey && s.aiSession?.state === "cooldown";

/* ---------- ouvir no carro ---------- */
/** Abre o modo com o pacote que está na tela (o do dia, se for ele). */
export function openListen(s: AppState, source?: ListenSource): void {
  s.listen.packIndex = s.packIndex;
  s.listen.source = source ?? (s.packIndex === s.todayIndex ? "hoje" : "pacote");
}

export function listenPlaylist(s: AppState): Playlist {
  const l = s.listen;
  if (l.source === "revisao") return buildPlaylist({ source: "review", progress: s.data.progress }, l.lang);
  return buildPlaylist({ source: "pack", packIndex: l.source === "hoje" ? s.todayIndex : l.packIndex }, l.lang);
}

/* ---------- historinhas ---------- */
/** Frases que a pessoa sabe, sorteadas pra próxima historinha. */
export const storyPhrases = (s: AppState): string[] => pickKnownPhrases(allPhrases, s.data.progress);

export const currentStory = (s: AppState): Story | null =>
  s.data.stories.find((x) => x.id === s.story.current) ?? s.data.stories[0] ?? null;

/** Guarda a historinha nova (fica entre as últimas) e abre ela. */
export function addStory(s: AppState, story: Omit<Story, "id" | "date" | "at">, now = Date.now()): Story {
  const full: Story = { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, date: s.today, at: now, ...story };
  s.data.stories = mergeStories([full], s.data.stories);
  openStory(s, full.id);
  persist(s);
  return full;
}

export function openStory(s: AppState, id: string): void {
  s.story.current = id;
  s.story.flipped = new Set();
  s.story.error = null;
}

/* ---------- apoio ao projeto ---------- */
/** Abre a janela do PIX sozinha na primeira abertura do dia, pra quem ainda não apoiou. */
export function shouldShowDailySupport(data: SavedData, today: DateKey, hasPix: boolean): boolean {
  return hasPix && !data.supported && data.supportPromptAt !== today;
}

export function openDailySupport(s: AppState): boolean {
  if (!shouldShowDailySupport(s.data, s.today, !!s.pix)) return false;
  s.support = { open: true, amount: 0, nudge: null, daily: true };
  s.data.supportPromptAt = s.today;
  persist(s);
  return true;
}

/** Lembrete numa conquista (só se a janela ainda não apareceu hoje). */
export function nudgeSupport(s: AppState, message: string): void {
  if (!s.pix || s.data.supported || s.support.nudge || s.support.open) return;
  if (s.data.supportPromptAt === s.today) return;
  s.support.nudge = message;
  s.data.supportPromptAt = s.today;
  persist(s);
}

export function markSupported(s: AppState): void {
  s.data.supported = true;
  s.support = { open: false, amount: 0, nudge: null, daily: false };
  persist(s);
}

/* ---------- música ---------- */
export function emptyMusic(): Music {
  return {
    query: "", results: [], loading: false, error: null, level: "facil", video: null, lines: [], blanks: [],
    lyrics: null, offset: 0, line: -1, pending: null, answers: {}, ended: false, paused: false,
  };
}
