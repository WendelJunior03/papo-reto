import { expect, test } from "bun:test";
import { mergeData } from "../src/lib/merge";
import { emptyData } from "../src/lib/storage";

test("junta progresso de dois aparelhos sem perder nada", () => {
  const phone = { ...emptyData(), start: "2026-11-10", visits: ["2026-11-10", "2026-11-12"],
    progress: { a: { box: 3, due: "2026-11-20" }, b: { box: 1, due: "2026-11-13" } },
    dialogues: { cafe: { best: 0.8, date: "2026-11-12" } } };
  const laptop = { ...emptyData(), start: "2026-11-11", visits: ["2026-11-11", "2026-11-12"],
    progress: { a: { box: 1, due: "2026-11-12" }, c: { box: 2, due: "2026-11-15" } },
    dialogues: { cafe: { best: 0.95, date: "2026-11-11" } } };
  const m = mergeData(phone, laptop);
  expect(m.start).toBe("2026-11-10");
  expect(m.visits).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
  expect(m.progress).toEqual({ a: { box: 3, due: "2026-11-20" }, b: { box: 1, due: "2026-11-13" }, c: { box: 2, due: "2026-11-15" } });
  expect(m.dialogues.cafe!.best).toBe(0.95);
});

test("sem nada no servidor, fica o do aparelho", () => {
  const local = { ...emptyData(), start: "2026-11-19" };
  expect(mergeData(local, null)).toBe(local);
});
