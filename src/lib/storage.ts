import type { Progress } from "./srs";
import type { DateKey } from "./dates";

/** Tudo que o app guarda por usuário (no aparelho e, com login, também no servidor). */
export interface SavedData {
  /** Dia em que a pessoa abriu o app pela primeira vez; ancora a rotação dos pacotes. */
  start: DateKey | null;
  visits: DateKey[];
  progress: Progress;
  installHintDismissed: boolean;
  /** Horário do lembrete diário ("HH:MM") e se a pessoa já adicionou ao calendário. */
  reminderTime: string;
  reminderAdded: boolean;
  /** Melhor nota (0–1) no diálogo guiado de cada pacote. */
  dialogues: Record<string, { best: number; date: DateKey }>;
  /** Última vez que o app pediu apoio (no máximo uma vez a cada 30 dias). */
  supportPromptAt: DateKey | null;
  /** Histórico por dia, pra tela de evolução. */
  history: Record<DateKey, DayStats>;
}

export interface DayStats {
  /** Frases marcadas como "sei" ou acertadas pela primeira vez. */
  learned: number;
  /** Cards respondidos no treino e quantos acertou. */
  reviews: number;
  hits: number;
  /** Falas no diálogo guiado e soma das notas (0–1), pra tirar a média. */
  spoken: number;
  spokenSum: number;
  /** Mensagens enviadas pra IA. */
  ai: number;
  /** Total de frases dominadas no fim do dia (foto do dia). */
  known: number;
}

export const emptyDay = (): DayStats => ({ learned: 0, reviews: 0, hits: 0, spoken: 0, spokenSum: 0, ai: 0, known: 0 });

const PREFIX = "papo-reto:v1";
const LAST_USER = "papo-reto:user";
const MAX_VISITS = 400;

export const emptyData = (): SavedData => ({
  start: null, visits: [], progress: {}, installHintDismissed: false,
  reminderTime: "20:00", reminderAdded: false, dialogues: {}, supportPromptAt: null, history: {},
});

/** Cada usuário tem a sua cópia no aparelho, então duas pessoas no mesmo celular não se misturam. */
const keyFor = (user: string): string => `${PREFIX}:${user.toLowerCase()}`;

function read(key: string): Partial<SavedData> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<SavedData>) : null;
  } catch {
    return null;
  }
}

export function load(user: string): SavedData {
  const own = read(keyFor(user));
  if (own) return { ...emptyData(), ...own };
  // Progresso de antes de existir login: o primeiro usuário que entrar neste aparelho herda.
  const legacy = read(PREFIX);
  if (legacy) {
    try {
      localStorage.removeItem(PREFIX);
    } catch {
      // segue sem apagar
    }
    return { ...emptyData(), ...legacy };
  }
  return emptyData();
}

export function save(user: string, data: SavedData): void {
  try {
    localStorage.setItem(keyFor(user), JSON.stringify({ ...data, visits: data.visits.slice(-MAX_VISITS) }));
  } catch {
    // Modo privado ou armazenamento cheio: o app segue funcionando sem salvar.
  }
}

/** Último usuário logado: permite abrir o app offline sem pedir login de novo. */
export function lastUser(): string | null {
  try {
    return localStorage.getItem(LAST_USER);
  } catch {
    return null;
  }
}

export function setLastUser(user: string | null): void {
  try {
    if (user) localStorage.setItem(LAST_USER, user);
    else localStorage.removeItem(LAST_USER);
  } catch {
    // ignora
  }
}

/** Chave de IA do próprio usuário: fica só neste aparelho (nunca vai pro banco). */
export interface AiKey {
  key: string;
  model: string;
}

const aiKeyFor = (user: string): string => `papo-reto:ai:${user.toLowerCase()}`;

export function loadAiKey(user: string): AiKey | null {
  try {
    const raw = localStorage.getItem(aiKeyFor(user));
    return raw ? (JSON.parse(raw) as AiKey) : null;
  } catch {
    return null;
  }
}

export function saveAiKey(user: string, value: AiKey | null): void {
  try {
    if (value) localStorage.setItem(aiKeyFor(user), JSON.stringify(value));
    else localStorage.removeItem(aiKeyFor(user));
  } catch {
    // sem armazenamento: a chave vale só até fechar o app
  }
}

/** PIX do projeto, guardado pra mostrar o apoio também offline. */
const PIX = "papo-reto:pix";
export function loadPix(): import("./pix").PixConfig | null {
  try {
    const raw = localStorage.getItem(PIX);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function savePix(pix: import("./pix").PixConfig | null): void {
  try {
    if (pix) localStorage.setItem(PIX, JSON.stringify(pix));
    else localStorage.removeItem(PIX);
  } catch {
    // ignora
  }
}
