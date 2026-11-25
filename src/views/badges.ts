/**
 * Convites e selos: o desenho de cada selo (SVG na identidade do app: céu, amarelo e noite),
 * o cartão "Convide amigos" (aba Situações), a fileira "Seus selos" (Evolução)
 * e a janela de comemoração quando chega um selo novo.
 */
import { esc } from "../lib/html";
import { BADGES, badgeById, nextBadge, type BadgeId } from "../lib/invites";
import type { AppState } from "../state";

const NOITE = "#0C2A4A";
const AM = "#FEF203";

/** Cada desenho ganha ids próprios: o mesmo selo aparece várias vezes na tela (topo, conta, lista). */
let seq = 0;

const sky = (id: string): string =>
  `<radialGradient id="${id}" cx="50%" cy="42%" r="62%"><stop offset="0" stop-color="#3AA3E4"/><stop offset=".6" stop-color="#2F8FDB"/><stop offset="1" stop-color="#2A84D2"/></radialGradient>`;
const gold = (id: string): string =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF9A8"/><stop offset=".45" stop-color="${AM}"/><stop offset="1" stop-color="#E9D900"/></linearGradient>`;

/** Pontas da estrela do selo "Lenda" (16 pontas). */
const BURST = Array.from({ length: 32 }, (_, i) => {
  const r = i % 2 ? 25 : 30.5;
  const a = (i / 32) * Math.PI * 2 - Math.PI / 2;
  return `${(32 + r * Math.cos(a)).toFixed(1)} ${(32 + r * Math.sin(a)).toFixed(1)}`;
}).join(" ");

function art(id: BadgeId): string {
  const k = `selo${++seq}`;
  switch (id) {
    // Carimbo redondo azul com coração: o primeiro amigo.
    case "amigo":
      return `<defs>${sky(`${k}s`)}</defs>
        <circle cx="32" cy="32" r="29" fill="url(#${k}s)" stroke="${NOITE}" stroke-width="3"/>
        <circle cx="32" cy="32" r="23" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="2.4 2.6" opacity=".85"/>
        <path d="M32 45 L20.5 33.5 A7.6 7.6 0 0 1 32 23.5 A7.6 7.6 0 0 1 43.5 33.5 Z" fill="${AM}" stroke="${NOITE}" stroke-width="2.4" stroke-linejoin="round"/>`;
    // Hexágono amarelo com miolo azul e três pessoas: a turma.
    case "turma":
      return `<defs>${sky(`${k}s`)}</defs>
        <path d="M32 3 L57.1 17.5 L57.1 46.5 L32 61 L6.9 46.5 L6.9 17.5 Z" fill="${AM}" stroke="${NOITE}" stroke-width="3" stroke-linejoin="round"/>
        <path d="M32 9.5 L51.5 20.8 L51.5 43.2 L32 54.5 L12.5 43.2 L12.5 20.8 Z" fill="url(#${k}s)" stroke="${NOITE}" stroke-width="1.6" stroke-linejoin="round"/>
        <g stroke="${NOITE}" stroke-width="1.5">
          <circle cx="21.5" cy="29" r="4" fill="#CFE5F8"/><path d="M14.5 43 a7 7 0 0 1 14 0 Z" fill="#CFE5F8"/>
          <circle cx="42.5" cy="29" r="4" fill="#CFE5F8"/><path d="M35.5 43 a7 7 0 0 1 14 0 Z" fill="#CFE5F8"/>
          <circle cx="32" cy="26" r="5" fill="#fff"/><path d="M23 44 a9 9 0 0 1 18 0 Z" fill="#fff"/>
        </g>`;
    // Medalha dourada com fitas e um globo: o embaixador.
    case "embaixador":
      return `<defs>${gold(`${k}g`)}${sky(`${k}s`)}</defs>
        <path d="M17 2 L29 2 L36 25 L24 25 Z" fill="url(#${k}s)" stroke="${NOITE}" stroke-width="2" stroke-linejoin="round"/>
        <path d="M47 2 L35 2 L28 25 L40 25 Z" fill="${AM}" stroke="${NOITE}" stroke-width="2" stroke-linejoin="round"/>
        <circle cx="32" cy="40" r="21" fill="url(#${k}g)" stroke="${NOITE}" stroke-width="3"/>
        <circle cx="32" cy="40" r="15" fill="${NOITE}"/>
        <g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round">
          <circle cx="32" cy="40" r="9.5"/><ellipse cx="32" cy="40" rx="4.2" ry="9.5"/>
          <path d="M23.5 40 H40.5 M25.5 35 H38.5 M25.5 45 H38.5" stroke="#8FC4EC" stroke-width="1.4"/>
        </g>`;
    // Estrela de 16 pontas, miolo azul e coroa: a lenda.
    case "lenda":
      return `<defs>${gold(`${k}g`)}${sky(`${k}s`)}</defs>
        <polygon points="${BURST}" fill="url(#${k}g)" stroke="${NOITE}" stroke-width="2.4" stroke-linejoin="round"/>
        <circle cx="32" cy="32" r="18.5" fill="url(#${k}s)" stroke="${NOITE}" stroke-width="2.4"/>
        <path d="M22 39 L20.5 25.5 L27 31 L32 22 L37 31 L43.5 25.5 L42 39 Z" fill="${AM}" stroke="${NOITE}" stroke-width="2" stroke-linejoin="round"/>
        <rect x="22" y="40.5" width="20" height="3.6" rx="1.4" fill="${AM}" stroke="${NOITE}" stroke-width="1.8"/>
        <circle cx="32" cy="33.5" r="1.8" fill="${NOITE}"/>`;
  }
}

