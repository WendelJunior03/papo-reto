/**
 * Formato do quadro binário das Salas ao vivo (usado no aparelho e no servidor):
 *   [4 bytes: tamanho do cabeçalho, big-endian][cabeçalho JSON em UTF-8][áudio]
 * Um quadro só por fala: o áudio e a transcrição chegam juntos, sem depender da ordem.
 */
export const MAX_HEADER_BYTES = 2_000;

export function encodeFrame(header: unknown, audio: Uint8Array): Uint8Array<ArrayBuffer> {
  const head = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(new ArrayBuffer(4 + head.length + audio.length));
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  out.set(audio, 4 + head.length);
  return out;
}

/** Devolve null se o quadro estiver malformado (o servidor descarta sem responder). */
export function decodeFrame(buf: ArrayBuffer | Uint8Array): { header: unknown; audio: Uint8Array } | null {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 4) return null;
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (len === 0 || len > MAX_HEADER_BYTES || 4 + len > bytes.length) return null;
  try {
    const header: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + len)));
    return { header, audio: bytes.subarray(4 + len) };
  } catch {
    return null;
  }
}
