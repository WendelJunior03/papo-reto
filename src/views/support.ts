import qrcode from "qrcode-generator";
import { esc } from "../lib/html";
import { pixPayload, type PixConfig } from "../lib/pix";
import type { AppState } from "../state";
import { ui } from "../icons";

export const AMOUNTS = [0, 5, 10, 20] as const;

/** QR Code em SVG: escuro sobre branco (o contraste que as câmeras dos bancos esperam). */
function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const m = 3; // margem em módulos
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + m} ${r + m}h1v1h-1z`;
  const size = n + m * 2;
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="QR Code do PIX" shape-rendering="crispEdges">
    <rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#0E1E33"/></svg>`;
}

/** Cartão fixo e discreto (aba Situações). */
export function supportCard(s: AppState): string {
  if (!s.pix) return "";
  if (s.data.supported) {
    return `<div class="support-card thanks">
      <span class="eyebrow">Apoiador</span>
      <h3>Obrigado por apoiar o Papo Reto!</h3>
      <p>Seu apoio ajuda a manter o app no ar e gratuito pra todo mundo.</p>
      <button class="btn btn-ghost" data-act="support-open">Apoiar de novo</button>
    </div>`;
  }
  return `<div class="support-card">
    <span class="eyebrow">Apoie o projeto</span>
    <h3>Gostou do Papo Reto?</h3>
    <p>O app é gratuito e feito com carinho. Se ele está te ajudando, qualquer valor no PIX ajuda a manter no ar e a criar frases novas.</p>
    <button class="btn btn-am" data-act="support-open">Apoiar com PIX</button>
  </div>`;
}

/** Lembrete em momento de conquista (no máximo um por mês). */
export function supportNudge(s: AppState): string {
  if (!s.pix || !s.support.nudge) return "";
  return `<div class="support-nudge" role="dialog" aria-label="Apoie o Papo Reto">
    <p><b>${esc(s.support.nudge)}</b> Se o Papo Reto está te ajudando, considere apoiar o projeto.</p>
    <div class="acts">
      <button class="btn btn-am" data-act="support-open">Apoiar</button>
      <button class="btn btn-ghost" data-act="support-later">Agora não</button>
    </div>
  </div>`;
}

/** Janela com valores, QR Code e copia e cola. */
export function supportSheet(s: AppState): string {
  if (!s.pix || !s.support.open) return "";
  const pix: PixConfig = s.pix;
  const code = pixPayload(pix, s.support.amount || undefined);
  return `<div class="sheet-backdrop" data-act="support-close"></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <button class="sheet-x" data-act="support-close" aria-label="Fechar">×</button>
    <span class="eyebrow">Apoiar com PIX</span>
    ${
      s.support.daily
        ? `<h3 id="sheet-title">Ajude o Papo Reto a <span class="mark">continuar.</span></h3>
           <p class="sheet-intro">O app é gratuito e feito por uma pessoa só. Se ele está te ajudando a falar inglês, qualquer valor no PIX ajuda a manter no ar e a criar frases novas.</p>`
        : `<h3 id="sheet-title">Obrigado por <span class="mark">apoiar!</span></h3>`
    }
    <div class="amounts" role="group" aria-label="Valor">
      ${AMOUNTS.map(
        (v) => `<button class="tab" data-act="support-amount" data-amount="${v}" aria-pressed="${s.support.amount === v}">${v ? `R$ ${v}` : "Outro valor"}</button>`,
      ).join("")}
    </div>
    <div class="qr">${qrSvg(code)}</div>
    <p class="qr-hint">${s.support.amount ? `Valor: <b>R$ ${s.support.amount},00</b>. ` : "Você escolhe o valor no app do banco. "}No celular, copie o código e cole no app do banco em <b>PIX → Copia e cola</b>. No computador, aponte a câmera do celular pro QR Code.</p>
    <button class="btn btn-am btn-lg" data-act="support-copy">Copiar código PIX</button>
    <input class="pix-code" id="pix-code" readonly value="${esc(code)}" aria-label="Código PIX copia e cola">
    <div class="pix-key">
      <div><span class="mono">Chave PIX</span><code>${esc(pix.key)}</code><small>${esc(pix.name)}${pix.city ? ` · ${esc(pix.city)}` : ""}</small></div>
      <button class="btn btn-ghost btn-sm" data-act="support-copy-key">Copiar chave</button>
    </div>
    ${
      s.data.supported
        ? ""
        : `<div class="sheet-foot">
            <button class="btn btn-ghost" data-act="support-close">Agora não</button>
            <button class="btn btn-ghost" data-act="support-done">${ui.tick}Já apoiei</button>
          </div>
          <p class="sheet-small">“Já apoiei” para de mostrar esta janela todo dia.</p>`
    }
  </div>`;
}
