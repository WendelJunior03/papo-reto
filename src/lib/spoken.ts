/**
 * Texto falado e nome do arquivo de áudio correspondente.
 * Usado tanto pelo app quanto pelo scripts/audio.ts, então o nome bate dos dois lados.
 */

/** Tira os colchetes de destaque e emojis (a voz leria "smiling face..."). */
export function spokenText(en: string): string {
  return en
    .replace(/[[\]]/g, "")
    .replace(/\p{Extended_Pictographic}|️/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** FNV-1a 32 bits: curto, síncrono e igual no Bun e no navegador. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const audioFile = (en: string): string => `audio/${fnv1a(spokenText(en).toLowerCase())}.m4a`;

/**
 * Tradução gravada (voz pt-BR) pro modo "Ouvir no carro": mesmo hash, mas sobre o texto em português.
 * Fica em outra pasta pra não misturar com o inglês nem colidir com um texto igual nos dois idiomas.
 */
export const ptAudioFile = (pt: string): string => `audio-pt/${fnv1a(spokenText(pt).toLowerCase())}.m4a`;

/** Pausas gravadas (silêncio): com a tela bloqueada o iPhone congela os timers, então a pausa também é áudio. */
export const SILENCE = { short: "audio/silence-1s.m4a", long: "audio/silence-2s.m4a" } as const;
