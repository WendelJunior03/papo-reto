/**
 * Lembrete diário por notificação: a pessoa escolhe o horário ("HH:MM") e o fuso vem do
 * aparelho (IANA, ex.: America/Sao_Paulo). O cron do Worker roda a cada minuto e manda
 * o lembrete de quem chegou na hora — no máximo um por dia (last_sent).
 */
import type { Db } from "./db";
import { pushUser, writeOutbox, type PushMessage, type Vapid } from "./push";

export interface ReminderRow {
  user_id: number;
  time: string;
  tz: string;
  last_sent: string | null;
}

/** Se o cron pular um minuto (ou dois), o lembrete ainda sai atrasado nesse intervalo. */
export const LATE_MINUTES = 3;

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Fuso aceito pelo Intl (o mesmo que o cron vai usar pra calcular a hora local). */
export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** Data local ("AAAA-MM-DD") e minuto do dia (0–1439) de `now` no fuso `tz`. */
export function localNow(now: Date, tz: string): { date: string; minute: number } {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    formats.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/**
 * Hora de mandar? Devolve o dia local a que o lembrete pertence (pra gravar em last_sent)
 * ou null. Vale do minuto marcado até LATE_MINUTES depois, uma vez por dia — inclusive
 * quando o atraso cruza a meia-noite (23:59 enviado às 00:01 conta pro dia anterior).
 */
export function reminderDueDay(r: Pick<ReminderRow, "time" | "tz" | "last_sent">, now: Date, late = LATE_MINUTES): string | null {
  if (!HHMM.test(r.time)) return null;
  const [hh, mm] = r.time.split(":").map(Number);
  const target = hh! * 60 + mm!;
  const { minute } = localNow(now, r.tz);
  const diff = (((minute - target) % 1440) + 1440) % 1440;
  if (diff > late) return null;
  const day = localNow(new Date(now.getTime() - diff * 60_000), r.tz).date;
  return r.last_sent === day ? null : day;
}

/** Quantas revisões estão vencidas no progresso salvo (SavedData.progress[id].due <= hoje). */
export function dueReviews(progressJson: string | null, today: string): number {
  if (!progressJson) return 0;
  try {
    const progress = (JSON.parse(progressJson) as { progress?: Record<string, { due?: unknown }> }).progress ?? {};
    return Object.values(progress).filter((c) => typeof c?.due === "string" && c.due <= today).length;
  } catch {
    return 0;
  }
}

export function reminderMessage(due: number): PushMessage {
  const extra = due > 0 ? ` E ${due === 1 ? "tem 1 revisão" : `tem ${due} revisões`} te esperando.` : "";
  return { title: "Papo Reto", body: `Seu pacote do dia chegou!${extra}`, url: "./#hoje" };
}

/** Rodado pelo cron do Worker a cada minuto: manda os lembretes que chegaram na hora. */
export async function sendDueReminders(db: Db, v: Vapid, now = new Date()): Promise<number> {
  // São poucos usuários: lê todos os ativos e decide aqui (o fuso de cada um muda a conta).
  const rows = await db.all<ReminderRow>("SELECT user_id, time, tz, last_sent FROM reminders WHERE enabled = 1");
  let sent = 0;
  for (const r of rows) {
    const day = reminderDueDay(r, now);
    if (!day) continue;
    // Marca antes de enviar: se algo falhar no meio, não manda em dobro no próximo minuto.
    await db.run("UPDATE reminders SET last_sent = ? WHERE user_id = ?", day, r.user_id);
    const user = await db.first<{ progress: string | null }>("SELECT progress FROM users WHERE id = ?", r.user_id);
    await writeOutbox(db, r.user_id, "reminder", reminderMessage(dueReviews(user?.progress ?? null, day)), now.getTime());
    sent += await pushUser(db, v, r.user_id);
  }
  return sent;
}
