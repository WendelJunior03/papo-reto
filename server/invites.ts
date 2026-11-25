/**
 * Convites de amigos e selos (tabela invites, migração 0006).
 * Um amigo conta quando cria a conta com o código pessoal de alguém.
 */
import { earnedBadges, inviteCode, inviteLink, normalizeInvite, validBadge, type BadgeId } from "../src/lib/invites";
import type { Db } from "./db";

/** Quem é dono deste código pessoal (null se o código não existe ou nem tem o formato). */
export async function inviterByCode(db: Db, raw: string): Promise<number | null> {
  const code = normalizeInvite(raw);
  if (!code) return null;
  const row = await db.first<{ user_id: number }>("SELECT user_id FROM invites WHERE code = ?", code);
  return row?.user_id ?? null;
}

/** Guarda quem convidou a conta nova. */
export async function recordInvitedBy(db: Db, userId: number, inviterId: number): Promise<void> {
  await db.run(
    "INSERT INTO invites (user_id, invited_by) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET invited_by = excluded.invited_by",
    userId,
    inviterId,
  );
}

/** Código pessoal, gerado na primeira vez que a pessoa pede. Sorteia de novo se bater com outro (quase impossível). */
export async function ensureCode(db: Db, userId: number): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const row = await db.first<{ code: string | null }>("SELECT code FROM invites WHERE user_id = ?", userId);
    if (row?.code) return row.code;
    try {
      // O WHERE não deixa trocar um código que já existe (dois pedidos ao mesmo tempo).
      await db.run(
        "INSERT INTO invites (user_id, code) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET code = excluded.code WHERE invites.code IS NULL",
        userId,
        inviteCode(),
      );
    } catch {
      // código repetido (UNIQUE): tenta outro
    }
  }
  throw new Error("Não deu pra gerar o código de convite.");
}

/** Amigos que entraram com o convite, selos conquistados e o selo em uso. */
export async function badgeState(db: Db, userId: number): Promise<{ friends: number; badges: BadgeId[]; badge: BadgeId | null }> {
  const row = await db.first<{ friends: number; badge: string | null }>(
    "SELECT (SELECT COUNT(*) FROM invites WHERE invited_by = ?) AS friends, (SELECT badge FROM invites WHERE user_id = ?) AS badge",
    userId,
    userId,
  );
  const friends = row?.friends ?? 0;
  return { friends, badges: earnedBadges(friends), badge: validBadge(row?.badge, friends) };
}

/** Tudo que o cartão "Convide amigos" precisa. */
export async function inviteInfo(db: Db, userId: number, origin: string) {
  const code = await ensureCode(db, userId);
  return { code, link: inviteLink(origin, code), ...(await badgeState(db, userId)) };
}

/** Coloca (ou tira, com null) o selo em uso. Devolve false se o selo não foi conquistado. */
export async function equipBadge(db: Db, userId: number, badge: BadgeId | null): Promise<boolean> {
  if (badge && !(await badgeState(db, userId)).badges.includes(badge)) return false;
  await db.run(
    "INSERT INTO invites (user_id, badge) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET badge = excluded.badge",
    userId,
    badge,
  );
  return true;
}
