import { describe, expect, test } from "bun:test";
import { crc16, pixPayload } from "../src/lib/pix";

/** Lê os campos ID+tamanho+valor do BR Code, pra conferir a estrutura. */
function parse(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < payload.length; ) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    out[id] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

const cfg = { key: "123e4567-e89b-12d3-a456-426614174000", name: "Wendel Júnior da Silva Santos", city: "São José dos Campos" };

describe("PIX copia e cola", () => {
  test("CRC16/CCITT-FALSE confere com o vetor de teste padrão", () => {
    expect(crc16("123456789")).toBe("29B1");
  });
  test("estrutura do BR Code com chave, nome e cidade normalizados", () => {
    const f = parse(pixPayload(cfg));
    expect(f["00"]).toBe("01");
    expect(parse(f["26"]!)["00"]).toBe("br.gov.bcb.pix");
    expect(parse(f["26"]!)["01"]).toBe(cfg.key);
    expect(f["53"]).toBe("986");
    expect(f["58"]).toBe("BR");
    expect(f["59"]).toBe("WENDEL JUNIOR DA SILVA SA"); // 25 caracteres, sem acento
    expect(f["60"]).toBe("SAO JOSE DOS CA"); // 15 caracteres
    expect(f["54"]).toBeUndefined(); // valor livre
  });
  test("valor sugerido entra com duas casas", () => {
    expect(parse(pixPayload(cfg, 10))["54"]).toBe("10.00");
  });
  test("termina com o CRC certo do próprio conteúdo", () => {
    const p = pixPayload(cfg, 5);
    expect(p.slice(-8, -4)).toBe("6304");
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });
});
