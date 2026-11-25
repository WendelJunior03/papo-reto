import { describe, expect, test } from "bun:test";
import { capEar, earAnswer, earDue, earKey, splitLine, type EarWords } from "../src/lib/ear";
import { mergeData } from "../src/lib/merge";
import { emptyData } from "../src/lib/storage";

const today = "2026-11-25";
const song = { line: "Your love never fails, it never gives up", title: "Never Fails", videoId: "abc123def45", t: 42.37 };

describe("palavras das músicas", () => {
  test("erro guarda a palavra com o trecho e fica pra hoje", () => {
    const ear: EarWords = {};
    earAnswer(ear, { ...song, word: "Fails" }, false, today);
    expect(ear.fails).toEqual({ word: "fails", line: song.line, title: "Never Fails", videoId: "abc123def45", t: 42.4, card: { box: 0, due: today }, seen: today });
  });

  test("acerto sobe a caixa só se a palavra já estava na revisão e venceu", () => {
    const ear: EarWords = {};
    earAnswer(ear, { ...song, word: "love" }, true, today);
    expect(ear.love).toBeUndefined();
    earAnswer(ear, { ...song, word: "love" }, false, today);
    earAnswer(ear, { ...song, word: "love" }, true, today);
    expect(ear.love!.card).toEqual({ box: 1, due: "2026-11-26", at: today });
    // refrão repetido no mesmo dia não sobe de novo
    earAnswer(ear, { ...song, word: "love" }, true, today);
    expect(ear.love!.card.box).toBe(1);
  });

  test("errar de novo volta pro começo e troca o trecho pela música mais recente", () => {
    const ear: EarWords = {};
    earAnswer(ear, { ...song, word: "never" }, false, "2026-11-01");
    ear.never!.card = { box: 3, due: "2026-12-01", at: "2026-11-02" };
    earAnswer(ear, { word: "never", line: "Never gonna give you up", title: "Rick", videoId: "dQw4w9WgXcQ", t: 10 }, false, today);
    expect(ear.never!.card).toEqual({ box: 0, due: today, at: "2026-11-02" });
    expect(ear.never!.title).toBe("Rick");
  });

  test("trecho e título longos são cortados", () => {
    const ear: EarWords = {};
    earAnswer(ear, { ...song, word: "love", line: "love ".repeat(80), title: "x".repeat(200) }, false, today);
    expect(ear.love!.line.length).toBe(120);
    expect(ear.love!.title.length).toBe(80);
  });

  test("limite: sai primeiro a mais dominada e, no empate, a mais antiga", () => {
    const ear: EarWords = {
      a: { word: "a", line: "", title: "", videoId: "", t: 0, card: { box: 0, due: today }, seen: "2026-11-01" },
      b: { word: "b", line: "", title: "", videoId: "", t: 0, card: { box: 4, due: today }, seen: "2026-11-20" },
      c: { word: "c", line: "", title: "", videoId: "", t: 0, card: { box: 4, due: today }, seen: "2026-11-10" },
      d: { word: "d", line: "", title: "", videoId: "", t: 0, card: { box: 1, due: today }, seen: "2026-11-05" },
    };
    capEar(ear, 2);
    expect(Object.keys(ear).sort()).toEqual(["a", "d"]);
  });

  test("erro numa lista cheia respeita o limite de 300", () => {
    const ear: EarWords = {};
    for (let i = 0; i < 305; i++) earAnswer(ear, { ...song, word: `word${"abcdefghijklmnopqrstuvwxyz"[i % 26]}${"abcdefghijklm"[Math.floor(i / 26)]}` }, false, today);
    expect(Object.keys(ear).length).toBe(300);
  });

  test("baralho: só as vencidas, mais atrasadas primeiro, com limite", () => {
    const w = (due: string, box = 1) => ({ word: "", line: "", title: "", videoId: "", t: 0, card: { box, due }, seen: today });
    const ear: EarWords = { hoje: w(today), velha: w("2026-11-10"), futura: w("2026-11-30"), meio: w("2026-11-20") };
    expect(earDue(ear, today)).toEqual(["velha", "meio", "hoje"]);
    expect(earDue(ear, today, 2)).toEqual(["velha", "meio"]);
  });

  test("chave e divisão da linha em volta da palavra", () => {
    expect(earKey("Don't!")).toBe("don't");
    expect(splitLine("Oh, I'm fallin' (falling) down", "falling")).toEqual(["Oh, I'm fallin' (", "falling", ") down"]);
    expect(splitLine("Your love never fails", "NEVER")).toEqual(["Your love ", "never", " fails"]);
    expect(splitLine("Your love never fails", "grace")).toBeNull();
  });
});

describe("sincronização das palavras das músicas", () => {
  const w = (box: number, due: string, title: string) => ({ word: "love", line: "", title, videoId: "", t: 0, card: { box, due }, seen: today });

  test("fica o card mais avançado de cada palavra", () => {
    const phone = { ...emptyData(), earWords: { love: w(2, "2026-11-28", "celular"), fire: w(0, today, "celular") } };
    const laptop = { ...emptyData(), earWords: { love: w(1, "2026-11-26", "pc"), heart: w(0, today, "pc") } };
    const m = mergeData(phone, laptop);
    expect(Object.keys(m.earWords).sort()).toEqual(["fire", "heart", "love"]);
    expect(m.earWords.love!.title).toBe("celular");
    expect(mergeData(laptop, phone).earWords.love!.title).toBe("celular");
  });

  test("progresso antigo do servidor (sem palavras) não quebra", () => {
    const local = { ...emptyData(), earWords: { love: w(0, today, "x") } };
    expect(mergeData(local, { start: "2026-11-01" }).earWords).toEqual(local.earWords);
  });
});
