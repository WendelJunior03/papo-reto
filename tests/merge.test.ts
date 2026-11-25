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

import { shouldShowDailySupport } from "../src/state";

test("janela do PIX: uma vez por dia, só pra quem não apoiou e se tiver PIX", () => {
  const base = { ...emptyData(), visits: ["2026-11-17", "2026-11-18", "2026-11-19"] };
  expect(shouldShowDailySupport(base, "2026-11-19", true)).toBe(true);
  expect(shouldShowDailySupport({ ...base, supportPromptAt: "2026-11-19" }, "2026-11-19", true)).toBe(false);
  expect(shouldShowDailySupport({ ...base, supportPromptAt: "2026-11-18" }, "2026-11-19", true)).toBe(true);
  expect(shouldShowDailySupport({ ...base, supported: true }, "2026-11-19", true)).toBe(false);
  expect(shouldShowDailySupport(base, "2026-11-19", false)).toBe(false);
});

test("janela do PIX: novato não vê; só do 3º dia de uso em diante", () => {
  const today = "2026-11-19";
  const at = (visits: string[]) => shouldShowDailySupport({ ...emptyData(), visits }, today, true);
  expect(at([])).toBe(false);
  expect(at([today])).toBe(false); // 1º dia
  expect(at(["2026-11-18", today])).toBe(false); // 2º dia
  expect(at(["2026-11-18", "2026-11-18", today])).toBe(false); // mesmo dia repetido não conta
  expect(at(["2026-11-10", "2026-11-18", today])).toBe(true); // 3º dia (não precisa ser seguido)
  expect(at(["2026-11-10", "2026-11-18"])).toBe(true); // hoje ainda não registrado
  expect(at(["2026-11-18", today, "2026-11-20"])).toBe(false); // dia futuro (relógio de outro aparelho) não conta
});

test("quem apoiou num aparelho fica como apoiador nos outros", () => {
  expect(mergeData({ ...emptyData() }, { supported: true }).supported).toBe(true);
});

import { wasOnboarded } from "../src/lib/storage";

test("boas-vindas: quem já tinha progresso não vê de novo", () => {
  expect(wasOnboarded({})).toBe(false);
  expect(wasOnboarded({ visits: ["2026-11-19"] })).toBe(false);
  expect(wasOnboarded({ progress: { a: { box: 1, due: "2026-11-20" } } })).toBe(true);
  expect(wasOnboarded({ visits: ["2026-11-18", "2026-11-19"] })).toBe(true);
  expect(wasOnboarded({ visits: ["2026-11-18", "2026-11-19"], onboarded: false })).toBe(false);
  // Aparelho novo (sem nada) + conta antiga no servidor: não mostra.
  expect(mergeData({ ...emptyData() }, { progress: { a: { box: 1, due: "2026-11-20" } } }).onboarded).toBe(true);
  expect(mergeData({ ...emptyData() }, { onboarded: true }).onboarded).toBe(true);
  expect(mergeData({ ...emptyData() }, { visits: [] }).onboarded).toBe(false);
});
