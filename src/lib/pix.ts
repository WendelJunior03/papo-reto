/**
 * PIX "copia e cola" estático (BR Code, padrão EMV do Banco Central).
 * O mesmo texto vira o QR Code; o app do banco lê chave, nome, cidade e valor dele.
 */
export interface PixConfig {
  key: string;
  name: string;
  city: string;
}

const field = (id: string, value: string): string => `${id}${String(value.length).padStart(2, "0")}${value}`;

/** O padrão pede ASCII sem acento, em maiúsculas, com limite de tamanho. */
const clean = (s: string, max: number): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .-]/g, "")
    .trim()
    .toUpperCase()
    .slice(0, max);

/** CRC16/CCITT-FALSE (polinômio 0x1021, início 0xFFFF), em 4 dígitos hexadecimais. */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Monta o código. Sem valor, a pessoa digita quanto quer no app do banco. */
export function pixPayload(cfg: PixConfig, amount?: number, message = "Apoio Papo Reto"): string {
  const account = field("00", "br.gov.bcb.pix") + field("01", cfg.key.trim()) + (message ? field("02", clean(message, 40)) : "");
  const body =
    field("00", "01") +
    field("26", account) +
    field("52", "0000") +
    field("53", "986") +
    (amount && amount > 0 ? field("54", amount.toFixed(2)) : "") +
    field("58", "BR") +
    field("59", clean(cfg.name, 25) || "PAPO RETO") +
    field("60", clean(cfg.city, 15) || "BRASIL") +
    field("62", field("05", "***")) +
    "6304";
  return body + crc16(body);
}
