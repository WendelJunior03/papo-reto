import { findPhrase } from "../data";
import { esc, highlight, pad } from "../lib/html";
import { ui } from "../icons";
import { currentPack, ensurePractice, type AppState } from "../state";

const WAVE = [30, 55, 80, 45, 70, 90, 50, 35, 60, 40];

export function renderPractice(s: AppState): string {
  const pr = ensurePractice(s);
  const total = pr.deck.length;
  const extra = total - 5;

  const head = `<div class="sec-head"><span class="eyebrow">Treino · ${esc(currentPack(s).title)}${extra > 0 ? ` + ${extra} revisões` : ""}</span>
      <h2>Do português <span class="mark">pra boca.</span></h2>
      <p>Nada de escrever. Você fala ou escuta, vira o card e confere.</p></div>
    <div class="tabs-mode" role="group" aria-label="Modo de treino">
      <button class="tab" data-act="mode" data-mode="falar" aria-pressed="${pr.mode === "falar"}">${ui.mic}Falar</button>
      <button class="tab" data-act="mode" data-mode="ouvir" aria-pressed="${pr.mode === "ouvir"}">${ui.ear}Ouvir</button>
    </div>`;

  let body: string;
  const id = pr.deck[pr.pos];
  const p = id ? findPhrase(id) : undefined;

  if (!p) {
    body = `<div class="done">
      <div class="ok-ic">${ui.tick}</div>
      <span class="eyebrow">Treino concluído</span>
      <div class="score">${pr.score}<span>/${total}</span></div>
      <p>${pr.score === total ? "Perfeito. As frases voltam sozinhas nos próximos dias, cada vez mais espaçadas." : "As que ficaram pra trás voltam no próximo treino."}</p>
      <div class="btnrow"><button class="btn btn-am btn-lg" data-act="restart">${ui.flip}Treinar de novo</button></div>
    </div>`;
  } else {
    const front =
      pr.mode === "falar"
        ? `<span class="eyebrow">Como você diria em inglês?</span><div class="big">${esc(p.pt)}</div>
           <div class="foot">Fale em voz alta antes de virar. Não precisa ser palavra por palavra.</div>`
        : `<span class="eyebrow">Escute sem ler</span>
           <div class="wave">${WAVE.map((h, i) => `<i style="height:${h}%;animation-delay:${(i * 0.09).toFixed(2)}s"></i>`).join("")}</div>
           <div class="acts center"><button class="btn btn-ultra" data-act="say-card">${ui.play}Tocar</button>
           <button class="btn btn-ghost" data-act="slow-card">${ui.slow}Devagar</button></div>`;

    body = `<div class="pbar"><div class="steps-bar">${pr.deck
      .map((_, i) => `<i class="${i < pr.pos ? "on" : i === pr.pos ? "now" : ""}"></i>`)
      .join("")}</div>${pad(pr.pos + 1)}/${pad(total)}</div>
    <div class="flip ${pr.revealed ? "on" : ""}" id="flip"><div class="flip-in">
      <div class="face front" aria-hidden="${pr.revealed}">${front}</div>
      <div class="face back" aria-hidden="${!pr.revealed}"><span class="eyebrow">Do jeito nativo</span>
        <div class="big" lang="en">${highlight(p.en)}</div><div class="foot">${esc(p.pt)}</div></div>
    </div></div>
    <div class="btnrow">${
      pr.revealed
        ? `<button class="btn btn-ghost btn-lg" data-act="miss">${ui.x}Ainda não</button><button class="btn btn-am btn-lg" data-act="hit">${ui.tick}Saquei</button>`
        : `<button class="btn btn-ultra btn-lg" data-act="reveal">${ui.flip}Virar card</button>`
    }</div>`;
  }

  return `<div class="page"><section class="band"><div class="wrap">${head}${body}</div></section></div>`;
}
