/** Chamadas ao servidor do app (login e sincronização do progresso). */
import type { SavedData } from "./storage";
import type { PixConfig } from "./pix";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`./api/${path}`, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Sem conexão com o servidor.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Erro ${res.status}`, res.status);
  return data;
}

export const api = {
  me: () => call<{ username: string; serverAi: boolean; push?: boolean; pix: PixConfig | null }>("GET", "me"),
  aiSession: () => call<import("../../server/session").SessionState>("GET", "ai/session"),
  pushKey: () => call<{ publicKey: string }>("GET", "push/key"),
  pushSubscribe: (sub: PushSubscriptionJSON) => call<{ ok: true }>("POST", "push/subscribe", sub),
  login: (username: string, password: string) => call<{ username: string }>("POST", "auth/login", { username, password }),
  signup: (username: string, password: string, code: string) =>
    call<{ username: string }>("POST", "auth/signup", { username, password, code }),
  logout: () => call<{ ok: true }>("POST", "auth/logout"),
  getProgress: () => call<{ data: Partial<SavedData> | null; updatedAt: string | null }>("GET", "progress"),
  putProgress: (data: SavedData) => call<{ ok: true }>("PUT", "progress", { data, updatedAt: new Date().toISOString() }),
};
