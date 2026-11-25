/**
 * Convites de amigos e selos. Usado no servidor (gerar e conferir o código, calcular os selos)
 * e no app (barra de progresso e textos), por isso não depende de nada do navegador nem do banco.
 */

/** Sem letras e números que se confundem (0/O, 1/I/L). 31 símbolos. */
export const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const INVITE_LENGTH = 8;
const INVITE_RE = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_LENGTH}}$`);

/** Código pessoal: 8 símbolos sorteados com Web Crypto (31^8 ≈ 850 bilhões de combinações). */
export function inviteCode(): string {
  const out: string[] = [];
  const max = 256 - (256 % INVITE_ALPHABET.length); // descarta o resto pra não enviesar
  while (out.length < INVITE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < max && out.length < INVITE_LENGTH) out.push(INVITE_ALPHABET[b % INVITE_ALPHABET.length]!);
    }
  }
  return out.join("");
}

/** O que a pessoa digitou ("abcd-efgh", " AbCd EfGh ") no formato guardado, ou null se não pode ser um código pessoal. */
export function normalizeInvite(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  return INVITE_RE.test(code) ? code : null;
}

/** Link que a pessoa manda pros amigos. */
export const inviteLink = (origin: string, code: string): string => `${origin}/?convite=${code}`;

export type BadgeId = "amigo" | "turma" | "embaixador" | "lenda";

export interface Badge {
  id: BadgeId;
  name: string;
  /** Amigos que precisam entrar com o convite. */
  friends: number;
}

/** Do menor pro maior. */
export const BADGES: readonly Badge[] = [
  { id: "amigo", name: "Primeiro amigo", friends: 1 },
  { id: "turma", name: "Turma formada", friends: 3 },
  { id: "embaixador", name: "Embaixador", friends: 5 },
  { id: "lenda", name: "Lenda do Papo", friends: 10 },
];

export const badgeById = (id: string | null | undefined): Badge | undefined => BADGES.find((b) => b.id === id);

/** Selos conquistados com `friends` amigos, do menor pro maior. */
export const earnedBadges = (friends: number): BadgeId[] => BADGES.filter((b) => friends >= b.friends).map((b) => b.id);

/** Próximo selo e quanto falta (null quando já tem todos). `progress` vai de 0 a 1 desde o selo anterior. */
export function nextBadge(friends: number): { badge: Badge; missing: number; progress: number } | null {
  const i = BADGES.findIndex((b) => friends < b.friends);
  if (i < 0) return null;
  const badge = BADGES[i]!;
  const from = i ? BADGES[i - 1]!.friends : 0;
  return { badge, missing: badge.friends - friends, progress: (friends - from) / (badge.friends - from) };
}

/** Selo em uso só vale se ainda está conquistado (um amigo pode ter apagado a conta). */
export const validBadge = (equipped: string | null | undefined, friends: number): BadgeId | null =>
  equipped && earnedBadges(friends).includes(equipped as BadgeId) ? (equipped as BadgeId) : null;

/** Selos novos (que a pessoa ainda não viu), do maior pro menor. */
export const newBadges = (earned: readonly BadgeId[], seen: readonly string[]): BadgeId[] =>
  earned.filter((b) => !seen.includes(b)).reverse();
