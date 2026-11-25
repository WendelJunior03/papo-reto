/** Chamadas ao servidor do app (login e sincronização do progresso). */
import type { SavedData } from "./storage";
import type { PixConfig } from "./pix";

/** Respostas do painel do dono (o servidor confere quem é dono). */
export type AdminStats = Awaited<ReturnType<typeof import("../../server/admin").adminStats>>;
export type AdminUser = Awaited<ReturnType<typeof import("../../server/admin").adminUsers>>[number];

/** Lembrete diário por notificação ("HH:MM" no fuso IANA do aparelho). */
export interface Reminder {
  time: string;
  tz: string;
  enabled: boolean;
}

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
  me: () => call<{ username: string; serverAi: boolean; push?: boolean; musicSearch?: boolean; pix: PixConfig | null; admin?: boolean }>("GET", "me"),
  aiSession: () => call<import("../../server/session").SessionState>("GET", "ai/session"),
  pushKey: () => call<{ publicKey: string }>("GET", "push/key"),
  pushSubscribe: (sub: PushSubscriptionJSON) => call<{ ok: true }>("POST", "push/subscribe", sub),
  getReminder: () => call<Reminder | null>("GET", "reminder"),
  putReminder: (r: Reminder) => call<Reminder>("PUT", "reminder", r),
  login: (username: string, password: string) => call<{ username: string }>("POST", "auth/login", { username, password }),
  signup: (username: string, password: string, code: string) =>
    call<{ username: string }>("POST", "auth/signup", { username, password, code }),
  logout: () => call<{ ok: true }>("POST", "auth/logout"),
  getProgress: () => call<{ data: Partial<SavedData> | null; updatedAt: string | null }>("GET", "progress"),
  adminStats: () => call<AdminStats>("GET", "admin/stats"),
  adminUsers: () => call<{ users: AdminUser[] }>("GET", "admin/users"),
  adminReset: (username: string) => call<{ username: string; password: string }>("POST", "admin/reset-password", { username }),
  putProgress: (data: SavedData) => call<{ ok: true }>("PUT", "progress", { data, updatedAt: new Date().toISOString() }),
};
