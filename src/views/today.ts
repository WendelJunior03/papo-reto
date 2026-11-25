import { packs, phraseId, type Phrase, type Tag } from "../data";
import { esc, highlight, pad } from "../lib/html";
import { isKnown } from "../lib/srs";
import { ui } from "../icons";
import { canPush, isIOS, isStandalone } from "../lib/device";
import { currentPack, earReviewsDue, knownInPack, reviewsDue, type AppState } from "../state";

export const TAGS: Record<Tag, [label: string, cls: string]> = {
  giria: ["Gíria", "at"],
  casual: ["Casual", "tr"],
  neutro: ["Neutro", "ex"],
  texting: ["Mensagem", "ok"],
};

function packLabel(s: AppState): string {
  const n = packs.length;
  const off = (((s.packIndex - s.todayIndex) % n) + n) % n;
  if (off === 0) return "Pacote de hoje";
  if (off === 1) return "Pacote de amanhã";
  if (off === n - 1) return "Pacote de ontem";
  return `Situação ${pad(s.packIndex + 1)} de ${n}`;
}

function examples(id: string, list: Phrase["examples"]): string {
  if (!list) return "";
  return `<span class="mono ex-title">Outros jeitos de usar</span><ul class="examples">${list
    .map(
      (ex, i) => `<li><button class="ex-play" data-act="say-ex" data-id="${id}" data-ex="${i}" aria-label="Ouvir exemplo">${ui.play}</button>
        <div><p lang="en">${highlight(ex.en)}</p><p class="ex-pt">${esc(ex.pt)}</p></div></li>`,
    )
    .join("")}</ul>`;
}

/** Lembrete diário: notificação no horário escolhido; o calendário (.ics) fica de reserva. */
function reminderCard(s: AppState): string {
  const time = esc(s.data.reminderTime);
  const input = `<label class="mono" for="reminder-time">Horário</label>
        <input type="time" id="reminder-time" value="${time}">`;
  const calendar = `<button class="btn btn-am" data-act="reminder">${ui.download}Adicionar ao calendário</button>`;
  const calendarLink = `<button class="link-btn subtle reminder-alt" data-act="reminder">Prefiro um lembrete no calendário</button>`;
  const r = s.reminder;

  if (s.pushAvailable && canPush()) {
    if (r?.enabled) {
      return `<div class="reminder">
      <span class="eyebrow">Lembrete diário</span>
      <h3>Lembrete às <span class="mark">${esc(r.time)}</span> ${ui.tick}</h3>
      <p>${s.pushOn
        ? "Todo dia nesse horário chega uma notificação com o pacote do dia (e as revisões que estiverem esperando)."
        : "Ativado em outro aparelho. Toque em <b>Ativar neste aparelho</b> pra receber aqui também."}</p>
      <div class="reminder-row">
        ${input}
        <button class="btn btn-am" data-act="reminder-on">${s.pushOn ? "Mudar horário" : "Ativar neste aparelho"}</button>
        <button class="btn btn-ghost" data-act="reminder-off">Desativar</button>
      </div>
      ${calendarLink}
    </div>`;
    }
    return `<div class="reminder">
      <span class="eyebrow">Lembrete diário</span>
      <h3>Todo dia, no mesmo horário.</h3>
      <p>Escolha a hora e o app te manda uma notificação com o pacote do dia — e quantas revisões estão esperando.</p>
      <div class="reminder-row">
        ${input}
        <button class="btn btn-am" data-act="reminder-on">${ui.tick}Ativar lembrete</button>
      </div>
      ${calendarLink}
    </div>`;
  }

  // Sem notificação: explica por quê e oferece o calendário.
  const why = !s.pushAvailable
    ? "Cria um alarme diário no calendário do seu celular, com o link pro pacote do dia. Sem conta e sem internet."
    : isIOS() && !isStandalone()
      ? `No iPhone, a notificação só funciona com o app instalado: toque em ${ui.share} <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b> e abra por lá. Enquanto isso, dá pra usar um alarme no calendário.`
      : "Este navegador não recebe notificações. Dá pra criar um alarme diário no calendário do celular, com o link pro pacote do dia.";
  return `<div class="reminder">
      <span class="eyebrow">Lembrete diário</span>
      <h3>${s.data.reminderAdded ? "Lembrete no seu calendário." : "Todo dia, no mesmo horário."}</h3>
      <p>${s.data.reminderAdded
        ? `Ele toca às <b>${time}</b> com o link do app. Quer outro horário? Escolha e adicione de novo — o novo substitui o antigo.`
        : why}</p>
      <div class="reminder-row">
        ${input}
        ${calendar}
      </div>
    </div>`;
}

