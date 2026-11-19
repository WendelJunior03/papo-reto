import { expect, test } from "bun:test";
import { safePath } from "../scripts/static";

test("arquivo dentro da pasta é liberado", () => {
  expect(safePath("/app/public", "/icons/icon.svg")).toBe("/app/public/icons/icon.svg");
});
test("não deixa sair da pasta, nem com barra ou ponto codificados", () => {
  for (const p of ["/../.env", "/..%2f.env", "/%2e%2e%2f.env", "/..%2f..%2fetc%2fpasswd", "/a/../../.env", "/%00.env", "/%E0%A4%A"]) {
    expect({ p, r: safePath("/app/public", p) }).toEqual({ p, r: null });
  }
});
