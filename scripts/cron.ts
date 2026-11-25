/**
 * O cron do Worker, imitado no Mac: a cada minuto manda os avisos agendados e os lembretes
 * diários (só com as chaves VAPID no .env). Com `bun --hot`, troca o timer a cada recarga.
 */
import type { ApiConfig } from "../server/api";
import { sendDuePushes } from "../server/push";
import { sendDueReminders } from "../server/reminders";

const g = globalThis as typeof globalThis & { papoCron?: ReturnType<typeof setInterval> };

export function startLocalCron(cfg: ApiConfig): void {
  clearInterval(g.papoCron);
  const vapid = cfg.vapid;
  if (!vapid) return;
  g.papoCron = setInterval(() => {
    void (async () => {
      await sendDuePushes(cfg.db, vapid);
      await sendDueReminders(cfg.db, vapid);
    })().catch((e) => console.error("cron:", e));
  }, 60_000);
}
