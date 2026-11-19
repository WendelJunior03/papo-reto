/**
 * Senhas e sessões só com Web Crypto (funciona igual no Bun e no Cloudflare Worker).
 * - Senha: PBKDF2-SHA256, 100 mil iterações (o máximo aceito pelo Workers), sal aleatório por usuário.
 * - Sessão: token aleatório no cookie (HttpOnly); no banco fica só o hash do token.
 */
import type { Db } from "./db";

const ITERATIONS = 100_000;
const SESSION_DAYS = 30;
export const COOKIE = "papo_session";
export const MAX_FAILED = 5;
export const LOCK_MINUTES = 10;

const enc = new TextEncoder();
const toHex = (buf: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (bytes: number): string => toHex(crypto.getRandomValues(new Uint8Array(bytes)));

export async function hashPassword(password: string, saltHex = randomHex(16)): Promise<{ hash: string; salt: string }> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
  return { hash: toHex(bits), salt: saltHex };
}

/** Comparação em tempo constante, pra não vazar informação pelo tempo de resposta. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  return sameHex((await hashPassword(password, salt)).hash, hash);
}

const sha256 = async (s: string): Promise<string> => toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

export async function createSession(db: Db, userId: number, now = Date.now()): Promise<{ token: string; expires: number }> {
  const token = randomHex(32);
  const expires = now + SESSION_DAYS * 86_400_000;
  await db.run("DELETE FROM sessions WHERE expires_at < ?", now);
  await db.run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", await sha256(token), userId, expires);
  return { token, expires };
}

export interface SessionUser {
  id: number;
  username: string;
}

export async function userFromRequest(db: Db, req: Request, now = Date.now()): Promise<SessionUser | null> {
  const token = readCookie(req, COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return db.first<SessionUser>(
    "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
    await sha256(token),
    now,
  );
}

export async function destroySession(db: Db, req: Request): Promise<void> {
  const token = readCookie(req, COOKIE);
  if (token) await db.run("DELETE FROM sessions WHERE token_hash = ?", await sha256(token));
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Cookie da sessão. `Secure` só em HTTPS (no http://localhost ou IP da rede ele seria recusado). */
export function sessionCookie(req: Request, token: string, expires: number): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure}`;
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
