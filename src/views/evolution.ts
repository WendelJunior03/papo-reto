/**
 * "Sua evolução": progresso em três camadas — o dia (semana e constância), o médio
 * (memória e situações) e o grande (frases dominadas e a nota da fala nos diálogos).
 * Gráficos em SVG puro, uma escala de azul (claro = pouco, escuro = muito).
 */
import { findPhrase, packs } from "../data";
import { parseKey } from "../lib/dates";
import { esc, highlight } from "../lib/html";
import { isKnown } from "../lib/srs";
import {
  badges, daysThisMonth, heatmap, knownSeries, levelFor, listeningSummary, listenSeries, longestStreak, MEMORY,
  memoryBuckets, songProgress, spokenSeries, weekSummary, type Point, type SongProgress,
} from "../lib/stats";
import { ui } from "../icons";
import { knownCount, knownInPack, streakDays, type AppState } from "../state";
import { seloRow } from "./badges";

/** Escala sequencial (do mais claro ao mais escuro). */
const SEQ = ["#CFE5F8", "#8FC4EC", "#4EA0E0", "#2A7FCB", "#175FAE"];
const EMPTY = "#EAF0F6";

const fmtDay = (d: string): string => parseKey(d).toLocaleDateString("pt-BR", { day: "numeric", month: "short" }).replace(".", "");
const pct = (v: number): string => `${Math.round(v * 100)}%`;

function delta(now: number | null, before: number | null, unit = "", asPct = false): string {
  if (now === null || before === null) return "";
  const d = asPct ? Math.round((now - before) * 100) : now - before;
  if (d === 0) return `<span class="delta">= semana passada</span>`;
  const up = d > 0;
  return `<span class="delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(d)}${asPct ? " pts" : unit} vs semana passada</span>`;
}

