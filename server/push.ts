/**
 * Notificações (Web Push) sem biblioteca: só Web Crypto, funciona no Bun e no Worker.
 * As notificações vão sem conteúdo (o service worker mostra um texto fixo), então não
 * precisa criptografar a mensagem — só assinar o pedido com a chave VAPID do app.
 */
import type { Db } from "./db";

export interface Vapid {
  /** Chave pública em base64url (formato "raw", 65 bytes) — vai pro navegador. */
  publicKey: string;
  /** Chave privada em JWK (JSON). Segredo do servidor. */
  privateJwk: string;
  /** Contato do remetente exigido pelo padrão (URL ou mailto:). */
  subject: string;
}

const b64url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s: string): string => b64url(new TextEncoder().encode(s));

/** JWT ES256 pro servidor de push (o "aud" é a origem do endpoint). */
export async function vapidJwt(endpoint: string, v: Vapid): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", JSON.parse(v.privateJwk), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64urlText(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64urlText(
    JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: v.subject }),
  );
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

/** Manda um "toque" pro aparelho. Devolve false se a inscrição não vale mais (apagar). */
export async function sendPush(endpoint: string, v: Vapid): Promise<boolean> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${await vapidJwt(endpoint, v)}, k=${v.publicKey}`,
      TTL: "3600",
      Urgency: "normal",
      "Content-Length": "0",
    },
  });
  return !(res.status === 404 || res.status === 410);
}

/** Gera um par de chaves VAPID (rodado uma vez: `bun scripts/vapid.ts`). */
export async function generateVapid(): Promise<{ publicKey: string; privateJwk: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return {
    publicKey: b64url(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateJwk: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)),
  };
}

export async function schedulePush(db: Db, userId: number, kind: string, dueAt: number): Promise<void> {
  await db.run(
    "INSERT INTO push_jobs (user_id, kind, due_at) VALUES (?, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET due_at = excluded.due_at",
    userId,
    kind,
    dueAt,
  );
}

/** Rodado pelo cron do Worker a cada minuto: envia os avisos vencidos. */
export async function sendDuePushes(db: Db, v: Vapid, now = Date.now()): Promise<number> {
  const jobs = await db.all<{ user_id: number; kind: string }>("SELECT user_id, kind FROM push_jobs WHERE due_at <= ? LIMIT 50", now);
  let sent = 0;
  for (const job of jobs) {
    await db.run("DELETE FROM push_jobs WHERE user_id = ? AND kind = ?", job.user_id, job.kind);
    const subs = await db.all<{ endpoint: string }>("SELECT endpoint FROM push_subs WHERE user_id = ?", job.user_id);
    for (const { endpoint } of subs) {
      try {
        if (await sendPush(endpoint, v)) sent++;
        else await db.run("DELETE FROM push_subs WHERE endpoint = ?", endpoint);
      } catch {
        // aparelho fora do ar: tenta na próxima vez que houver aviso
      }
    }
  }
  return sent;
}
