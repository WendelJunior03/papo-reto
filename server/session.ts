/** Regras da sessão de conversa com a IA do app: X minutos de conversa e Y minutos de espera. */
export interface SessionConfig {
  minutes: number;
  cooldownMinutes: number;
  maxMessages: number;
}

export const DEFAULT_SESSION: SessionConfig = { minutes: 7, cooldownMinutes: 60, maxMessages: 40 };

export interface SessionRow {
  started_at: number;
  ends_at: number;
  messages: number;
}

export type SessionState =
  | { state: "ready"; minutes: number }
  | { state: "active"; endsAt: number; messagesLeft: number }
  | { state: "cooldown"; endedAt: number; availableAt: number };

/** Mensagem que chega logo depois do fim ainda é respondida (a pessoa já tinha começado a digitar). */
const GRACE_MS = 30_000;

export function sessionState(row: SessionRow | null, now: number, cfg: SessionConfig, grace = false): SessionState {
  if (!row) return { state: "ready", minutes: cfg.minutes };
  const availableAt = row.ends_at + cfg.cooldownMinutes * 60_000;
  if (now < row.ends_at + (grace ? GRACE_MS : 0)) {
    return { state: "active", endsAt: row.ends_at, messagesLeft: Math.max(0, cfg.maxMessages - row.messages) };
  }
  if (now < availableAt) return { state: "cooldown", endedAt: row.ends_at, availableAt };
  return { state: "ready", minutes: cfg.minutes };
}