/* ---------- gráfico de linha (uma série) ---------- */
export function lineChart(
  points: Point[],
  opts: { max: number; fmt: (v: number) => string; label: string; one?: string; target?: { value: number; label: string } },
): string {
  const W = 320, H = 150, L = 34, R = 10, T = 12, B = 24;
  const iw = W - L - R, ih = H - T - B;
  const x = (i: number) => L + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => T + ih - (v / opts.max) * ih;
  const ticks = [0, opts.max / 2, opts.max];
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)} ${T + ih}L${x(0).toFixed(1)} ${T + ih}Z`;
  const last = points[points.length - 1]!;
  const step = points.length > 1 ? iw / (points.length - 1) : iw;
  const hits = points
    .map((p, i) => `<rect class="hit" x="${(x(i) - step / 2).toFixed(1)}" y="${T}" width="${step.toFixed(1)}" height="${ih}"
      data-tip="${esc(`${fmtDay(p.date)} · ${opts.fmt(p.value)} ${p.value === 1 ? (opts.one ?? opts.label.replace(/s$/, "")) : opts.label}`)}" data-cx="${x(i).toFixed(1)}" data-cy="${y(p.value).toFixed(1)}"/>`)
    .join("");
  const xLabels = [0, Math.floor((points.length - 1) / 2), points.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}">${fmtDay(points[i]!.date)}</text>`)
    .join("");
  return `<div class="chart" data-chart>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)} ao longo do tempo">
      ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="ylab" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${opts.fmt(t)}</text>`).join("")}
      ${points.length > 1 ? `<path class="area" d="${area}"/>` : ""}
      ${opts.target ? `<line class="target" x1="${L}" x2="${W - R}" y1="${y(opts.target.value)}" y2="${y(opts.target.value)}"/><text class="tlab" x="${L + 4}" y="${y(opts.target.value) - 5}">${esc(opts.target.label)}</text>` : ""}
      ${points.length > 1 ? `<path class="line" d="${line}"/>` : ""}
      ${points.length <= 12 ? points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.value)}" r="3.5"/>`).join("") : ""}
      <circle class="end" cx="${x(points.length - 1)}" cy="${y(last.value)}" r="5"/>
      ${xLabels}
      <line class="cross" x1="0" x2="0" y1="${T}" y2="${T + ih}" visibility="hidden"/>
      <circle class="focus" r="5" visibility="hidden"/>
      ${hits}
    </svg>
    <div class="tip" hidden></div>
  </div>`;
}

const LEVEL_NAME: Record<string, string> = { facil: "fácil", medio: "médio", dificil: "difícil" };

/** Uma música: régua 0–100% com a primeira tentativa (claro) e a última (escuro). */
function songRow(p: SongProgress): string {
  const x = (v: number) => (8 + v * 384).toFixed(1);
  const diff = Math.round((p.last - p.first) * 100);
  const trend = p.attempts < 2 ? `<span class="delta">1 tentativa</span>` : diff === 0 ? `<span class="delta">= primeira vez</span>` : `<span class="delta ${diff > 0 ? "up" : "down"}">${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)} pts</span>`;
  return `<li>
    <div class="ear-top"><b>${esc(p.title)}</b>${trend}</div>
    <div class="chart ear-chart" data-chart>
      <svg viewBox="0 0 400 22" role="img" aria-label="${esc(`${p.title}: primeira ${pct(p.first)}, última ${pct(p.last)}, melhor ${pct(p.best)}`)}">
        <line class="grid" x1="8" x2="392" y1="11" y2="11"/>
        ${p.attempts > 1 ? `<line class="ear-link" x1="${x(p.first)}" x2="${x(p.last)}" y1="11" y2="11"/>` : ""}
        ${p.attempts > 1 ? `<circle class="ear-first" cx="${x(p.first)}" cy="11" r="5" data-tip="Primeira vez: ${pct(p.first)}"/>` : ""}
        <circle class="ear-last" cx="${x(p.last)}" cy="11" r="6" data-tip="Última: ${pct(p.last)} (nível ${LEVEL_NAME[p.lastLevel] ?? p.lastLevel})"/>
      </svg>
      <div class="tip" hidden></div>
    </div>
    <small>${p.attempts > 1 ? `1ª vez ${pct(p.first)} → última ${pct(p.last)} · ` : `${pct(p.last)} · `}melhor ${pct(p.best)} · ${p.attempts} ${p.attempts === 1 ? "tentativa" : "tentativas"} · nível ${LEVEL_NAME[p.lastLevel] ?? p.lastLevel}</small>
  </li>`;
}

export function renderEvolution(s: AppState): string {
  const d = s.data;
  const known = knownCount(s);
  const level = levelFor(known);
  const week = weekSummary(d, s.today);
  const streak = streakDays(s);
  const best = Math.max(longestStreak(d.visits), streak);
  const month = daysThisMonth(d.visits, s.today);
  const studyDays = new Set(d.visits).size;

  /* nível */
  const hero = `<section class="evo-hero on-dark"><div class="wrap">
    <span class="eyebrow">Nível ${level.index} de 6</span>
    <div class="evo-big"><b>${known}</b><span>frases que você domina</span></div>
    <h2>${esc(level.name)}</h2>
    <div class="meter" role="img" aria-label="${pct(level.progress)} até o próximo nível"><i style="width:${(level.progress * 100).toFixed(1)}%"></i></div>
    <p class="evo-next">${level.next ? `Faltam <b>${level.missing}</b> frases pra <b>${esc(level.next.name)}</b>.` : "Você dominou todo o conteúdo!"}</p>
    <p class="evo-note">Nível baseado nas expressões que você domina no app — não é certificado.</p>
  </div></section>`;

  /* semana */
  const weekCard = `<div class="evo-card">
    <div class="evo-head"><span class="eyebrow">Últimos 7 dias</span></div>
    <div class="tiles">
      <div class="tile-s"><span class="lab">Dias estudados</span><b>${week.now.days}<small>/7</small></b>${delta(week.now.days, week.before.days, week.now.days - week.before.days === 1 || week.before.days - week.now.days === 1 ? " dia" : " dias")}</div>
      <div class="tile-s"><span class="lab">Frases novas</span><b>${week.now.learned}</b>${delta(week.now.learned, week.before.learned)}</div>
      <div class="tile-s"><span class="lab">Revisões</span><b>${week.now.reviews}</b>${delta(week.now.reviews, week.before.reviews)}</div>
      <div class="tile-s"><span class="lab">Nota da fala</span><b>${week.now.spoken === null ? "—" : pct(week.now.spoken)}</b>${delta(week.now.spoken, week.before.spoken, "", true) || (week.now.spoken === null ? `<span class="delta">faça um diálogo</span>` : "")}</div>
    </div>
  </div>`;

  /* constância */
  const cols = heatmap(d, s.today);
  const monthLabels = cols
    .map((col, i) => {
      const first = col.find((c) => c.date.endsWith("-01") || (i === 0 && c === col[0]));
      return first ? `<span style="grid-column:${i + 1}">${parseKey(first.date).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span>` : "";
    })
    .join("");
  const cells = cols
    .map(
      (col) =>
        `<div class="hm-col">${col
          .map(
            (c) =>
              `<i class="${c.future ? "fut" : ""}" style="background:${c.future ? "transparent" : c.level ? SEQ[c.level]! : EMPTY}"
                data-tip="${esc(c.future ? "" : `${fmtDay(c.date)} · ${c.level ? `${c.actions} atividade${c.actions === 1 ? "" : "s"}` : "sem estudo"}`)}"></i>`,
          )
          .join("")}</div>`,
    )
    .join("");
  const habit = `<div class="evo-card">
    <div class="evo-head"><span class="eyebrow">Constância</span><span class="mono">16 semanas</span></div>
    <div class="streaks">
      <div><b>${month}</b><span>dias neste mês</span></div>
      <div><b>${streak}</b><span>dias seguidos</span></div>
      <div><b>${best}</b><span>maior sequência</span></div>
    </div>
    <div class="chart heat" data-chart>
      <div class="hm-months" style="grid-template-columns:repeat(${cols.length},1fr)">${monthLabels}</div>
      <div class="hm" role="img" aria-label="${studyDays} dias de estudo nas últimas 16 semanas">${cells}</div>
      <div class="tip" hidden></div>
    </div>
    <div class="hm-legend"><span>menos</span>${[EMPTY, ...SEQ.slice(1)].map((c) => `<i style="background:${c}"></i>`).join("")}<span>mais</span></div>
    <p class="evo-hint">O que conta é voltar sempre — perder um dia não apaga nada do que você aprendeu.</p>
  </div>`;

  /* memória */
  const buckets = memoryBuckets(d.progress);
  const studied = buckets.reduce((a, b) => a + b, 0);
  const total = packs.length * 5;
  const memory = `<div class="evo-card">
    <div class="evo-head"><span class="eyebrow">Força da memória</span><span class="mono">${studied} de ${total} frases vistas</span></div>
    ${
      studied
        ? `<div class="stack" role="img" aria-label="Distribuição da memória">${buckets
            .map((n, i) => (n ? `<i style="flex:${n};background:${SEQ[i]!}" data-tip="${MEMORY[i]!.label}: ${n}"></i>` : ""))
            .join("")}</div>
          <ul class="mem-legend">${MEMORY.map(
            (m, i) => `<li><i style="background:${SEQ[i]!}"></i><span>${m.label}<small>${m.hint}</small></span><b>${buckets[i]}</b></li>`,
          ).join("")}</ul>
          <p class="evo-hint">Cada acerto no treino empurra a frase pra direita: ela volta cada vez mais espaçada, até ficar na memória de longo prazo.</p>`
        : `<p class="evo-empty">Marque frases como “Sei essa” ou faça o treino pra começar.</p>`
    }
  </div>`;

  /* frases dominadas no tempo */
  const series = knownSeries(d, s.today, 30);
  const maxKnown = Math.max(10, Math.ceil(Math.max(...series.map((p) => p.value)) / 10) * 10);
  const growth = `<div class="evo-card">
    <div class="evo-head"><span class="eyebrow">Frases dominadas</span><span class="mono">30 dias</span></div>
    ${lineChart(series, { max: maxKnown, fmt: (v) => String(Math.round(v)), label: "frases" })}
  </div>`;

  /* fala */
  const spoken = spokenSeries(d, s.today, 60);
  const speak = `<div class="evo-card">
    <div class="evo-head"><span class="eyebrow">Sua fala nos diálogos</span><span class="mono">média por dia</span></div>
    ${
      spoken.length >= 2
        ? `${lineChart(spoken, { max: 1, fmt: pct, label: "de acerto", target: { value: 0.7, label: "boa fala" } })}
           <p class="evo-hint">De ${pct(spoken[0]!.value)} no primeiro dia pra ${pct(spoken[spoken.length - 1]!.value)} no último. É a medida mais próxima de como você fala de verdade.</p>`
        : `<p class="evo-empty">${spoken.length ? `Primeiro dia: ${pct(spoken[0]!.value)}. Faça diálogos em outros dias pra ver a linha da sua evolução.` : "Faça diálogos falando em voz alta pra acompanhar como sua fala melhora."}</p>
           <button class="btn btn-am" data-act="goto-dialogo">${ui.mic}Fazer um diálogo</button>`
    }
  </div>`;

  /* ouvido (música) */
  const ls = listeningSummary(d, s.today);
  const lseries = listenSeries(d, s.today, 60);
  const prog = songProgress(d);
  const ear = `<div class="evo-card">
    <div class="evo-head"><span class="eyebrow">Seu ouvido · Música</span><span class="mono">${ls.songs} ${ls.songs === 1 ? "música" : "músicas"}</span></div>
    ${
      ls.answered
        ? `<div class="tiles">
            <div class="tile-s"><span class="lab">Acerto geral</span><b>${pct(ls.pct!)}</b><span class="delta">${ls.hits} de ${ls.answered} lacunas</span></div>
            <div class="tile-s"><span class="lab">Últimos 7 dias</span><b>${ls.now.pct === null ? "—" : pct(ls.now.pct)}</b>${delta(ls.now.pct, ls.before.pct, "", true) || `<span class="delta">${ls.now.answered} lacunas</span>`}</div>
          </div>
          ${
            lseries.length >= 2
              ? lineChart(lseries, { max: 1, fmt: pct, label: "de acerto", target: { value: 0.8, label: "ouvido afiado" } })
              : `<p class="evo-hint">Treine em outros dias pra ver a linha da sua evolução no ouvido.</p>`
          }
          ${prog.length ? `<span class="mono ear-sub">Primeira vez → última, por música</span><ul class="ear-songs">${prog.slice(0, 8).map(songRow).join("")}</ul>` : ""}
          <p class="evo-hint">Repetir a mesma música é o que treina o ouvido: na segunda e na terceira vez as palavras começam a aparecer sozinhas.</p>`
        : `<p class="evo-empty">Faça o treino de ouvido na aba Música pra acompanhar quanto você entende das letras.</p>
           <button class="btn btn-am" data-act="goto-musica">Treinar com música</button>`
    }
  </div>`;

  /* conquistas */
  const packsDone = packs.filter((_, i) => knownInPack(s, i) === 5).length;
  const dialogueScores = Object.values(d.dialogues);
  const aiMsgs = Object.values(d.history).reduce((n, h) => n + h.ai, 0);
  const list = badges({
    known, studyDays, packsDone, dialogues: dialogueScores.length, perfect: dialogueScores.some((x) => x.best >= 0.999), aiMsgs,
    songs: prog.length, bestSong: Math.max(0, ...prog.map((p) => p.best)),
  });
  const earned = list.filter((b) => b.done).length;
  const badgeCard = `<div class="evo-card">
    <div class="evo-head"><span class="eyebrow">Conquistas</span><span class="mono">${earned} de ${list.length}</span></div>
    <div class="badges">${list
      .map(
        (b) => `<div class="badge ${b.done ? "on" : ""}">
          <span class="b-ic">${b.done ? ui.tick : ui.lock}</span>
          <b>${esc(b.title)}</b><small>${esc(b.done ? b.desc : b.left ?? b.desc)}</small>
        </div>`,
      )
      .join("")}</div>
  </div>`;

  /* coleção */
  const recent = Object.entries(d.progress)
    .filter(([, c]) => isKnown(c) && c.at)
    .sort((a, b) => b[1].at!.localeCompare(a[1].at!))
    .slice(0, 8)
    .map(([id, c]) => ({ id, c, p: findPhrase(id) }))
    .filter((x) => x.p);
  const weak = Object.entries(d.progress).filter(([, c]) => c.box === 0).length;
  const collection = `<div class="evo-card">
    <div class="evo-head"><span class="eyebrow">Sua coleção</span><span class="mono">últimas dominadas</span></div>
    ${
      recent.length
        ? `<ul class="collection">${recent
            .map(
              ({ id, c, p }) => `<li><button class="ex-play" data-act="say" data-id="${id}" aria-label="Ouvir">${ui.play}</button>
                <div><p lang="en">${highlight(p!.en)}</p><small>${esc(p!.pt)} · ${fmtDay(c.at!)}</small></div></li>`,
            )
            .join("")}</ul>`
        : `<p class="evo-empty">As expressões que você dominar aparecem aqui.</p>`
    }
    ${weak ? `<button class="review" data-act="goto-treino"><span class="st at">${weak} pra revisar</span><span class="txt">Frases que escaparam no último treino.</span>${ui.arrow}</button>` : ""}
  </div>`;

  return `<div class="page evo">
    <div class="wrap evo-top"><button class="link-btn subtle" data-act="goto-hoje">${ui.back}Voltar</button></div>
    ${hero}
    <section class="band"><div class="wrap evo-grid">
      ${weekCard}${habit}${memory}${growth}${speak}${ear}${badgeCard}${seloRow(s)}${collection}
    </div></section>
  </div>`;
}
