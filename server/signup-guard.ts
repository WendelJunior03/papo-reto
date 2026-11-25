/**
 * Proteção do cadastro aberto: limite por rede (IP) e um teto geral por dia.
 * O IP nunca é guardado puro: vira um hash curto, só pra contar tentativas.
 */
import type { Db } from "./db";

export interface SignupLimits {
  /** Contas criadas por rede, por hora. */
  perHour: number;
  /** Tentativas (certas ou erradas) por rede, por hora: segura chute de código e robô insistente. */
  attemptsPerHour: number;
  /** Contas criadas no app inteiro em 24 h (freio de emergência contra cadastro em massa). */
  perDay: number;
}

export const DEFAULT_SIGNUP_LIMITS: SignupLimits = { perHour: 3, attemptsPerHour: 10, perDay: 100 };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Hash do IP (Cloudflare manda em CF-Connecting-IP; no servidor local fica "local"). */
export async function networkKey(req: Request): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") ?? "local";
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`papo-reto:${ip}`)));
  return [...bytes.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Mensagem de bloqueio, ou null se pode tentar. Registra a tentativa quando libera. */
export async function checkSignup(db: Db, key: string, limits: SignupLimits, now = Date.now()): Promise<string | null> {
  await db.run("DELETE FROM signup_log WHERE at < ?", now - DAY);
  const net = await db.first<{ tries: number; made: number }>(
    "SELECT COALESCE(SUM(1 - ok), 0) AS tries, COALESCE(SUM(ok), 0) AS made FROM signup_log WHERE ip = ? AND at >= ?",
    key,
    now - HOUR,
  );
  if ((net?.made ?? 0) >= limits.perHour) return "Muitas contas criadas por esta rede. Tente de novo daqui a uma hora.";
  if ((net?.tries ?? 0) >= limits.attemptsPerHour) return "Muitas tentativas de cadastro. Tente de novo daqui a uma hora.";
  const day = await db.first<{ made: number }>("SELECT COALESCE(SUM(ok), 0) AS made FROM signup_log WHERE at >= ?", now - DAY);
  if ((day?.made ?? 0) >= limits.perDay) return "O cadastro está cheio por hoje. Tente de novo amanhã.";
  await db.run("INSERT INTO signup_log (ip, at, ok) VALUES (?, ?, 0)", key, now);
  return null;
}

/** Conta criada: entra no limite por rede e no teto do dia. */
export async function signupDone(db: Db, key: string, now = Date.now()): Promise<void> {
  await db.run("INSERT INTO signup_log (ip, at, ok) VALUES (?, ?, 1)", key, now);
}
