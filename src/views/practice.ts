import { findPhrase } from "../data";
import { esc, highlight, pad } from "../lib/html";
import { splitLine } from "../lib/ear";
import { ui } from "../icons";
import { currentPack, ensurePractice, type AppState, type Practice } from "../state";

const WAVE = [30, 55, 80, 45, 70, 90, 50, 35, 60, 40];

const bar = (pr: Practice): string =>
  `<div class="pbar"><div class="steps-bar">${pr.deck
    .map((_, i) => `<i class="${i < pr.pos ? "on" : i === pr.pos ? "now" : ""}"></i>`)
    .join("")}</div>${pad(pr.pos + 1)}/${pad(pr.deck.length)}</div>`;

const buttons = (pr: Practice): string => `<div class="btnrow">${
  pr.revealed
    ? `<button class="btn btn-ghost btn-lg" data-act="miss">${ui.x}Ainda não</button><button class="btn btn-am btn-lg" data-act="hit">${ui.tick}Saquei</button>`
    : `<button class="btn btn-ultra btn-lg" data-act="reveal">${ui.flip}Virar card</button>`
}</div>`;

/** Modo "Músicas": as palavras que a pessoa errou nas músicas, com o trecho da letra. */
function musicBody(s: AppState, pr: Practice): string {
  const total = pr.deck.length;
  const ear = s.data.earWords[pr.deck[pr.pos] ?? ""];
  if (!total) {
    return `<div class="done">
      <div class="ok-ic">${ui.ear}</div>
      <span class="eyebrow">Tudo em dia</span>
      <p>Nenhuma palavra das músicas pra revisar agora. As que você errar na aba Música aparecem aqui.</p>
      <div class="btnrow"><button class="btn btn-am btn-lg" data-act="goto-musica">Ir pra Música ${ui.arrow}</button></div>
    </div>`;
  }
  if (!ear) {
    return `<div class="done">
      <div class="ok-ic">${ui.tick}</div>
      <span class="eyebrow">Treino concluído</span>
      <div class="score">${pr.score}<span>/${total}</span></div>
      <p>${pr.score === total ? "Ouvido afiado. As palavras voltam sozinhas nos próximos dias." : "As que ficaram pra trás voltam no próximo treino."}</p>
      <div class="btnrow"><button class="btn btn-am btn-lg" data-act="restart">${ui.flip}Treinar de novo</button></div>
    </div>`;
  }
  const parts = splitLine(ear.line, ear.word);
  const gap = `<span class="gap">${"_".repeat(Math.max(4, ear.word.length))}</span>`;
  const line = (mid: string) => (parts ? `${esc(parts[0])}${mid}${esc(parts[2])}` : `${esc(ear.line)} · ${mid}`);
  return `${bar(pr)}
    <div class="flip ${pr.revealed ? "on" : ""}" id="flip"><div class="flip-in">
      <div class="face front" aria-hidden="${pr.revealed}"><span class="eyebrow">${esc(ear.title)}</span>
        <div class="big lyric" lang="en">${line(gap)}</div>
        <div class="acts center"><button class="btn btn-ultra" data-act="say-card">${ui.play}Tocar</button>
        <button class="btn btn-ghost" data-act="slow-card">${ui.slow}Devagar</button></div>
        <div class="foot">Que palavra completa o trecho? Escute e pense antes de virar.</div></div>
      <div class="face back" aria-hidden="${!pr.revealed}"><span class="eyebrow">Era “${esc(ear.word)}”</span>
        <div class="big lyric" lang="en">${line(`<mark>${esc(parts?.[1] ?? ear.word)}</mark>`)}</div><div class="foot">${esc(ear.title)}</div></div>
    </div></div>
    ${buttons(pr)}`;
}

export function renderPractice(s: AppState): string {
  const pr = ensurePractice(s);
  const total = pr.deck.length;
  const extra = total - 5;
  const music = pr.mode === "musica";

  const head = `<div class="sec-head"><span class="eyebrow">Treino · ${music ? "palavras das músicas" : `${esc(currentPack(s).title)}${extra > 0 ? ` + ${extra} revisões` : ""}`}</span>
      ${music
        ? `<h2>Do ouvido <span class="mark">pra memória.</span></h2>
           <p>As palavras que escaparam nas músicas voltam aqui. Ouça, lembre o trecho e vire o card.</p></div>`
        : `<h2>Do português <span class="mark">pra boca.</span></h2>
           <p>Nada de escrever. Você fala ou escuta, vira o card e confere.</p></div>`}
    <div class="tabs-mode" role="group" aria-label="Modo de treino">
      <button class="tab" data-act="mode" data-mode="falar" aria-pressed="${pr.mode === "falar"}">${ui.mic}Falar</button>
      <button class="tab" data-act="mode" data-mode="ouvir" aria-pressed="${pr.mode === "ouvir"}">${ui.ear}Ouvir</button>
      <button class="tab" data-act="mode" data-mode="musica" aria-pressed="${music}">${ui.music}Músicas</button>
    </div>`;

  if (music) return `<div class="page"><section class="band"><div class="wrap">${head}${musicBody(s, pr)}</div></section></div>`;

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

    body = `${bar(pr)}
    <div class="flip ${pr.revealed ? "on" : ""}" id="flip"><div class="flip-in">
      <div class="face front" aria-hidden="${pr.revealed}">${front}</div>
      <div class="face back" aria-hidden="${!pr.revealed}"><span class="eyebrow">Do jeito nativo</span>
        <div class="big" lang="en">${highlight(p.en)}</div><div class="foot">${esc(p.pt)}</div></div>
    </div></div>
    ${buttons(pr)}`;
  }

  return `<div class="page"><section class="band"><div class="wrap">${head}${body}</div></section></div>`;
}
