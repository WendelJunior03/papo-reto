import { packs } from "../data";
import { esc } from "../lib/html";
import { canListen } from "../lib/listen";
import { ui } from "../icons";
import { aiLocked, ensureAi, type AppState } from "../state";
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
    <p>Cole a sua chave de API do <b>Google Gemini</b> (<code>AIza…</code>), da <b>OpenAI</b> (<code>sk-</code>) ou da <b>Anthropic</b> (<code>sk-ant-</code>). Com chave própria não há limite de sessão — a conversa é cobrada na sua conta.</p>
    <label class="field"><span>Chave</span>
      <input id="ai-key-input" name="key" type="password" spellcheck="false" autocapitalize="off" placeholder="sk-..." value="${esc(k?.key ?? "")}"></label>
    <label class="field"><span>Modelo <small>(opcional)</small></span>
      <input id="ai-model-input" name="model" spellcheck="false" autocapitalize="off" placeholder="Padrão: ${DEFAULT_MODEL.gemini}, ${DEFAULT_MODEL.openai} ou ${DEFAULT_MODEL.anthropic}" value="${esc(k?.model ?? "")}"></label>
    ${s.aiSettings.error ? `<p class="dl-err">${esc(s.aiSettings.error)}</p>` : ""}
    <div class="acts">
      <button class="btn btn-am" type="submit">Salvar chave</button>
      ${k ? `<button class="btn btn-ghost" type="button" data-act="ai-key-remove">Remover</button>` : ""}
      ${k || s.serverAi ? `<button class="btn btn-ghost" type="button" data-act="ai-key-cancel">Cancelar</button>` : ""}
    </div>
    <p class="ai-key-help">Onde pegar: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>, <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a>
      ou <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.
      A chave fica salva só neste aparelho e vai direto pra empresa de IA a cada mensagem — o Papo Reto não guarda.</p>
  </form>`;
}

const mmss = (ms: number): string => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const clock = (ms: number): string => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * Linha única de status da IA do app (pronta ou contagem regressiva) ou o cartão de espera.
 * O link "usar minha chave" vem junto enquanto o formulário da chave está fechado.
 */
function sessionBar(s: AppState): string {
  if (s.aiKey) return "";
  const st = s.aiSession;
  const own = s.aiSettings.open ? "" : `<button class="link-btn subtle ai-own-key" data-act="ai-key-edit">usar minha chave</button>`;
  if (!st || st.state === "ready") {
    return `<div class="ai-session"><span class="st tr">IA do app</span><span>${st?.state === "ready" ? st.minutes : 7} min de conversa · o tempo começa na sua 1ª mensagem</span>${own}</div>`;
  }
  if (st.state === "active") {
    return `<div class="ai-session live"><span class="st ok">Conversando</span><span><b id="ai-timer">${mmss(st.endsAt - Date.now())}</b> restantes</span>${own}</div>`;
  }
  const mins = Math.max(1, Math.ceil((st.availableAt - Date.now()) / 60_000));
  return `<div class="ai-cooldown">
    <span class="eyebrow">Sessão concluída</span>
    <h3>Mandou bem! Próxima conversa às <span class="mark">${clock(st.availableAt)}</span>.</h3>
    <p>Faltam <b id="ai-wait">${mins} min</b>. Enquanto isso, revise as correções da conversa — é aí que o inglês fixa.</p>
    ${
      s.pushOn
        ? `<p class="ai-notify-on">${ui.tick}Vamos te avisar quando liberar.</p>`
        : s.pushAvailable
          ? `<button class="btn btn-am" data-act="ai-notify">Me avise quando liberar</button>`
          : ""
    }
    ${own}
  </div>`;
}

export function renderAi(s: AppState): string {
  const chat = ensureAi(s);
  const pack = packs[chat.packIndex]!;
  const locked = aiLocked(s);

  const bubbles = chat.messages
    .map((m, i) => {
      if (m.role === "assistant") {
        const open = chat.openPt.has(i);
        return `<div class="dl-row">
          <div class="dl-bub">
            <div class="dl-who"><span>${chat.free ? "Sam · IA" : "Nativo · IA"}</span></div>
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
          <div class="dl-who"><span>Você</span>${m.checked && !m.correction ? `<span class="st ok">Natural</span>` : ""}</div>
          <p class="dl-en" lang="en">${esc(m.content)}</p>
        </div>
      </div>
      ${
        m.correction
          ? `<div class="ai-fix">
              <span class="mono">Correção · mais natural</span>
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
    <div class="sec-head"><span class="eyebrow">Conversa com IA</span>
      <h2>Bate-papo com <span class="mark">um nativo.</span></h2>
      <p>Fale ou escreva sobre o que quiser. Embaixo de cada fala sua aparece a correção, com o jeito natural de dizer.</p></div>
    <div class="tabs-mode ai-mode" role="group" aria-label="Tipo de conversa">
      <button class="tab" data-act="ai-mode" data-free="1" aria-pressed="${chat.free}">Papo livre</button>
      <button class="tab" data-act="ai-mode" data-free="0" aria-pressed="${!chat.free}">Situação</button>
    </div>
    ${
      chat.free
        ? ""
        : `<div class="ai-scene">
            <div><span class="mono">Situação</span><b>${esc(pack.title)}</b><small>${esc(pack.scene)}</small></div>
            <div class="ai-scene-nav">
              <button class="btn btn-ghost btn-ic" data-act="ai-prev" aria-label="Situação anterior">${ui.back}</button>
              <button class="btn btn-ghost btn-ic" data-act="ai-next" aria-label="Próxima situação">${ui.arrow}</button>
            </div>
          </div>`
    }
    ${needsKey || s.aiSettings.open || s.aiKey ? keyCard(s) : ""}
    ${needsKey ? "" : sessionBar(s)}
    ${
      needsKey
        ? ""
        : empty
          ? locked
            ? ""
            : `<div class="ai-empty"><p>${chat.free ? "A IA puxa assunto. Responda como se fosse de verdade — errar faz parte." : "A IA começa a cena. Responda no seu papel."}</p>
                <button class="btn btn-am btn-lg" data-act="ai-start">Começar conversa</button></div>`
          : `<div class="dl-chat">${bubbles}${chat.loading ? `<div class="dl-row"><div class="dl-bub typing"><i></i><i></i><i></i></div></div>` : ""}</div>`
    }
    ${chat.error ? `<p class="dl-err">${esc(chat.error)}</p>` : ""}
    ${
      empty || needsKey || locked
        ? ""
        : `<form class="ai-compose" data-form="ai-send">
            <textarea id="ai-input" rows="1" lang="en-US" autocorrect="off" autocapitalize="sentences" placeholder="Escreva em inglês…" ${chat.loading ? "disabled" : ""}>${esc(chat.draft)}</textarea>
            ${canListen ? `<button type="button" class="btn btn-ghost btn-ic" data-act="ai-mic" aria-label="Falar">${ui.mic}</button>` : ""}
            <button type="submit" class="btn btn-ultra btn-ic" aria-label="Enviar" ${chat.loading ? "disabled" : ""}>${ui.arrow}</button>
          </form>
          <button class="link-btn subtle" data-act="ai-reset">Nova conversa</button>`
    }
  </div></section></div>`;
}
