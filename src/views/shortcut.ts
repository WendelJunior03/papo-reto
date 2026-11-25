import { esc } from "../lib/html";
import { ui } from "../icons";

/** Tom do círculo do ícone (mesmas cores dos selos .st). */
export type ShortcutTone = "tr" | "ok" | "at" | "u";

/**
 * Cartão de atalho largo: ícone num círculo, título e uma linha de apoio, seta à direita.
 * O cartão inteiro é um botão; `attrs` leva o data-act (e data-* extras) já montados.
 */
export function shortcut(o: { icon: string; tone: ShortcutTone; title: string; sub: string; attrs: string; cls?: string }): string {
  return `<button class="shortcut ${o.cls ?? ""}" ${o.attrs}>
      <span class="sc-ic ${o.tone}">${o.icon}</span>
      <span class="sc-body"><b>${esc(o.title)}</b><span>${esc(o.sub)}</span></span>
      <span class="sc-go">${ui.arrow}</span>
    </button>`;
}
