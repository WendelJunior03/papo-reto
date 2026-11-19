/**
 * Junta o progresso deste aparelho com o salvo no servidor (ex.: usou no celular e no computador).
 * Regra: nada se perde — fica o mais avançado de cada lado.
 */
import { emptyDay, type DayStats, type SavedData } from "./storage";
import type { CardState } from "./srs";

function betterCard(a: CardState | undefined, b: CardState | undefined): CardState | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.box !== b.box) return a.box > b.box ? a : b;
  return a.due >= b.due ? a : b;
}

export function mergeData(local: SavedData, remote: Partial<SavedData> | null): SavedData {
  if (!remote) return local;
  const progress: SavedData["progress"] = { ...remote.progress };
  for (const [id, card] of Object.entries(local.progress)) {
    const best = betterCard(card, progress[id]);
    if (best) progress[id] = best;
  }

  const dialogues: SavedData["dialogues"] = { ...remote.dialogues };
  for (const [id, d] of Object.entries(local.dialogues)) {
    const r = dialogues[id];
    if (!r || d.best > r.best || (d.best === r.best && d.date > r.date)) dialogues[id] = d;
  }

  // Histórico: por dia, fica o maior valor de cada número (o mesmo dia contado em dois aparelhos não soma duas vezes).
  const history: SavedData["history"] = { ...remote.history };
  for (const [day, l] of Object.entries(local.history ?? {})) {
    const r = history[day] ?? emptyDay();
    const merged = { ...emptyDay() };
    for (const k of Object.keys(merged) as (keyof DayStats)[]) merged[k] = Math.max(l[k] ?? 0, r[k] ?? 0);
    history[day] = merged;
  }

  const starts = [local.start, remote.start].filter((x): x is string => !!x).sort();
  return {
    ...local,
    // Começo mais antigo mantém a sequência de pacotes de quem já vinha usando.
    start: starts[0] ?? null,
    visits: [...new Set([...(remote.visits ?? []), ...local.visits])].sort(),
    progress,
    dialogues,
    history,
    installHintDismissed: local.installHintDismissed || !!remote.installHintDismissed,
    reminderAdded: local.reminderAdded || !!remote.reminderAdded,
    supported: local.supported || !!remote.supported,
    supportPromptAt: [local.supportPromptAt, remote.supportPromptAt].filter((x): x is string => !!x).sort().at(-1) ?? null,
    reminderTime: local.reminderAdded ? local.reminderTime : (remote.reminderTime ?? local.reminderTime),
  };
}