export function renderToday(s: AppState): string {
  const pack = currentPack(s);
  const k = knownInPack(s, s.packIndex);
  const isToday = s.packIndex === s.todayIndex;
  const words = pack.title.split(" ");
  const last = words.pop() ?? "";
  const due = reviewsDue(s).length;
  const earDue = earReviewsDue(s).length;

  const cards = pack.phrases
    .map((p, i) => {
      const id = phraseId(pack, i);
      const kn = isKnown(s.data.progress[id]);
      const open = s.openTips.has(id);
      const flipOpen = s.openFlips.has(id);
      const f = p.flip;
      const [label, cls] = TAGS[p.tag];
      return `<article class="card ${kn ? "known" : ""}">
        <div class="card-top"><span class="n">${pad(i + 1)} / 05</span><span class="st ${cls}">${label}</span></div>
        <p class="en" lang="en">${highlight(p.en)}</p>
        <div class="ptl"><span class="mono">PT</span><p>${esc(p.pt)}</p></div>
        ${open ? `<div class="suggest"><span class="mono">Como o nativo usa</span><div>${p.note}</div>${examples(id, p.examples)}</div>` : ""}
        ${
          f && flipOpen
            ? `<div class="flip-box">
                <span class="mono">${f.kind === "question" ? "Perguntando pra alguém" : "Respondendo"}</span>
                <div class="flip-row">
                  <button class="ex-play" data-act="say-flip" data-id="${id}" aria-label="Ouvir">${ui.play}</button>
                  <div><p class="flip-en" lang="en">${highlight(f.en)}</p><p class="flip-pt">${esc(f.pt)}</p></div>
                </div>
                <p class="flip-how">${ui.flip}<span>${esc(f.how)}</span></p>
              </div>`
            : ""
        }
        <div class="acts">
          <button class="btn btn-ultra" data-act="say" data-id="${id}">${ui.play}Ouvir</button>
          <button class="btn btn-ghost btn-ic" data-act="slow" data-id="${id}" aria-label="Ouvir devagar" title="Devagar">${ui.slow}</button>
          <button class="btn btn-ghost" data-act="tip" data-id="${id}" aria-expanded="${open}">${ui.tip}Dica e exemplos</button>
          ${f ? `<button class="btn btn-ghost" data-act="flip" data-id="${id}" aria-expanded="${flipOpen}">${ui.flip}${f.kind === "question" ? "Virar pergunta" : "Ver resposta"}</button>` : ""}
          <button class="btn ${kn ? "btn-am" : "btn-ghost"} push" data-act="known" data-id="${id}" aria-pressed="${kn}">${ui.tick}${kn ? "Já sei" : "Sei essa"}</button>
        </div>
      </article>`;
    })
    .join("");

  const chat = pack.chat
    .map(
      (c) => `<div class="row ${c.me ? "me" : ""}"><span class="who">${c.me ? "Você" : esc(c.who)}</span>
        <div><div class="l1" lang="en">${highlight(c.en)}</div>${s.showChatPt ? `<div class="l2">${esc(c.pt)}</div>` : ""}</div></div>`,
    )
    .join("");

  // Só palavras das músicas vencidas: o banner já abre o Treinar no modo "Músicas".
  const ears = `${earDue} ${earDue === 1 ? "palavra" : "palavras"} das músicas`;
  const reviewBanner = due || earDue
    ? `<button class="review" data-act="${due ? "goto-treino" : "goto-treino-musica"}">
        <span class="st at">${due + earDue} ${due + earDue === 1 ? "revisão" : "revisões"}</span>
        <span class="txt">${
          !due ? `${ears} que você errou. Leva 1 minuto.`
          : earDue ? `Frases de outros dias e ${ears} querendo voltar.`
          : "Frases de outros dias querendo voltar. Leva 2 minutos."
        }</span>${ui.arrow}
      </button>`
    : "";

  const iosHint =
    isIOS() && !isStandalone() && !s.data.installHintDismissed
      ? `<div class="install-hint"><span class="eyebrow">Instale no iPhone</span>
          <p>Toque em ${ui.share} <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>. Abre como app e funciona sem internet.</p>
          <button class="btn btn-ghost" data-act="dismiss-ios">Entendi</button></div>`
      : "";

  return `<div class="page">
  <section class="on-dark hero"><canvas id="dots" aria-hidden="true"></canvas><div class="wrap">
    <div class="hero-meta mono"><span><i class="live"></i>${packLabel(s)}</span><span>Método natural</span></div>
    <h1>${esc(words.join(" "))} <span class="mark">${esc(last)}.</span></h1>
    <p class="lead">${esc(pack.scene)}. Cinco frases inteiras, do jeito que o nativo fala, e uma cena real pra ver elas em uso.</p>
    ${isToday ? "" : `<button class="backtoday" data-act="today">Voltar pra hoje</button>`}
    <div class="steps-bar" role="img" aria-label="${k} de 5 dominadas">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < k ? "on" : ""}"></i>`).join("")}</div>
    <div class="hero-foot">
      <div class="txt"><b>${k}/5 dominadas</b> · ${k === 5 ? "pacote completo, agora é treinar" : "marque as que já saem naturais"}</div>
      <button class="btn btn-ghost btn-ic" data-act="prev" aria-label="Situação anterior">${ui.back}</button>
      <button class="btn btn-ghost btn-ic" data-act="next" aria-label="Próxima situação">${ui.arrow}</button>
    </div>
  </div></section>

  <section class="band"><div class="wrap">
    ${reviewBanner}
    <button class="review listen-entry" data-act="listen-open">
      <span class="st tr">Ouvir no carro</span>
      <span class="txt">As frases e a cena em áudio, com tradução. Toca até com a tela bloqueada.</span>${ui.arrow}
    </button>
    <div class="sec-head"><span class="eyebrow">Frases do dia</span><h2>Fale como <span class="mark">quem mora lá.</span></h2></div>
    <div class="list">${cards}</div>
  </div></section>

  <section class="on-dark scene"><div class="wrap">
    <div class="sec-head"><span class="eyebrow">Na vida real</span><h2>${esc(pack.scene)}</h2>
      <p class="on-dark-p">Leia em voz alta fazendo o seu papel. O que está em amarelo são as frases de hoje.</p></div>
    <div class="chat">${chat}</div>
    <div class="acts">
      <button class="btn btn-am" data-act="goto-dialogo">${ui.mic}Praticar falando</button>
      <button class="btn btn-ghost" data-act="saychat">${ui.play}Ouvir a cena</button>
      <button class="btn btn-ghost" data-act="chatpt" aria-pressed="${s.showChatPt}">${s.showChatPt ? "Esconder tradução" : "Ver tradução"}</button>
    </div>
  </div></section>
  <section class="band"><div class="wrap">
    ${reminderCard(s)}
    ${iosHint}
  </div></section>
  </div>`;
}
