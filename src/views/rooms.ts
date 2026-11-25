/**
 * Telas das Salas ao vivo: lobby (criar ou entrar), espera, ao vivo, quitado e resumo.
 * O estado e a conexão ficam em src/rooms.ts.
 */
import { findPhrase } from "../data";
import { esc, plain } from "../lib/html";
import { ROOM_TOPICS } from "../lib/room-topics";
import { ui } from "../icons";
import { clock, hasClip, roomLink, secondsLeft, type RoomUi } from "../rooms";
import type { RoomLevel, RoomView } from "../../server/room-core";

export const LEVELS: Record<RoomLevel, { label: string; strikes: number; help: string }> = {
  iniciante: { label: "Iniciante", strikes: 3, help: "3 avisos · frases de apoio na tela" },
  intermediario: { label: "Intermediário", strikes: 2, help: "2 avisos · um tema pra puxar papo" },
  nativo: { label: "Nativo", strikes: 1, help: "1 aviso · sem ajuda nenhuma" },
};

/**
 * Espaço pra outras funções colocarem algo na sala de espera — ex.: a lista "chamar amigo"
 * dos convites. Recebe o código e o link; devolve HTML (já escapado).
 */
let inviteExtras: (room: { code: string; link: string }) => string = () => "";
export function setRoomInviteExtras(fn: (room: { code: string; link: string }) => string): void {
  inviteExtras = fn;
}

const fmtCode = (code: string): string => `${code.slice(0, 4)} ${code.slice(4)}`;
const talkTime = (ms: number): string => clock(Math.round(ms / 1000));

function strikesDots(strikes: number, max: number): string {
  return `<span class="room-dots" aria-label="${strikes} de ${max} avisos">${Array.from({ length: max }, (_, i) => `<i class="${i < strikes ? "on" : ""}"></i>`).join("")}</span>`;
}

function connBanner(r: RoomUi): string {
  if (r.conn === "retrying") return `<div class="room-conn">Reconectando à sala…</div>`;
  if (r.conn === "lost") {
    return `<div class="room-conn lost">Sem conexão com a sala. <button class="link-btn" data-act="room-retry">Tentar de novo</button></div>`;
  }
  return "";
}

/* ---------- 1. lobby ---------- */
function lobby(r: RoomUi): string {
  const joining = r.code && (r.conn === "connecting" || r.conn === "retrying");
  const levels = (Object.keys(LEVELS) as RoomLevel[])
    .map((k) => `<button class="room-level" data-act="room-level" data-level="${k}" aria-pressed="${r.create.level === k}">
        <b>${LEVELS[k].label}</b><small>${LEVELS[k].help}</small></button>`)
    .join("");
  return `<div class="page"><section class="band"><div class="wrap">
    <div class="sec-head"><span class="eyebrow">Salas ao vivo</span>
      <h2>Inglês por voz, <span class="mark">com os amigos.</span></h2>
      <p>Segure o botão pra falar, como walkie-talkie: uma pessoa por vez, 10 minutos por sala. Falou português, leva aviso — no último, tá fora.</p></div>
    ${r.error ? `<p class="dl-err">${esc(r.error)}</p>` : ""}
    ${joining ? `<p class="room-joining"><i class="live"></i>Entrando na sala ${esc(fmtCode(r.code!))}…</p>` : ""}
    <div class="room-card">
      <h3>Criar sala</h3>
      <span class="mono">Quantas pessoas</span>
      <div class="tabs-mode" role="group" aria-label="Quantas pessoas">
        <button class="tab" data-act="room-size" data-size="2" aria-pressed="${r.create.size === 2}">2 pessoas</button>
        <button class="tab" data-act="room-size" data-size="4" aria-pressed="${r.create.size === 4}">4 pessoas</button>
      </div>
      <span class="mono">Nível</span>
      <div class="room-levels" role="group" aria-label="Nível">${levels}</div>
      <button class="btn btn-am btn-lg" data-act="room-create" ${r.busy ? "disabled" : ""}>${r.busy ? "Criando…" : "Criar sala e chamar amigos"}</button>
    </div>
    <form class="room-card" data-form="room-join">
      <h3>Entrar com código</h3>
      <div class="dl-type">
        <input id="room-code" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="ABCD 2345" aria-label="Código da sala" enterkeyhint="go">
        <button class="btn btn-ultra" type="submit">Entrar</button>
      </div>
      <small class="room-note">Só entra quem tem o código (ou o link). Nada de sala pública.</small>
    </form>
  </div></section></div>`;
}

