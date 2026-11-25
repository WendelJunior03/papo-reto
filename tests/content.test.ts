import { describe, expect, test } from "bun:test";
import { allPhrases, packs } from "../src/data";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { audioFile, ptAudioFile, SILENCE } from "../src/lib/spoken";

const chunk = (s: string): string[] => [...s.matchAll(/\[(.+?)\]/g)].map((m) => m[1]!.toLowerCase());

describe("conteúdo", () => {
  test("ids de pacote são únicos e em kebab-case", () => {
    const ids = packs.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test("cada frase tem exatamente um trecho grifado", () => {
    for (const p of allPhrases) {
      expect({ id: p.id, chunks: chunk(p.en).length }).toEqual({ id: p.id, chunks: 1 });
    }
  });

  test("frases não se repetem entre pacotes", () => {
    const seen = new Map<string, string>();
    for (const p of allPhrases) {
      const key = p.en.toLowerCase().replace(/[^a-z ]/g, "").trim();
      expect({ phrase: p.en, dup: seen.get(key) }).toEqual({ phrase: p.en, dup: undefined });
      seen.set(key, p.id);
    }
  });

  test("cada cena tem fala do aluno e usa as frases do pacote", () => {
    for (const pack of packs) {
      expect(pack.chat.some((c) => c.me)).toBe(true);
      const used = pack.chat.flatMap((c) => chunk(c.en));
      expect({ pack: pack.id, ok: used.length >= 2 }).toEqual({ pack: pack.id, ok: true });
    }
  });

  test("cada frase tem 2 exemplos diferentes, com um trecho grifado cada", () => {
    for (const p of allPhrases) {
      const ex = p.examples ?? [];
      expect({ id: p.id, n: ex.length }).toEqual({ id: p.id, n: 2 });
      for (const e of ex) expect({ id: p.id, ex: e.en, chunks: chunk(e.en).length }).toEqual({ id: p.id, ex: e.en, chunks: 1 });
      expect(new Set([p.en, ...ex.map((e) => e.en)]).size).toBe(3);
    }
  });

  test("cada frase tem a versão virada (pergunta ou resposta), com no máximo um trecho grifado", () => {
    for (const p of allPhrases) {
      const f = p.flip;
      expect({ id: p.id, has: !!f }).toEqual({ id: p.id, has: true });
      if (!f) continue;
      expect(["question", "answer"]).toContain(f.kind);
      expect({ id: p.id, chunks: chunk(f.en).length <= 1, en: f.en.length > 0, pt: f.pt.length > 0 }).toEqual({ id: p.id, chunks: true, en: true, pt: true });
      expect({ id: p.id, how: f.how.length > 0 && f.how.length <= 110 }).toEqual({ id: p.id, how: true });
      if (f.kind === "question") expect({ id: p.id, q: f.en.trim().endsWith("?") }).toEqual({ id: p.id, q: true });
    }
  });

  test("tem conteúdo pra pelo menos um mês", () => {
    expect(packs.length).toBeGreaterThanOrEqual(30);
  });
});

test("toda frase e fala de cena tem áudio gravado (rode `bun run audio`)", () => {
  const texts = [
    ...allPhrases.flatMap((p) => [p.en, ...(p.examples ?? []).map((e) => e.en), ...(p.flip ? [p.flip.en] : [])]),
    ...packs.flatMap((p) => p.chat.map((c) => c.en)),
  ];
  const missing = texts.filter((t) => !existsSync(join(import.meta.dir, "../public", audioFile(t))));
  expect(missing).toEqual([]);
});

test("toda tradução de frase e de fala de cena tem áudio em português (rode `bun run audio`)", () => {
  const texts = [...allPhrases.map((p) => p.pt), ...packs.flatMap((p) => p.chat.map((c) => c.pt))];
  const missing = texts.filter((t) => !existsSync(join(import.meta.dir, "../public", ptAudioFile(t))));
  expect(missing).toEqual([]);
});

test("as pausas do modo Ouvir no carro existem (rode `bun run audio`)", () => {
  for (const f of Object.values(SILENCE)) expect({ f, ok: existsSync(join(import.meta.dir, "../public", f)) }).toEqual({ f, ok: true });
});
