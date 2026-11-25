/**
 * "Painel do dono": números do app (usuários, quem está ativo, custo da IA) e a lista de usuários,
 * com a senha temporária pra quem esqueceu (o app não tem "esqueci a senha").
 * Só aparece pra quem está em ADMIN_USERS; o servidor confere de novo em cada rota.
 */
import { parseKey } from "../lib/dates";
import { esc } from "../lib/html";
import type { AdminUser } from "../lib/api";
import { ui } from "../icons";
import type { AppState } from "../state";
import { lineChart } from "./evolution";

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "2-digit" }).replace(".", "");

/** "agora", "há 3 h", "ontem", "12 nov". */
function ago(iso: string | null): string {
  if (!iso) return "—";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 60) return "agora";
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  if (min < 48 * 60) return "ontem";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");
}

const studyDay = (key: string | null): string =>
  key ? parseKey(key).toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "") : "—";

/** Topo do eixo: número redondo, nunca menor que `min`. */
const niceMax = (values: number[], min: number): number => {
  const top = Math.max(min, ...values);
  const step = top <= 10 ? 2 : top <= 50 ? 10 : top <= 200 ? 20 : 100;
  return Math.ceil(top / step) * step;
};

const tile = (label: string, value: number | string, note = ""): string =>
  `<div class="tile-s"><span class="lab">${label}</span><b>${value}</b>${note ? `<span class="delta">${note}</span>` : ""}</div>`;

function userRow(u: AdminUser, s: AppState): string {
  const p = s.adminPanel!;
  const name = esc(u.username);
  const confirming = p.confirm === u.username;
  const action = confirming
    ? `<span class="adm-confirm">
        <button class="btn btn-am btn-sm" data-act="admin-reset-go" data-user="${name}" ${p.busy ? "disabled" : ""}>${p.busy ? "Gerando…" : "Confirmar"}</button>
        <button class="btn btn-ghost btn-sm" data-act="admin-reset-cancel">Cancelar</button>
      </span>`
    : `<button class="link-btn" data-act="admin-reset" data-user="${name}">Gerar senha temporária</button>`;
  return `<tr class="${confirming ? "on" : ""}">
    <th scope="row">${name}${u.username.toLowerCase() === s.user.toLowerCase() ? ` <small class="mono">você</small>` : ""}</th>
    <td>${fmtDate(u.createdAt)}</td>
    <td>${ago(u.lastSeen)}</td>
    <td>${studyDay(u.lastStudy)}</td>
    <td class="num">${u.known}</td>
    <td class="num">${u.days}</td>
    <td class="num">${u.streak}</td>
    <td class="num">${u.ai7d}</td>
    <td class="num">${u.invites || "—"}</td>
    <td>${u.invitedBy ? esc(u.invitedBy) : "—"}</td>
    <td>${u.supporter ? "Sim" : "—"}</td>
    <td>${u.push ? "Ligado" : "—"}</td>
    <td>${action}</td>
  </tr>`;
}

