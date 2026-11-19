import { packs } from "../data";
import { esc, highlight, pad } from "../lib/html";
import { canListen } from "../lib/listen";
import { ui } from "../icons";
import { dialogueDone, dialogueScore, dialogueTurnIndex, type AppState, type DialogueTurn } from "../state";

const verdict = (score: number): [label: string, cls: string] =>
  score >= 0.9 ? ["Mandou bem", "ok"] : score >= 0.7 ? ["Quase lá", "tr"] : ["Tenta de novo", "at"];

function myBubble(t: DialogueTurn, expected: string, i: number): string {
  const [label, cls] = verdict(t.result.score);
  const words = t.result.tokens.map((tk) => (tk.hit ? esc(tk.word) : `<span class="miss">${esc(tk.word)}</span>`)).join(" ");
  return `<div class="dl-row me">
    <div class="dl-bub">
      <div class="dl-who"><span>Você</span><span class="st ${cls}">${label} · ${Math.round(t.result.score * 100)}%</span></div>
      <p class="dl-en" lang="en">${words}</p>
      <p class="dl-said">Você disse: “${esc(t.said)}”</p>
      <button class="dl-play" data-act="dl-play" data-line="${i}" aria-label="Ouvir como o nativo fala">${ui.play}Ouvir o nativo</button>
    </div>
  </div>`;
}

export function renderDialogue(s: AppState): string {
  const d = s.dialogue!;
  const pack = packs[d.packIndex]!;
  const turnAt = dialogueTurnIndex(d);
  const mine = pack.chat.map((c, i) => (c.me ? i : -1)).filter((i) => i >= 0);
  const best = s.data.dialogues[pack.id];

  const lines = pack.chat
    .slice(0, d.shown)
    .map((c, i) => {
      if (c.me) {
        const t = d.turns[i];
        return t ? myBubble(t, c.en, i) : "";
      }
      return `<div class="dl-row">
        <div class="dl-bub">
          <div class="dl-who"><span>${esc(c.who)}</span></div>
          <p class="dl-en" lang="en">${highlight(c.en)}</p>
          ${s.showDialoguePt ? `<p class="dl-pt">${esc(c.pt)}</p>` : ""}
          <button class="dl-play" data-act="dl-play" data-line="${i}" aria-label="Ouvir de novo">${ui.play}Ouvir</button>
        </div>
      </div>`;
    })
    .join("");

  let turn = "";
  if (turnAt !== null) {
    const line = pack.chat[turnAt]!;
    const done = d.turns[turnAt];
    if (done) {
      turn = `${myBubble(done, line.en, turnAt)}
        <div class="dl-actions">
          <button class="btn btn-ghost btn-lg" data-act="dl-retry">${ui.mic}Tentar de novo</button>
          <button class="btn ${done.result.pass ? "btn-am" : "btn-ghost"} btn-lg" data-act="dl-next">${ui.arrow}Continuar</button>
        </div>`;
    } else {
      turn = `<div class="dl-turn">
        <span class="eyebrow">Sua vez · diga em inglês</span>
        <p class="dl-prompt">${esc(line.pt)}</p>
        ${d.hint ? `<p class="dl-hint" lang="en">${highlight(line.en)}</p>` : `<button class="link-btn" data-act="dl-hint">Ver a frase em inglês</button>`}
        ${
          canListen
            ? `<button class="mic ${d.listening ? "on" : ""}" data-act="dl-mic" aria-label="${d.listening ? "Parar" : "Falar"}">${ui.mic}</button>
               <p class="dl-live" id="dl-live" aria-live="polite">${d.listening ? "Ouvindo… fale agora" : "Toque e fale a frase"}</p>`
            : ""
        }
        <form class="dl-type" data-form="dl-type">
          <input id="dl-input" autocomplete="off" autocapitalize="off" spellcheck="false" lang="en"
            placeholder="${canListen ? "ou digite / use o microfone do teclado" : "Toque no microfone do teclado e fale"}">
          <button class="btn btn-ultra" type="submit">Enviar</button>
        </form>
        ${d.error ? `<p class="dl-err">${esc(d.error)}</p>` : ""}
        <button class="link-btn subtle" data-act="dl-skip">Pular esta fala</button>
      </div>`;
    }
  }

  const finished = dialogueDone(d);
  const score = dialogueScore(d);
  const summary = finished
    ? `<div class="done">
        <div class="ok-ic">${ui.tick}</div>
        <span class="eyebrow">Diálogo concluído</span>
        <div class="score">${Math.round(score * 100)}<span>%</span></div>
        <p>${score >= 0.9 ? "Fluiu como conversa de verdade. Amanhã tem cena nova." : "Repete mais uma vez: na segunda a frase já sai mais fácil."}
        ${best ? ` Seu recorde nessa cena: <b>${Math.round(best.best * 100)}%</b>.` : ""}</p>
        <div class="btnrow">
          <button class="btn btn-ghost btn-lg" data-act="dl-restart">${ui.flip}Fazer de novo</button>
          <button class="btn btn-am btn-lg" data-act="goto-ia">Conversar com a IA</button>
        </div>
      </div>`
    : "";

  return `<div class="page"><section class="band"><div class="wrap">
    <div class="sec-head"><span class="eyebrow">Diálogo · ${esc(pack.title)}</span>
      <h2>${esc(pack.scene)}</h2>
      <p>A outra pessoa fala, você responde em voz alta. O app escuta e mostra o que ficou faltando.</p></div>
    <div class="dl-bar">
      <div class="steps-bar">${mine
        .map((i) => {
          const t = d.turns[i];
          return `<i class="${t ? (t.result.pass ? "on" : "now") : i === turnAt ? "now" : ""}"></i>`;
        })
        .join("")}</div>
      <span class="mono">${pad(Object.keys(d.turns).length)}/${pad(mine.length)}</span>
      <button class="btn btn-ghost btn-sm" data-act="dl-pt" aria-pressed="${s.showDialoguePt}">${s.showDialoguePt ? "Esconder PT" : "Ver PT"}</button>
    </div>
    <div class="dl-chat">${lines}${turn}</div>
    ${summary}
  </div></section></div>`;
}
