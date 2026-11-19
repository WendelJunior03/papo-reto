import { packs, phraseId } from "../data";
import { esc, plain } from "../lib/html";
import { isKnown } from "../lib/srs";
import { packIcon } from "../icons";
import { knownInPack, type AppState } from "../state";
import { supportCard } from "./support";

export function renderSituations(s: AppState): string {
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
    <div class="grid">${tiles}</div>
    ${supportCard(s)}
    <div class="account">
      <span class="avatar">${esc(s.user.slice(0, 1).toUpperCase())}</span>
      <div><span class="mono">Sua conta</span><b>${esc(s.user)}</b><small>Progresso salvo na conta — entre em qualquer aparelho.</small></div>
      <button class="btn btn-ghost btn-sm" data-act="logout">Sair</button>
    </div>
  </div></section></div>`;
}
