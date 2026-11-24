import { describe, expect, test } from "bun:test";
import { badges, heatmap, knownSeries, levelFor, longestStreak, memoryBuckets, spokenSeries, weekSummary } from "../src/lib/stats";
import { emptyData, emptyDay } from "../src/lib/storage";

const day = (o: Partial<ReturnType<typeof emptyDay>>) => ({ ...emptyDay(), ...o });

describe("evolução", () => {
  test("nível e quanto falta pro próximo", () => {
    expect(levelFor(0)).toMatchObject({ index: 1, name: "Primeiros passos", missing: 20 });
    expect(levelFor(30)).toMatchObject({ index: 2, name: "Já se vira", missing: 30 });
    expect(levelFor(30).progress).toBeCloseTo(0.25);
    expect(levelFor(300)).toMatchObject({ name: "Papo reto total", next: null, progress: 1 });
  });
  test("maior sequência", () => {
    expect(longestStreak(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06"])).toBe(3);
    expect(longestStreak([])).toBe(0);
  });
  test("semana atual contra a anterior", () => {
    const data = { ...emptyData(), visits: ["2026-11-19", "2026-11-18", "2026-11-10"],
      history: { "2026-11-19": day({ learned: 3, reviews: 5, spoken: 2, spokenSum: 1.6 }), "2026-11-10": day({ learned: 1 }) } };
    const w = weekSummary(data, "2026-11-19");
    expect(w.now).toEqual({ days: 2, learned: 3, reviews: 5, spoken: 0.8 });
    expect(w.before).toMatchObject({ days: 1, learned: 1, spoken: null });
  });
  test("mapa de calor: 16 semanas de domingo a sábado, intensidade pelo que fez", () => {
    const data = { ...emptyData(), visits: ["2026-11-19"], history: { "2026-11-19": day({ learned: 5, reviews: 10 }) } };
    const cols = heatmap(data, "2026-11-19");
    expect(cols.length).toBe(16);
    expect(cols.every((c) => c.length === 7)).toBe(true);
    const today = cols.flat().find((c) => c.date === "2026-11-19")!;
    expect(today.level).toBe(3);
    expect(cols.at(-1)!.at(-1)!.future).toBe(true); // sábado 21/11
  });
  test("força da memória por caixa", () => {
    expect(memoryBuckets({ a: { box: 0, due: "x" }, b: { box: 1, due: "x" }, c: { box: 5, due: "x" }, d: { box: 4, due: "x" } })).toEqual([1, 1, 0, 0, 2]);
  });
  test("série de frases dominadas repete o último valor nos dias sem uso", () => {
    const data = { ...emptyData(), history: { "2026-11-10": day({ known: 4 }), "2026-11-17": day({ known: 9 }) } };
    const s = knownSeries(data, "2026-11-19", 10);
    expect(s.map((p) => p.value)).toEqual([4, 4, 4, 4, 4, 4, 4, 9, 9, 9]);
  });
  test("série da fala só nos dias em que falou", () => {
    const data = { ...emptyData(), history: { "2026-11-18": day({ spoken: 2, spokenSum: 1.5 }), "2026-11-19": day({ learned: 1 }) } };
    expect(spokenSeries(data, "2026-11-19")).toEqual([{ date: "2026-11-18", value: 0.75 }]);
  });
  test("conquistas mostram o que falta", () => {
    const b = badges({ known: 12, studyDays: 3, packsDone: 1, dialogues: 0, perfect: false, aiMsgs: 0 });
    expect(b.find((x) => x.id === "first")!.done).toBe(true);
    expect(b.find((x) => x.id === "week")!.left).toBe("faltam 4 dias");
    expect(b.find((x) => x.id === "fifty")!.left).toBe("faltam 38 frases");
    expect(badges({ known: 0, studyDays: 0, packsDone: 9, dialogues: 0, perfect: false, aiMsgs: 0 }).find((x) => x.id === "packs")!.left).toBe("falta 1 pacote");
  });
});

import { listeningSummary, listenSeries, songProgress } from "../src/lib/stats";
import { mergeData as merge2 } from "../src/lib/merge";

describe("ouvido (música)", () => {
  const data = {
    ...emptyData(),
    history: {
      "2026-11-10": day({ listen: 10, listenHits: 5 }),
      "2026-11-18": day({ listen: 10, listenHits: 7 }),
      "2026-11-19": day({ listen: 10, listenHits: 9 }),
    },
    songs: {
      jireh: { title: "Jireh", best: 9, total: 10, level: "facil", date: "2026-11-19",
        attempts: [{ date: "2026-11-10", hits: 5, total: 10, level: "facil" }, { date: "2026-11-19", hits: 9, total: 10, level: "facil" }] },
      antiga: { title: "Sem tentativas guardadas", best: 3, total: 4, level: "medio", date: "2026-11-01" },
    },
  };
  test("acerto geral e da semana comparado com a anterior", () => {
    const ls = listeningSummary(data, "2026-11-19");
    expect(ls.pct).toBeCloseTo(0.7);
    expect(ls.now).toEqual({ answered: 20, pct: 0.8 });
    expect(ls.before).toEqual({ answered: 10, pct: 0.5 });
    expect(ls.songs).toBe(2);
  });
  test("série diária de acerto", () => {
    expect(listenSeries(data, "2026-11-19").map((p) => p.value)).toEqual([0.5, 0.7, 0.9]);
  });
  test("comparativo por música: primeira, última e melhor (e músicas antigas sem tentativas)", () => {
    const [j, a] = songProgress(data);
    expect(j).toMatchObject({ title: "Jireh", attempts: 2, first: 0.5, last: 0.9, best: 0.9 });
    expect(a).toMatchObject({ attempts: 1, first: 0.75, last: 0.75 });
  });
  test("tentativas de dois aparelhos se juntam sem repetir", () => {
    const a1 = { date: "2026-11-10", hits: 5, total: 10, level: "facil" };
    const a2 = { date: "2026-11-19", hits: 9, total: 10, level: "facil" };
    const m = merge2({ ...emptyData(), songs: { j: { title: "J", best: 5, total: 10, level: "facil", date: "2026-11-10", attempts: [a1] } } },
      { songs: { j: { title: "J", best: 9, total: 10, level: "facil", date: "2026-11-19", attempts: [a1, a2] } } });
    expect(m.songs.j!.attempts).toEqual([a1, a2]);
    expect(m.songs.j!.best).toBe(9);
  });
});