/* ---------- 2. espera ---------- */
function waiting(r: RoomUi, room: RoomView): string {
  const link = roomLink(room.code);
  const isCreator = room.creator === r.you;
  const active = room.members.filter((m) => !m.kicked);
  const slots = Array.from({ length: room.size }, (_, i) => {
    const m = active[i];
    if (!m) return `<li class="empty"><span class="avatar">?</span><span>Esperando…</span></li>`;
    return `<li class="${m.online ? "" : "off"}"><span class="avatar">${esc(m.name.slice(0, 1).toUpperCase())}</span>
      <span>${esc(m.name)}${m.name === r.you ? " <small>(você)</small>" : ""}${m.name === room.creator ? ` <span class="st u">criou</span>` : ""}</span></li>`;
  }).join("");
  const start = isCreator
    ? active.length >= 2
      ? `<button class="btn btn-am btn-lg" data-act="room-start">Começar agora (${active.length} de ${room.size})</button>`
      : `<p class="room-note">Começa sozinha quando ${room.size === 2 ? "seu amigo entrar" : "a sala encher"} — ou toque em Começar quando tiver 2 ou mais.</p>`
    : `<p class="room-note">Esperando ${esc(room.creator ?? "quem criou")} começar (ou a sala encher).</p>`;
  return `<div class="page"><section class="band"><div class="wrap">
    ${connBanner(r)}
    <div class="sec-head"><span class="eyebrow">Sala de espera · ${LEVELS[room.level].label} · ${room.size} pessoas</span>
      <h2>Chame a galera <span class="mark">pra sala.</span></h2></div>
    <div class="room-card room-share">
      <span class="mono">Código da sala</span>
      <b class="room-code">${esc(fmtCode(room.code))}</b>
      <input id="room-link" class="room-link" value="${esc(link)}" readonly aria-label="Link da sala">
      <div class="dl-actions">
        <button class="btn btn-am" data-act="room-share">${ui.share}Mandar o link</button>
        <button class="btn btn-ghost" data-act="room-copy">Copiar</button>
      </div>
      ${inviteExtras({ code: room.code, link })}
    </div>
    <ul class="room-members">${slots}</ul>
    ${start}
    ${r.micReady ? "" : `<button class="btn btn-ghost room-mic" data-act="room-mic">${ui.mic}Liberar o microfone antes</button>`}
    <p class="room-note">${LEVELS[room.level].help}. Valendo 10 minutos assim que começar.</p>
    <button class="link-btn subtle room-leave" data-act="room-leave">Sair da sala</button>
  </div></section></div>`;
}

/* ---------- 3. ao vivo ---------- */
function helpBox(r: RoomUi, room: RoomView): string {
  if (room.level === "intermediario") {
    const t = ROOM_TOPICS[room.topic % ROOM_TOPICS.length]!;
    return `<div class="room-help"><span class="mono">Tema</span>
      <b lang="en">${esc(t.en)}</b><small>${esc(t.pt)}</small><p lang="en">“${esc(t.ask)}”</p>
      <button class="link-btn" data-act="room-topic">Outro tema</button></div>`;
  }
  if (room.level !== "iniciante") return "";
  const items = r.helpers
    .map((id) => findPhrase(id))
    .filter((p) => !!p)
    .map((p) => `<li><button class="ex-play" data-act="say" data-id="${p.id}" aria-label="Ouvir">${ui.play}</button>
      <div><p lang="en">${esc(plain(p.en))}</p><small>${esc(p.pt)}</small></div></li>`)
    .join("");
  return `<div class="room-help"><span class="mono">Travou? Tenta uma dessas</span><ul class="examples">${items}</ul>
    <button class="link-btn" data-act="room-helpers">Outras frases</button></div>`;
}

