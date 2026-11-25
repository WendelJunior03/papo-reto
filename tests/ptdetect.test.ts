import { describe, expect, test } from "bun:test";
import { detectPortuguese } from "../src/lib/ptdetect";

const pt = (t: string, c?: number) => detectPortuguese(t, c).isPortuguese;

describe("detectPortuguese: inglês passa", () => {
  const english = [
    "Hi, how are you doing today?",
    "No, I don't think so.",
    "Do you want to come with me?",
    "Come on, it's a good idea.",
    "I need a new sim card for my phone.",
    "My friend Cara is coming over tonight.",
    "Um, I think we should go to the beach.",
    "AI is changing everything.",
    "That's totally legal, don't worry.",
    "Send me an e-mail when you get home.",
    "Let's grab a café latte and a croissant.",
    "I updated my résumé yesterday.",
    "We went to Bora Bora on our honeymoon.",
    "It was a mano a mano fight.",
    "Check out google.com for more info.",
    "He's a real pro at this game.",
    "Nada, nothing much, just chilling.",
    "Que sera sera, whatever will be will be.",
    "I played The Sims all night.",
    "José and Maria are my neighbors.",
    "I love Pokémon and Beyoncé.",
    "So, what do you do for a living?",
    "I'm from Brazil, I live in São Paulo.",
    "My name is João, nice to meet you.",
    "My favorite food is pizza with a lot of cheese.",
    "Yes, sure, sounds good to me!",
    "Can you say that again, please?",
    "",
  ];
  for (const t of english) {
    test(JSON.stringify(t), () => expect(pt(t)).toBe(false));
  }
});

describe("detectPortuguese: português é pego", () => {
  const portuguese = [
    "tipo assim, eu não sei",
    "obrigado",
    "então, cara, vamos lá",
    "beleza mano",
    "você é muito legal",
    "nao sei falar isso",
    "porque eu quero",
    "nossa gente",
    "valeu, tchau",
    "tá bom",
    "eita",
    "por favor",
    "bom dia pessoal",
    "tudo bem com você",
    "falou",
    "I don't know, né?",
    "it was like, tipo, amazing",
    "meu coração",
    "não",
    "eu sei",
    "sim, cara",
  ];
  for (const t of portuguese) {
    test(JSON.stringify(t), () => expect(pt(t)).toBe(true));
  }
});

describe("detectPortuguese: regras", () => {
  test("uma palavra fraca sozinha não basta", () => {
    expect(pt("sim")).toBe(false);
    expect(pt("cara")).toBe(false);
    expect(pt("Nada")).toBe(false);
  });
  test("acento sozinho (nome próprio) não basta, mas soma", () => {
    expect(pt("João")).toBe(false);
    expect(pt("coração partido de João")).toBe(true);
  });
  test("duas palavras fracas somam um ponto", () => {
    expect(pt("sim cara")).toBe(true);
  });
  test("confiança baixa: meio ponto já basta", () => {
    expect(pt("oi", 0.9)).toBe(false);
    expect(pt("oi", 0.2)).toBe(true);
    // confiança 0 = desconhecida (o Safari às vezes manda 0)
    expect(pt("oi", 0)).toBe(false);
  });
  test("confiança baixa sem nenhuma palavra suspeita não condena", () => {
    expect(pt("I like turtles", 0.1)).toBe(false);
  });
  test("mostra o que pesou", () => {
    const r = detectPortuguese("Obrigado, tipo, valeu");
    expect(r.matches).toEqual(["obrigado", "tipo", "valeu"]);
    expect(r.score).toBe(3);
  });
  test("maiúsculas e acentos não atrapalham", () => {
    expect(pt("VOCÊ")).toBe(true);
    expect(pt("Então")).toBe(true);
  });
});
