import { describe, expect, test } from "bun:test";
import { todayPlan } from "../src/lib/plan";
import { emptyData, emptyDay } from "../src/lib/storage";
import { mergeData } from "../src/lib/merge";

describe("plano de hoje", () => {
  const today = "2026-11-25";
  const packIds = ["a", "b"];
  const known = { box: 1, due: "2026-11-26", at: today };

  test("dia novo: só a revisão conta se não há nada vencido", () => {
    expect(todayPlan({ data: emptyData(), today, packIds, due: 0 })).toEqual({ frases: false, dialogo: false, revisao: true, musica: false });
    expect(todayPlan({ data: emptyData(), today, packIds, due: 3 }).revisao).toBe(false);
  });

  test("tudo feito hoje", () => {
    const data = {
      ...emptyData(),
      progress: { a: known, b: known },
      dialogueAt: today,
      practiceAt: today,
      songs: { v1: { title: "x", best: 3, total: 5, level: "facil", date: today } },
    };
    expect(todayPlan({ data, today, packIds, due: 4 })).toEqual({ frases: true, dialogo: true, revisao: true, musica: true });
  });

  test("feito ontem não conta hoje", () => {
    const y = "2026-11-24";
    const data = {
      ...emptyData(),
      progress: { a: known },
      dialogueAt: y,
      practiceAt: y,
      dialogues: { p1: { best: 1, date: y } },
      songs: { v1: { title: "x", best: 3, total: 5, level: "facil", date: y } },
    };
    expect(todayPlan({ data, today, packIds, due: 1 })).toEqual({ frases: false, dialogo: false, revisao: false, musica: false });
  });

  test("dados antigos: recorde de diálogo e lacunas de música de hoje contam", () => {
    const old = { ...emptyData(), dialogues: { p1: { best: 0.8, date: today } }, history: { [today]: { ...emptyDay(), listen: 2 } } };
    const { dialogueAt: _d, practiceAt: _p, ...legacy } = old;
    const done = todayPlan({ data: legacy as typeof old, today, packIds, due: 0 });
    expect(done.dialogo).toBe(true);
    expect(done.musica).toBe(true);
  });

  test("sincronização fica com a data mais recente", () => {
    const merged = mergeData({ ...emptyData(), practiceAt: "2026-11-20" }, { practiceAt: today });
    expect(merged.practiceAt).toBe(today);
    expect(merged.dialogueAt).toBeNull();
  });
});
