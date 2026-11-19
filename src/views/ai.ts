import { packs } from "../data";
import { esc } from "../lib/html";
import { canListen } from "../lib/listen";
import { ui } from "../icons";
import { ensureAi, type AppState } from "../state";

export function renderAi(s: AppState): string {
  const chat = ensureAi(s);
  const pack = packs[chat.packIndex]!;

  const bubbles = chat.messages
    .map((m, i) => {
      if (m.role === "assistant") {
        const open = chat.openPt.has(i);
        return `<div class="dl-row">
          <div class="dl-bub">
            <div class="dl-who"><span>Nativo · IA</span></div>
            <p class="dl-en" lang="en">${esc(m.content)}</p>
            ${open && m.pt ? `<p class="dl-pt">${esc(m.pt)}</p>` : ""}
            <div class="ai-tools">
              <button class="dl-play" data-act="ai-say" data-i="${i}">${ui.play}Ouvir</button>
              <button class="dl-play ghost" data-act="ai-pt" data-i="${i}">${open ? "Esconder PT" : "Ver PT"}</button>
            </div>
          </div>
        </div>`;
      }
      return `<div class="dl-row me">
        <div class="dl-bub">
          <div class="dl-who"><span>Você</span></div>
          <p class="dl-en" lang="en">${esc(m.content)}</p>
        </div>
      </div>
      ${
        m.correction
          ? `<div class="ai-fix">
              <span class="mono">Mais natural</span>
              <p lang="en">${esc(m.correction)}</p>
              ${m.note ? `<p class="ai-note">${esc(m.note)}</p>` : ""}
              <button class="dl-play" data-act="ai-say-fix" data-i="${i}">${ui.play}Ouvir</button>
            </div>`
          : ""
      }`;
    })
    .join("");

  const empty = !chat.messages.length && !chat.loading;

  return `<div class="page"><section class="band"><div class="wrap">
    <div class="sec-head"><span class="eyebrow">Conversa livre · IA</span>
      <h2>Bate-papo com <span class="mark">um nativo.</span></h2>
      <p>Escreva ou fale o que quiser. A IA responde no papel da situação e mostra o jeito natural de dizer o que você tentou.</p></div>
    <div class="ai-scene">
      <div><span class="mono">Situação</span><b>${esc(pack.title)}</b><small>${esc(pack.scene)}</small></div>
      <div class="ai-scene-nav">
        <button class="btn btn-ghost btn-ic" data-act="ai-prev" aria-label="Situação anterior">${ui.back}</button>
        <button class="btn btn-ghost btn-ic" data-act="ai-next" aria-label="Próxima situação">${ui.arrow}</button>
      </div>
    </div>
    ${
      empty
        ? `<div class="ai-empty"><p>A IA começa a conversa. Responda como se fosse de verdade — errar faz parte.</p>
            <button class="btn btn-am btn-lg" data-act="ai-start">Começar conversa</button></div>`
        : `<div class="dl-chat">${bubbles}${chat.loading ? `<div class="dl-row"><div class="dl-bub typing"><i></i><i></i><i></i></div></div>` : ""}</div>`
    }
    ${chat.error ? `<p class="dl-err">${esc(chat.error)}</p>` : ""}
    ${
      empty
        ? ""
        : `<form class="ai-compose" data-form="ai-send">
            <textarea id="ai-input" rows="1" lang="en" placeholder="Escreva em inglês…" ${chat.loading ? "disabled" : ""}>${esc(chat.draft)}</textarea>
            ${canListen ? `<button type="button" class="btn btn-ghost btn-ic" data-act="ai-mic" aria-label="Falar">${ui.mic}</button>` : ""}
            <button type="submit" class="btn btn-ultra btn-ic" aria-label="Enviar" ${chat.loading ? "disabled" : ""}>${ui.arrow}</button>
          </form>
          <button class="link-btn subtle" data-act="ai-reset">Nova conversa</button>`
    }
  </div></section></div>`;
}