export function renderAdmin(s: AppState): string {
  const p = s.adminPanel;
  const back = `<div class="wrap evo-top"><button class="link-btn subtle" data-act="goto-situacoes">${ui.back}Voltar</button></div>`;
  const head = `<div class="sec-head"><span class="eyebrow">Só você vê isto</span><h2>Painel <span class="mark">do dono.</span></h2></div>`;

  if (!p || (p.loading && !p.stats)) {
    return `<div class="page evo">${back}<section class="band"><div class="wrap">${head}<p class="evo-empty">Carregando os números…</p></div></section></div>`;
  }
  if (!p.stats) {
    return `<div class="page evo">${back}<section class="band"><div class="wrap">${head}
      <p class="evo-empty">${esc(p.error ?? "Não deu pra carregar o painel.")}</p>
      <button class="btn btn-ghost btn-sm" data-act="admin-reload">Tentar de novo</button>
    </div></section></div>`;
  }
  const st = p.stats;

  const kpis = `<div class="evo-card">
    <div class="evo-head"><span class="eyebrow">Usuários</span><button class="link-btn" data-act="admin-reload">${p.loading ? "Atualizando…" : "Atualizar"}</button></div>
    <div class="tiles adm-tiles">
      ${tile("Usuários", st.users)}
      ${tile("Ativos hoje", st.active.today)}
      ${tile("Ativos em 7 dias", st.active.d7)}
      ${tile("Ativos em 30 dias", st.active.d30)}
      ${tile("Apoiadores", st.supporters)}
      ${tile("Inscritos em notificação", st.pushSubscribers)}
    </div>
    <p class="evo-hint">Ativo = abriu o app (registrado no servidor) ou estudou no período. Frases dominadas somando todo mundo: <b>${st.phrasesKnown}</b> · músicas treinadas: <b>${st.songsPracticed}</b>.</p>
  </div>`;

  const signups = `<div class="evo-card">
    <div class="evo-head"><span class="eyebrow">Cadastros por dia</span><span class="mono">30 dias</span></div>
    ${lineChart(st.signupsByDay, { max: niceMax(st.signupsByDay.map((x) => x.value), 4), fmt: (v) => String(Math.round(v)), label: "cadastros", one: "cadastro" })}
  </div>`;

  const ai = `<div class="evo-card">
    <div class="evo-head"><span class="eyebrow">IA do app (custo)</span><span class="mono">30 dias</span></div>
    <div class="tiles">
      ${tile("Mensagens hoje", st.aiMessages.today)}
      ${tile("Mensagens em 7 dias", st.aiMessages.d7)}
    </div>
    ${lineChart(st.aiMessagesByDay, { max: niceMax(st.aiMessagesByDay.map((x) => x.value), 10), fmt: (v) => String(Math.round(v)), label: "mensagens", one: "mensagem" })}
    <p class="evo-hint">Só mensagens com a chave do app (quem usa a própria chave não entra). ${st.aiSessionsToday} ${st.aiSessionsToday === 1 ? "pessoa abriu" : "pessoas abriram"} sessão hoje.</p>
  </div>`;

  const temp = p.temp
    ? `<div class="adm-temp" role="status">
        <span class="mono">Senha temporária de ${esc(p.temp.username)}</span>
        <div class="adm-temp-row">
          <input id="admin-temp" readonly value="${esc(p.temp.password)}" aria-label="Senha temporária" />
          <button class="btn btn-am btn-sm" data-act="admin-copy">Copiar</button>
        </div>
        <small><b>Ela aparece só esta vez.</b> Mande pra pessoa por um canal seu; a senha antiga parou de valer e ela saiu de todos os aparelhos.</small>
        <button class="link-btn" data-act="admin-temp-close">Já enviei, fechar</button>
      </div>`
    : "";

  const confirmNote = p.confirm
    ? `<p class="adm-warn">Gerar senha temporária pra <b>${esc(p.confirm)}</b>? A senha atual deixa de valer e a pessoa sai de todos os aparelhos.</p>`
    : "";

  const users = `<div class="evo-card">
    <div class="evo-head"><span class="eyebrow">Usuários</span><span class="mono">${p.users.length}</span></div>
    ${temp}${confirmNote}
    ${p.error ? `<p class="adm-warn">${esc(p.error)}</p>` : ""}
    <div class="adm-table">
      <table>
        <thead><tr>
          <th scope="col">Usuário</th><th scope="col">Desde</th><th scope="col">Último acesso</th><th scope="col">Último estudo</th>
          <th scope="col" class="num">Frases</th><th scope="col" class="num">Dias</th><th scope="col" class="num">Seguidos</th>
          <th scope="col" class="num">IA 7d</th><th scope="col" class="num">Convidou</th><th scope="col">Convite de</th><th scope="col">Apoio</th><th scope="col">Aviso</th><th scope="col"><span class="sr">Ação</span></th>
        </tr></thead>
        <tbody>${p.users.map((u) => userRow(u, s)).join("")}</tbody>
      </table>
    </div>
  </div>`;

  return `<div class="page evo">
    ${back}
    <section class="band"><div class="wrap">${head}<div class="evo-grid">${kpis}${signups}${ai}${users}</div></div></section>
  </div>`;
}
