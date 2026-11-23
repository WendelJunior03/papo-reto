import { expect, test } from "bun:test";
import { looksPortuguese } from "../src/lib/listen";

test("percebe transcrição em português", () => {
  expect(looksPortuguese("me vê um café grande pra viagem")).toBe(true);
  expect(looksPortuguese("não sei")).toBe(true);
  expect(looksPortuguese("eu quero um café com leite")).toBe(true);
});
test("inglês, mesmo com palavras parecidas, não é marcado", () => {
  expect(looksPortuguese("Can I get a large coffee to go")).toBe(false);
  expect(looksPortuguese("I'm running late")).toBe(false);
  expect(looksPortuguese("To be honest I forgot")).toBe(false);
  expect(looksPortuguese("a com")).toBe(false);
});
