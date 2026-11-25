import { packs } from "../data";
import { esc, highlight, plain } from "../lib/html";
import type { CarStatus } from "../lib/carplayer";
import { ui } from "../icons";
import type { AppState } from "../state";

const isIOS = (): boolean => /iPad|iPhone|iPod/.test(navigator.userAgent);

/** Grupo de opções no estilo do seletor de modo do treino. */
function options(label: string, act: string, current: string, list: [value: string, text: string][]): string {
  return `<div class="listen-opt"><span class="mono">${label}</span>
    <div class="tabs-mode" role="group" aria-label="${label}">${list
      .map(([v, t]) => `<button class="tab" data-act="${act}" data-value="${v}" aria-pressed="${v === current}">${t}</button>`)
      .join("")}</div></div>`;
}

/** Tela cheia do modo "Ouvir no carro": a frase grande, os controles e as opções. */
export function renderListen(s: AppState, car: CarStatus, wakeLock: boolean): string {
  const l = s.listen;
  const pl = car.playlist;
  const items = pl?.items ?? [];
  const it = items[car.item];
  const other = l.packIndex !== s.todayIndex;

  const sources: [string, string][] = [["hoje", "Pacote de hoje"]];
  if (other) sources.push(["pacote", esc(packs[l.packIndex]!.title)]);
  sources.push(["revisao", "Revisão"]);

  const now = it
    ? `<span class="mono listen-who">${it.chat ? `Cena · ${esc(it.who ?? "")}` : "Frase"}${it.chat ? "" : ` · ${esc(it.album)}`}</span>
       <p class="listen-en" lang="en">${highlight(it.en)}</p>
       <p class="listen-pt">${esc(it.pt)}</p>`
    : `<p class="listen-en">Nada pra revisar ainda.</p>
       <p class="listen-pt">Marque "Sei essa" nas frases (ou acerte no treino) e elas entram aqui. Enquanto isso, ouça o pacote de hoje.</p>`;

  const done = car.ended && items.length;
  const progress = items.length
    ? `<div class="pbar on-dark-bar"><span>${done ? "Fim" : `${car.item + 1} de ${items.length}`}</span>
        <div class="steps-bar" aria-hidden="true">${items.map((_, i) => `<i class="${done || i <= car.item ? "on" : ""}"></i>`).join("")}</div></div>`
    : "";

  const controls = items.length
    ? `<div class="listen-ctrl">
        <button class="btn btn-ghost btn-ic" data-act="listen-prev" aria-label="Frase anterior">${ui.prevTrack}</button>
        <button class="btn btn-am listen-play" data-act="listen-toggle" aria-label="${car.playing ? "Pausar" : "Tocar"}">${car.playing ? ui.pause : ui.resume}</button>
        <button class="btn btn-ghost btn-ic" data-act="listen-next" aria-label="Próxima frase">${ui.nextTrack}</button>
      </div>`
    : "";

  const list = items.length
    ? `<ol class="listen-list">${items
        .map(
          (x, i) => `<li><button data-act="listen-jump" data-item="${i}" aria-current="${i === car.item && !car.ended}">
            <span class="mono">${x.chat ? esc(x.who ?? "") : "Frase"}</span><span lang="en">${esc(plain(x.en))}</span></button></li>`,
        )
        .join("")}</ol>`
    : "";

  return `<div class="page listen">
    <div class="wrap evo-top"><button class="link-btn subtle" data-act="listen-close">${ui.back}Voltar</button></div>
    <section class="on-dark listen-hero"><div class="wrap">
      <div class="hero-meta mono"><span>${car.playing ? `<i class="live"></i>` : ""}Ouvir no carro</span><span>${esc(pl?.title ?? "")}</span></div>
      ${now}
      ${controls}
      ${progress}
    </div></section>

    <section class="band"><div class="wrap listen-body">
      ${options("Fonte", "listen-source", l.source, sources)}
      ${options("Idioma", "listen-lang", l.lang, [["enpt", "Inglês + português"], ["en", "Só inglês"]])}
      ${options("Velocidade", "listen-speed", l.slow ? "slow" : "normal", [["normal", "Normal"], ["slow", "Mais devagar"]])}
      ${wakeLock ? options("Tela", "listen-awake", l.awake ? "on" : "off", [["off", "Pode apagar"], ["on", "Manter acesa"]]) : ""}

      <div class="listen-note">
        <span class="eyebrow">${ui.lock} Funciona com a tela bloqueada</span>
        <p>Cada frase toca em inglês, depois a tradução e o inglês de novo — repita junto em voz alta. No fim, a cena do pacote.
          Os botões do fone, do volante e da tela de bloqueio pausam e pulam de frase.</p>
        ${isIOS() ? `<p><b>No iPhone:</b> use o app instalado na Tela de Início, dê o play aqui e só depois bloqueie a tela. Pode trocar de app, mas não feche o Papo Reto (não arraste ele pra cima na lista de apps).</p>` : ""}
        <p>Os áudios ficam guardados depois da primeira vez: dá pra ouvir sem internet.</p>
      </div>
      ${list}
    </div></section>
  </div>`;
}
