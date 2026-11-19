import { describe, expect, test } from "bun:test";
import { bestOf, compare, words } from "../src/lib/match";

describe("comparar fala", () => {
  test("normaliza contrações, pontuação e maiúsculas", () => {
    expect(words("I'm [beat]!")).toEqual(["i", "am", "beat"]);
    expect(words("I am beat")).toEqual(["i", "am", "beat"]);
    expect(words("Wanna hang out?")).toEqual(["want", "to", "hang", "out"]);
  });
  test("fala igual passa com nota máxima", () => {
    const r = compare("[Can I get] a large coffee to go?", "can I get a large coffee to go");
    expect(r.score).toBe(1);
    expect(r.pass).toBe(true);
  });
  test("contração dita por extenso conta como certa", () => {
    expect(compare("I'm [running late].", "I am running late").score).toBe(1);
  });
  test("marca as palavras que faltaram", () => {
    const r = compare("Can I get a large coffee to go?", "can I get coffee");
    expect(r.pass).toBe(false);
    expect(r.tokens.filter((t) => !t.hit).map((t) => t.word)).toEqual(["a", "large", "to", "go?"]);
  });
  test("palavra a mais no meio não derruba", () => {
    expect(compare("Count me in.", "yeah count me in").pass).toBe(true);
  });
  test("escolhe a melhor transcrição alternativa", () => {
    const { said } = bestOf("I'm beat.", ["I'm beet", "I'm beat"]);
    expect(said).toBe("I'm beat");
  });
  test("nada dito dá zero", () => {
    expect(compare("Talk soon!", "").score).toBe(0);
  });
});
