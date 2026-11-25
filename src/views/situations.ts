import { packs, phraseId } from "../data";
import { esc, plain } from "../lib/html";
import { isKnown } from "../lib/srs";
import { packIcon, ui } from "../icons";
import { knownInPack, type AppState } from "../state";
import { shortcut } from "./shortcut";
import { supportCard } from "./support";
import { accountSelo, inviteCard } from "./badges";
import { badgeById } from "../lib/invites";

export function renderSituations(s: AppState, canShare = false): string {
  const total = packs.reduce((n, p) => n + p.phrases.length, 0);
  const tiles = packs
    .map((pack, i) => {
      const k = knownInPack(s, i);
      const bars = pack.phrases
        .map((_, j) => `<i class="${isKnown(s.data.progress[phraseId(pack, j)]) ? "" : "off"}"></i>`)
        .join("");
      return `<button class="sit ${i === s.todayIndex ? "today" : ""} ${i === s.packIndex ? "cur" : ""}" data-act="pick" data-pack="${i}">
        <span class="ic">${packIcon(pack.icon)}</span>
        <span class="t">${esc(pack.title)}</span>
        <span class="ex" lang="en">“${esc(plain(pack.phrases[0].en))}”</span>
        <span class="foot"><span class="pal">${bars}</span><span class="mono">${i === s.todayIndex ? "Hoje" : `${k}/5`}</span></span>
      </button>`;
    })
    .join("");

  return `<div class="page"><section class="band"><div class="wrap">
    <div class="sec-head"><span class="eyebrow">${packs.length} situações · ${total} frases</span>
      <h2>Escolha o momento <span class="mark">do seu dia.</span></h2>
      <p>Cada situação tem cinco frases e uma cena real. O app abre um pacote novo por dia, mas você pode pular pra qualquer um.</p></div>
    ${shortcut({ icon: ui.chart, tone: "ok", title: "Sua evolução", sub: "Nível, constância, memória e conquistas.", attrs: `data-act="goto-evolucao"`, cls: "evo-link" })}
    ${shortcut({ icon: ui.car, tone: "tr", title: "Ouvir no carro", sub: "Revisão em áudio do que você já sabe.", attrs: `data-act="listen-open" data-source="revisao"` })}
    <div class="grid">${tiles}</div>
    ${supportCard(s)}
    ${inviteCard(s, canShare)}
    <div class="account${s.badge ? " with-selo" : ""}">
      ${accountSelo(s) || `<span class="avatar">${esc(s.user.slice(0, 1).toUpperCase())}</span>`}
      <div><span class="mono">Sua conta</span><b>${esc(s.user)}</b>${s.badge ? `<span class="account-selo">Selo ${esc(badgeById(s.badge)!.name)}</span>` : ""}<small>Progresso salvo na conta — entre em qualquer aparelho.</small></div>
      <button class="btn btn-ghost btn-sm" data-act="logout">Sair</button>
      ${s.admin ? `<button class="btn btn-ghost btn-sm account-admin" data-act="goto-admin">${ui.chart}Painel do dono</button>` : ""}
    </div>
  </div></section></div>`;
}