/** O selo desenhado. `cls`: tamanho (selo-hdr, selo-lg, selo-xl…); `off` = ainda bloqueado (cinza). */
export function selo(id: BadgeId, cls = "", off = false): string {
  const name = badgeById(id)?.name ?? "";
  return `<span class="selo ${cls}${off ? " off" : ""}" role="img" aria-label="Selo ${esc(name)}${off ? " (bloqueado)" : ""}"><svg viewBox="0 0 64 64" aria-hidden="true">${art(id)}</svg></span>`;
}

const amigos = (n: number): string => `${n} ${n === 1 ? "amigo" : "amigos"}`;

/** Selo em uso, pequeno, ao lado dos números do topo. */
export function headerSelo(s: AppState): string {
  if (!s.badge) return "";
  return `<button class="hdr-selo" data-act="goto-situacoes" aria-label="Seu selo: ${esc(badgeById(s.badge)!.name)}">${selo(s.badge, "selo-hdr")}</button>`;
}

/** Mensagem que vai junto com o link no "Compartilhar". */
export const shareText = (link: string): string =>
  `Tô aprendendo inglês com frases de nativo no Papo Reto. Entra com meu convite: ${link}`;

/** Cartão "Convide amigos" (aba Situações): link, amigos que entraram, próximo selo e a escolha do selo. */
export function inviteCard(s: AppState, canShare: boolean): string {
  const head = `<span class="eyebrow">Convide amigos</span>
    <h3>Aprender junto <span class="mark">rende mais.</span></h3>`;
  const inv = s.invite;
  if (!inv) {
    return `<div class="invite-card">${head}
      ${s.inviteError
        ? `<p class="invite-muted">${esc(s.inviteError)}</p><button class="btn btn-ghost btn-sm" data-act="invite-reload">Tentar de novo</button>`
        : `<p class="invite-muted">Preparando seu convite…</p>`}
    </div>`;
  }
  const next = nextBadge(inv.friends);
  const progress = next
    ? `<div class="invite-next">
        <span>Faltam <b>${amigos(next.missing)}</b> pro selo <b>${esc(next.badge.name)}</b></span>
        <div class="invite-meter" role="img" aria-label="${inv.friends} de ${next.badge.friends} amigos"><i style="width:${(next.progress * 100).toFixed(0)}%"></i></div>
      </div>`
    : `<p class="invite-next"><b>Você ganhou todos os selos.</b> Lenda do Papo!</p>`;
  const items = BADGES.map((b) => {
    const on = inv.badges.includes(b.id);
    const using = s.badge === b.id;
    const act = !on
      ? `<small>Convide ${amigos(b.friends)}</small>`
      : using
        ? `<button class="selo-btn using" data-act="badge-off" aria-label="Tirar o selo ${esc(b.name)}">Em uso · tirar</button>`
        : `<button class="selo-btn" data-act="badge-use" data-badge="${b.id}">Usar este selo</button>`;
    return `<li class="selo-item${on ? "" : " off"}${using ? " using" : ""}">${selo(b.id, "selo-md", !on)}<b>${esc(b.name)}</b>${act}</li>`;
  }).join("");
  return `<div class="invite-card">${head}
    <p class="invite-muted">Mande seu link. Cada amigo que criar conta com ele conta pros seus selos.</p>
    <div class="invite-link">
      <input id="invite-link" readonly value="${esc(inv.link)}" aria-label="Seu link de convite">
      <button class="btn btn-am btn-sm" data-act="invite-copy">Copiar link</button>
    </div>
    ${canShare ? `<button class="btn btn-ultra" data-act="invite-share">Compartilhar</button>` : ""}
    <div class="invite-count"><b>${inv.friends}</b><span>${inv.friends === 1 ? "amigo entrou" : "amigos entraram"} com seu convite</span></div>
    ${progress}
    <ul class="selo-list">${items}</ul>
  </div>`;
}

