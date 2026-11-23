import { describe, expect, test } from "bun:test";
import { cleanTitle, distance, distractors, lineAt, makeBlanks, parseLrc, tokenize } from "../src/lib/lyrics";

// Letra de exemplo escrita pro teste (não é de nenhuma música).
const LRC = `[00:10.50] Morning light is breaking through
[00:14.00] Every promise holding true
[00:18.25] I will sing about your grace
[00:22.00]
[00:23.10] Running back to find my place
[01:02.5] Morning light is breaking through`;

describe("letra sincronizada", () => {
  test("lê o LRC em segundos, ignorando linhas vazias", () => {
    const l = parseLrc(LRC);
    expect(l.length).toBe(5);
    expect(l[0]).toEqual({ t: 10.5, text: "Morning light is breaking through" });
    expect(l[4]!.t).toBeCloseTo(62.5);
  });
  test("separa palavras sem perder a pontuação", () => {
    expect(tokenize("Hey, you're mine!")).toEqual([
      { before: "", word: "Hey", after: "," },
      { before: "", word: "you're", after: "" },
      { before: "", word: "mine", after: "!" },
    ]);
  });
  test("linha tocando no segundo t", () => {
    const l = parseLrc(LRC);
    expect(lineAt(l, 5)).toBe(-1);
    expect(lineAt(l, 15)).toBe(1);
    expect(lineAt(l, 999)).toBe(4);
  });
});

describe("lacunas", () => {
  const lines = parseLrc(LRC);
  test("nível define quantas linhas ganham lacuna, e nunca palavra curta/comum", () => {
    expect(makeBlanks(lines, "dificil", "x").length).toBe(5);
    expect(makeBlanks(lines, "medio", "x").length).toBe(3);
    for (const b of makeBlanks(lines, "dificil", "x")) {
      expect(b.answer.length).toBeGreaterThanOrEqual(3);
      expect(["is", "i", "the", "my", "to"]).not.toContain(b.answer);
    }
  });
  test("4 opções diferentes, uma é a resposta", () => {
    for (const b of makeBlanks(lines, "dificil", "x")) {
      expect(b.options.length).toBe(4);
      expect(new Set(b.options).size).toBe(4);
      expect(b.options).toContain(b.answer);
    }
  });
  test("mesma música, mesmas lacunas (semente)", () => {
    expect(makeBlanks(lines, "medio", "abc")).toEqual(makeBlanks(lines, "medio", "abc"));
  });
  test("refrão repetido não usa sempre a mesma palavra", () => {
    const b = makeBlanks(lines, "dificil", "x");
    expect(b[0]!.answer).not.toBe(b[4]!.answer); // linhas 0 e 4 são iguais
  });
  test("opções erradas são parecidas com a resposta", () => {
    const opts = distractors("provider", ["light", "grace"], () => 0.5);
    expect(opts).toContain("provide");
    expect(distance("grace", "place")).toBe(2);
  });
});

test("limpa título do YouTube pra buscar a letra", () => {
  expect(cleanTitle("Jireh | Elevation Worship & Maverick City (Official Music Video)")).toBe("Jireh Elevation Worship & Maverick City");
  expect(cleanTitle("Way Maker (Lyrics) - Leeland")).toBe("Way Maker Leeland");
  expect(cleanTitle("Song Name ft. Someone")).toBe("Song Name");
});
