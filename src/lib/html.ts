export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Escapa e transforma o trecho entre [colchetes] em <mark>. */
export const highlight = (s: string): string => esc(s).replace(/\[(.+?)\]/g, "<mark>$1</mark>");

export const plain = (s: string): string => s.replace(/[[\]]/g, "");

export const pad = (n: number): string => String(n).padStart(2, "0");