/** Selo grande no cartão da conta (no lugar da inicial). */
export function accountSelo(s: AppState): string {
  return s.badge ? selo(s.badge, "selo-lg") : "";
}

/** Fileira "Seus selos" na Evolução: conquistados em cor, os outros em cinza. */
export function seloRow(s: AppState): string {
  const got = s.badges.length;
  return `<div class="evo-card">
    <div class="evo-head"><span class="eyebrow">Seus selos</span><span class="mono">${got} de ${BADGES.length}</span></div>
    <ul class="selo-row">${BADGES.map((b) => {
      const on = s.badges.includes(b.id);
      return `<li class="${on ? "" : "off"}">${selo(b.id, "selo-md", !on)}<b>${esc(b.name)}</b><small>${on ? (s.badge === b.id ? "Em uso" : "Conquistado") : `convide ${amigos(b.friends)}`}</small></li>`;
    }).join("")}</ul>
    <button class="link-btn" data-act="goto-situacoes">${got ? "Escolher selo e convidar mais" : "Convidar amigos"}</button>
  </div>`;
}

/** Janela de comemoração (uma vez por selo novo). */
export function seloSheet(s: AppState): string {
  const b = badgeById(s.celebrate);
  if (!b || s.support.open) return "";
  return `<div class="sheet-backdrop" data-act="selo-later"></div>
  <div class="sheet selo-sheet" role="dialog" aria-modal="true" aria-labelledby="selo-title">
    <button class="sheet-x" data-act="selo-later" aria-label="Fechar">×</button>
    ${selo(b.id, "selo-xl")}
    <span class="eyebrow">Selo novo</span>
    <h3 id="selo-title">Você ganhou o selo <span class="mark">${esc(b.name)}!</span></h3>
    <p class="sheet-intro">${b.friends === 1 ? "Um amigo entrou" : `${b.friends} amigos entraram`} com seu convite. Quer usar este selo? Ele aparece no topo do app e na sua conta.</p>
    <div class="sheet-foot">
      <button class="btn btn-ghost" data-act="selo-later">Agora não</button>
      <button class="btn btn-am" data-act="badge-use" data-badge="${b.id}">Usar este selo</button>
    </div>
  </div>`;
}
