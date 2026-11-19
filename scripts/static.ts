/**
 * Resolve o caminho de um arquivo estático dentro de `base`, sem deixar escapar da pasta.
 * Barras codificadas (%2f) e ".." viram outro caminho depois de decodificar — por isso
 * o resultado é conferido no fim, e não a URL.
 */
import { resolve, sep } from "node:path";

export function safePath(base: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const root = resolve(base);
  const full = resolve(root, `.${decoded.startsWith("/") ? "" : "/"}${decoded}`);
  return full === root || full.startsWith(root + sep) ? full : null;
}
