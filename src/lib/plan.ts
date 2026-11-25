/** "Plano de hoje" da aba Hoje: o que já foi feito hoje, tirado do progresso salvo. */
import type { DateKey } from "./dates";
import { isKnown } from "./srs";
import type { SavedData } from "./storage";

export type PlanItem = "frases" | "dialogo" | "revisao" | "musica";
export type PlanDone = Record<PlanItem, boolean>;

export interface PlanInput {
  data: SavedData;
  today: DateKey;
  /** IDs das frases do pacote do dia. */
  packIds: string[];
  /** Revisões vencidas agora (frases + palavras das músicas). */
  due: number;
}

export function todayPlan({ data, today, packIds, due }: PlanInput): PlanDone {
  const day = data.history[today];
  return {
    frases: packIds.length > 0 && packIds.every((id) => isKnown(data.progress[id])),
    // Recorde de diálogo batido hoje também conta (dados de antes do dialogueAt).
    dialogo: data.dialogueAt === today || Object.values(data.dialogues).some((d) => d.date === today),
    revisao: due === 0 || data.practiceAt === today,
    // Música terminada hoje, ou ao menos uma lacuna respondida hoje.
    musica: Object.values(data.songs).some((sg) => sg.date === today) || (day?.listen ?? 0) > 0,
  };
}
