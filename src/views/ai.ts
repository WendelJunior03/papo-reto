import { packs } from "../data";
import { esc } from "../lib/html";
import { canListen } from "../lib/listen";
import { ui } from "../icons";
import { ensureAi, type AppState } from "../state";
import { DEFAULT_MODEL, maskKey, PROVIDER_NAME, providerFor } from "../lib/provider";

/** Cartão pra colar a própria chave da OpenAI ou da Anthropic. */
function keyCard(s: AppState): string {
  const k = s.aiKey;
  const provider = k ? providerFor(k.key) : null;
  if (k && provider && !s.aiSettings.open) {
    return `<div class="ai-key-line">
      <span class="st ok">Sua chave</span>
      <span>${PROVIDER_NAME[provider]} · <code>${esc(maskKey(k.key))}</code> · ${esc(k.model || DEFAULT_MODEL[provider])}</span>
      <button class="link-btn" data-act="ai-key-edit">Trocar</button>
    </div>`;
  }
  return `<form class="ai-key" data-form="ai-key" autocomplete="off">
    <span class="eyebrow">Sua chave de IA</span>
    <p>Cole a sua chave de API da <b>OpenAI</b> (começa com <code>sk-</code>) ou da <b>Anthropic</b> (<code>sk-ant-</code>). A conversa é cobrada na sua conta.</p>
    <label class="field"><span>Chave</span>
      <input id="ai-key-input" name="key" type="password" spellcheck="false" autocapitalize="off" placeholder="sk-..." value="${esc(k?.key ?? "")}"></label>
    <label class="field"><span>Modelo <small>(opcional)</small></span>
      <input id="ai-model-input" name="model" spellcheck="false" autocapitalize="off" placeholder="Padrão: ${DEFAULT_MODEL.openai} ou ${DEFAULT_MODEL.anthropic}" value="${esc(k?.model ?? "")}"></label>
    ${s.aiSettings.error ? `<p class="dl-err">${esc(s.aiSettings.error)}</p>` : ""}
    <div class="acts">
      <button class="btn btn-am" type="submit">Salvar chave</button>
      ${k ? `<button class="btn btn-ghost" type="button" data-act="ai-key-remove">Remover</button>` : ""}
      ${k || s.serverAi ? `<button class="btn btn-ghost" type="button" data-act="ai-key-cancel">Cancelar</button>` : ""}
    </div>
    <p class="ai-key-help">Onde pegar: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a>
      ou <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.
      A chave fica salva só neste aparelho e vai direto pra empresa de IA a cada mensagem — o Papo Reto não guarda.</p>
  </form>`;
}

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
  const needsKey = !s.aiKey && !s.serverAi;

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
    ${needsKey || s.aiSettings.open || s.aiKey ? keyCard(s) : `<div class="ai-key-line"><span class="st tr">Chave do app</span><span>Usando a IA do app (limite diário).</span><button class="link-btn" data-act="ai-key-edit">Usar minha chave</button></div>`}
    ${
      needsKey
        ? ""
        : empty
        ? `<div class="ai-empty"><p>A IA começa a conversa. Responda como se fosse de verdade — errar faz parte.</p>
            <button class="btn btn-am btn-lg" data-act="ai-start">Começar conversa</button></div>`
        : `<div class="dl-chat">${bubbles}${chat.loading ? `<div class="dl-row"><div class="dl-bub typing"><i></i><i></i><i></i></div></div>` : ""}</div>`
    }
    ${chat.error ? `<p class="dl-err">${esc(chat.error)}</p>` : ""}
    ${
      empty || needsKey
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