function live(r: RoomUi, room: RoomView): string {
  const me = room.members.find((m) => m.name === r.you);
  const sec = secondsLeft(room);
  const people = room.members
    .map((m) => {
      const speaking = room.floor?.name === m.name;
      return `<li class="${m.kicked ? "kicked" : m.online ? "" : "off"} ${speaking ? "speaking" : ""}">
        <span class="avatar">${esc(m.name.slice(0, 1).toUpperCase())}</span><span class="nm">${esc(m.name)}</span>${strikesDots(m.strikes, room.maxStrikes)}</li>`;
    })
    .join("");
  const log = r.log.length
    ? r.log
        .map((e) => `<li class="${e.name === r.you ? "me" : ""} ${e.pt ? "pt" : ""}">
          <span class="who">${esc(e.name === r.you ? "Você" : e.name)}${e.pt ? ` <span class="st at">português!</span>` : ""}</span>
          <div class="bub"><p lang="en">${e.text ? esc(e.text) : "<i>(sem transcrição)</i>"}</p>
          ${hasClip(e.id) ? `<button class="ex-play" data-act="room-replay" data-id="${e.id}" aria-label="Ouvir de novo">${ui.play}</button>` : ""}</div></li>`)
        .join("")
    : `<li class="room-empty">Ninguém falou ainda. Segure o botão e quebre o gelo!</li>`;

  const holder = room.floor?.name;
  const mine = holder === r.you;
  const status =
    r.talking === "asking" ? "Pedindo a vez…"
    : r.talking === "recording" || (mine && r.talking !== "sending") ? "Falando… solte pra enviar"
    : r.talking === "sending" ? "Enviando…"
    : holder ? `${esc(holder)} está falando…`
    : r.playing ? `Tocando a fala de ${esc(r.playing)}`
    : "Segure pra falar";
  const busy = !!holder && !mine;
  const on = r.talking === "asking" || r.talking === "recording";

  return `<div class="page"><section class="band room-live"><div class="wrap">
    ${connBanner(r)}
    ${r.banner ? `<div class="room-banner" role="alert">${esc(r.banner)}</div>` : ""}
    <div class="room-top">
      <span class="room-clock ${sec <= 60 ? "low" : ""}" id="room-clock" aria-label="Tempo restante">${clock(sec)}</span>
      <span class="st tr">${LEVELS[room.level].label}</span>
      ${me ? `<span class="room-mine">Avisos ${strikesDots(me.strikes, room.maxStrikes)}</span>` : ""}
    </div>
    <ul class="room-people">${people}</ul>
    ${helpBox(r, room)}
    <ul class="room-log" id="room-log" aria-live="polite">${log}</ul>
    ${r.noTranscript ? `<p class="room-note">Seu aparelho não transcreveu a última fala — o áudio foi mesmo assim.</p>` : ""}
    <div class="room-ptt-bar">
      <p class="room-status" id="room-status">${status}</p>
      ${on ? `<p class="room-partial" id="room-partial">${esc(r.partial) || "Ouvindo… fale em inglês"}</p>` : ""}
      <button class="room-ptt ${on ? "on" : ""} ${busy ? "busy" : ""}" data-ptt aria-label="Segure pra falar" ${r.talking === "sending" ? "disabled" : ""}>${ui.mic}</button>
      ${r.micReady ? "" : `<button class="link-btn subtle" data-act="room-mic">Liberar microfone</button>`}
    </div>
    <button class="link-btn subtle room-leave" data-act="room-leave">Sair da sala</button>
  </div></section></div>`;
}

/* ---------- 4. quitado ---------- */
function kicked(r: RoomUi): string {
  const level = r.room ? LEVELS[r.room.level] : null;
  return `<div class="page"><section class="band"><div class="wrap room-end">
    <span class="room-emoji" aria-hidden="true">😅</span>
    <h2>Você foi quitado <span class="mark">da sala.</span></h2>
    <p>${level ? `No nível ${level.label}, ${level.strikes === 1 ? "o primeiro português já tira" : `são ${level.strikes} avisos`}. ` : ""}Regra é regra: nessa sala você não volta — mas pode criar outra agora mesmo.</p>
    <p class="room-note">Dica: no iPhone, o reconhecimento usa os idiomas do teclado. Deixe o English (US) ativo.</p>
    <button class="btn btn-am btn-lg" data-act="room-lobby">Voltar pras salas</button>
  </div></section></div>`;
}

/* ---------- 5. resumo ---------- */
function summaryScreen(r: RoomUi): string {
  const sm = r.summary!;
  const why = sm.reason === "time" ? "Os 10 minutos acabaram." : sm.reason === "alone" ? "Ficou só uma pessoa na sala." : "A sala expirou antes de começar.";
  const rows = sm.members
    .map((m) => `<tr class="${m.name === r.you ? "on" : ""}"><th>${esc(m.name)}${m.kicked ? " <small>quitado</small>" : ""}</th>
      <td class="num">${m.turns}</td><td class="num">${m.words}</td><td class="num">${talkTime(m.talkMs)}</td><td class="num">${m.strikes}</td></tr>`)
    .join("");
  const total = sm.members.reduce((n, m) => n + m.talkMs, 0);
  return `<div class="page"><section class="band"><div class="wrap room-end">
    <span class="eyebrow">Fim de papo</span>
    <h2>Mandaram bem <span class="mark">em inglês!</span></h2>
    <p>${why} ${Math.round(sm.durationMs / 60_000)} min de sala, ${talkTime(total)} de gente falando.</p>
    <div class="adm-table room-sum"><table>
      <thead><tr><th>Quem</th><th class="num">Falas</th><th class="num">Palavras</th><th class="num">Tempo</th><th class="num">Avisos</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <button class="btn btn-am btn-lg" data-act="room-lobby">Nova sala</button>
  </div></section></div>`;
}

export function renderRooms(r: RoomUi): string {
  if (r.screen === "kicked") return kicked(r);
  if (r.screen === "summary" && r.summary) return summaryScreen(r);
  if (r.screen === "room" && r.room) return r.room.phase === "waiting" ? waiting(r, r.room) : live(r, r.room);
  return lobby(r);
}
