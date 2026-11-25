import { esc, highlight } from "../lib/html";
import { MAX_SAVED_STORIES, MIN_KNOWN } from "../lib/story";
import { ui } from "../icons";
import { currentStory, knownCount, type AppState } from "../state";

const dateLabel = (d: string): string => {
  const [y, m, day] = d.split("-");
  return y && m && day ? esc(`${day}/${m}`) : "";
};

/** Tela cheia das historinhas: a aberta, com áudio e tradução, e as últimas guardadas. */
export function renderStory(s: AppState): string {
  const st = s.story;
  const story = currentStory(s);
  const known = knownCount(s);
  const enough = known >= MIN_KNOWN;
  const canAi = s.serverAi || !!s.aiKey;

  const newBtn = (cls: string, label: string) =>
    `<button class="btn ${cls}" data-act="story-new" ${st.loading ? "disabled" : ""}>${ui.flip}${st.loading ? "Escrevendo…" : label}</button>`;

  // O que aparece quando não há historinha aberta (ou não dá pra criar).
  const empty = !enough
    ? `<p class="story-title">Ainda não dá pra montar.</p>
       <p class="story-sub">Marque algumas frases como "Sei essa" primeiro. Com ${MIN_KNOWN} ou mais, a IA escreve uma historinha só com o que você já sabe${known ? ` (você tem ${known})` : ""}.</p>
       <button class="btn btn-am" data-act="story-close">Ver as frases de hoje</button>`
    : !canAi
      ? `<p class="story-title">Falta a chave de IA.</p>
         <p class="story-sub">Pra criar historinhas, adicione sua chave na aba IA.</p>
         <button class="btn btn-am" data-act="goto-ia">Ir pra aba IA</button>`
      : `<p class="story-title">Uma historinha com as suas frases.</p>
         <p class="story-sub">A IA escreve um conto curto do dia a dia usando frases que você já marcou. As suas aparecem em amarelo.</p>
         ${newBtn("btn-am", "Criar historinha")}`;

  const hero = story && !st.loading
    ? `<h1 class="story-title" lang="en">${esc(story.title)}</h1>
       <p class="story-sub">${esc(story.title_pt)}</p>
       <div class="acts">
         <button class="btn btn-am" data-act="story-say-all">${ui.play}Ouvir tudo</button>
         <button class="btn btn-ghost" data-act="story-pt-all" aria-pressed="${st.showPt}">${st.showPt ? "Esconder tradução" : "Mostrar tradução"}</button>
       </div>`
    : st.loading
      ? `<p class="story-title">Escrevendo sua historinha…</p><p class="story-sub">Leva só alguns segundos.</p>`
      : empty;

  const lines = story && !st.loading
    ? `<ol class="story-lines">${story.lines
        .map((l, i) => {
          const pt = st.showPt !== st.flipped.has(i);
          return `<li class="story-line">
            <button class="ex-play" data-act="story-say" data-i="${i}" aria-label="Ouvir esta frase">${ui.play}</button>
            <button class="story-text" data-act="story-pt" data-i="${i}" aria-expanded="${pt}" aria-label="${pt ? "Esconder" : "Mostrar"} tradução">
              <span class="story-en" lang="en">${highlight(l.en)}</span>
              ${pt ? `<span class="story-pt">${esc(l.pt)}</span>` : ""}
            </button>
          </li>`;
        })
        .join("")}</ol>
      <p class="story-hint">Toque numa frase pra ver a tradução.</p>`
    : "";

  const again = story && enough && canAi && !st.loading
    ? `<div class="story-again">${newBtn("btn-ultra", "Nova historinha")}
        ${st.left !== null ? `<span class="mono">${st.left === 0 ? "Acabaram as de hoje" : `${st.left} ${st.left === 1 ? "restante" : "restantes"} hoje`}</span>` : ""}</div>`
    : "";

  const saved = s.data.stories.length
    ? `<div class="story-saved"><span class="eyebrow">Suas historinhas</span>
        <ul>${s.data.stories
          .map((x) => `<li><button data-act="story-pick" data-id="${esc(x.id)}" aria-current="${x.id === story?.id && !st.loading}">
            <span lang="en">${esc(x.title)}</span><span class="mono">${dateLabel(x.date)}</span></button></li>`)
          .join("")}</ul>
        <p class="story-hint">As últimas ${MAX_SAVED_STORIES} ficam guardadas e abrem até sem internet.</p></div>`
    : "";

  return `<div class="page story">
    <div class="wrap evo-top"><button class="link-btn subtle" data-act="story-close">${ui.back}Voltar</button></div>
    <section class="on-dark story-hero"><div class="wrap">
      <div class="hero-meta mono"><span>${st.loading ? `<i class="live"></i>` : ""}Historinha</span><span>${story && !st.loading ? dateLabel(story.date) : "Com suas frases"}</span></div>
      ${hero}
    </div></section>
    <section class="band"><div class="wrap story-body">
      ${st.error ? `<p class="story-err" role="alert">${esc(st.error)}</p>` : ""}
      ${lines}
      ${again}
      ${saved}
    </div></section>
  </div>`;
}
