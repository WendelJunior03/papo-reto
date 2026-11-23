/**
 * Aba Música: busca no YouTube, player e o jogo de completar a letra (treino de ouvido).
 * O player não pode ser redesenhado (a música pararia): a tela tem um esqueleto fixo e
 * partes que mudam (letra, opções, placar) atualizadas separadamente.
 */
import { esc } from "../lib/html";
import { tokenize, type Level } from "../lib/lyrics";
import { ui } from "../icons";
import type { AppState } from "../state";

const LEVELS: [Level, string, string][] = [
  ["facil", "Fácil", "1 lacuna a cada 3 linhas"],
  ["medio", "Médio", "1 a cada 2 linhas"],
  ["dificil", "Difícil", "1 por linha"],
];

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function searchScreen(s: AppState): string {
  const m = s.music;
  const results = m.results
    .map(
      (v) => `<button class="song" data-act="music-pick" data-id="${esc(v.id)}">
        <img src="${esc(v.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <span class="song-txt"><b>${esc(v.title)}</b><small>${esc(v.channel)}${v.duration ? ` · ${mmss(v.duration)}` : ""}</small></span>
      </button>`,
    )
    .join("");
  const recent = Object.entries(s.data.songs)
    .sort((a, b) => b[1].date.localeCompare(a[1].date))
    .slice(0, 5);
  return `<div class="page"><section class="band"><div class="wrap">
    <div class="sec-head"><span class="eyebrow">Música · treino de ouvido</span>
      <h2>Aprenda <span class="mark">cantando.</span></h2>
      <p>A música toca com a letra e algumas palavras somem. Na hora certa ela pausa: você escolhe a palavra que ouviu.</p></div>
    <form class="music-search" data-form="music-search">
      <input id="music-q" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off"
        placeholder="${s.musicSearch ? "Nome da música ou link do YouTube" : "Cole o link do vídeo do YouTube"}" value="${esc(m.query)}">
      <button class="btn btn-ultra" type="submit" ${m.loading ? "disabled" : ""}>${m.loading ? "…" : s.musicSearch ? "Buscar" : "Abrir"}</button>
    </form>
    ${s.musicSearch ? "" : `<p class="music-hint">Pesquise no YouTube, toque em <b>Compartilhar → Copiar link</b> e cole aqui. (A busca dentro do app liga quando a chave do YouTube for configurada.)</p>`}
    <div class="tabs-mode levels" role="group" aria-label="Nível">
      ${LEVELS.map(([k, label, hint]) => `<button class="tab" data-act="music-level" data-level="${k}" aria-pressed="${m.level === k}" title="${hint}">${label}</button>`).join("")}
    </div>
    ${m.error ? `<p class="dl-err">${esc(m.error)}</p>` : ""}
    ${results ? `<div class="songs">${results}</div>` : ""}
    ${
      !results && recent.length
        ? `<div class="evo-card"><div class="evo-head"><span class="eyebrow">Suas músicas</span></div>
            <ul class="recent-songs">${recent
              .map(([id, sg]) => `<li><button class="link-btn" data-act="music-pick-recent" data-id="${esc(id)}">${esc(sg.title)}</button><span class="mono">${sg.best}/${sg.total}</span></li>`)
              .join("")}</ul></div>`
        : ""
    }
    <p class="music-credit">Letras sincronizadas do <a href="https://lrclib.net" target="_blank" rel="noopener">LRCLIB</a>. Vídeos do YouTube.</p>
  </div></section></div>`;
}

/** Linhas perto da atual, com a lacuna (ou a resposta) no lugar da palavra. */
export function lyricsHtml(s: AppState): string {
  const m = s.music;
  if (!m.lines.length) return `<p class="lyr-empty">Carregando a letra…</p>`;
  const cur = Math.max(m.line, -1);
  const from = Math.max(0, cur - 1);
  const to = Math.min(m.lines.length, cur + 3);
  const rows: string[] = [];
  if (cur < 0) rows.push(`<p class="lyr next">♪ A letra começa em ${mmss(m.lines[0]!.t + m.offset)}…</p>`);
  for (let i = from; i < Math.max(to, 1); i++) {
    const line = m.lines[i]!;
    const blank = m.blanks.find((b) => b.line === i);
    const ans = m.answers[i];
    const words = tokenize(line.text)
      .map((t, wi) => {
        if (!blank || wi !== blank.word) return esc(`${t.before}${t.word}${t.after}`);
        const inner = ans ? `<span class="${ans.ok ? "hit" : "miss"}">${esc(blank.answer)}</span>` : `<span class="gap">${"_".repeat(Math.max(4, blank.answer.length))}</span>`;
        return `${esc(t.before)}${inner}${esc(t.after)}`;
      })
      .join(" ");
    rows.push(`<p class="lyr ${i === cur ? "now" : i < cur ? "past" : "next"}" lang="en">${words}</p>`);
  }
  return rows.join("");
}

export function optionsHtml(s: AppState): string {
  const m = s.music;
  const b = m.pending;
  if (!b) {
    const last = Object.entries(m.answers).at(-1);
    if (last && !last[1].ok) {
      const blank = m.blanks.find((x) => x.line === Number(last[0]));
      return blank
        ? `<div class="mus-feedback"><span class="st at">Era “${esc(blank.answer)}”</span>
            <button class="dl-play" data-act="music-say" data-word="${esc(blank.answer)}">${ui.play}Ouvir a palavra</button>
            <button class="dl-play ghost" data-act="music-replay" data-line="${last[0]}">${ui.flip}Repetir trecho</button>
            ${m.paused ? `<button class="btn btn-am btn-sm" data-act="music-continue">Continuar ${ui.arrow}</button>` : ""}</div>`
        : "";
    }
    return "";
  }
  return `<div class="mus-question">
    <span class="eyebrow">Que palavra você ouviu?</span>
    <div class="mus-options">${b.options.map((o) => `<button class="btn btn-ghost btn-lg" data-act="music-answer" data-word="${esc(o)}">${esc(o)}</button>`).join("")}</div>
    <button class="link-btn subtle" data-act="music-replay" data-line="${b.line}">${ui.flip} Ouvir o trecho de novo</button>
  </div>`;
}

export function scoreHtml(s: AppState): string {
  const m = s.music;
  const done = Object.values(m.answers);
  const hits = done.filter((a) => a.ok).length;
  return `<span class="st ok">${hits} acertos</span><span class="mono">${done.length}/${m.blanks.length} lacunas</span>`;
}

export function syncHtml(s: AppState): string {
  const m = s.music;
  const other = m.lyrics?.candidates.filter((c) => c.id !== m.lyrics?.chosen.id) ?? [];
  return `<details class="mus-sync">
    <summary>Letra fora de sincronia?</summary>
    <div class="sync-row">
      <button class="btn btn-ghost btn-sm" data-act="music-offset" data-delta="-0.5">Letra mais cedo</button>
      <span class="mono">${m.offset >= 0 ? "+" : ""}${m.offset.toFixed(1)} s</span>
      <button class="btn btn-ghost btn-sm" data-act="music-offset" data-delta="0.5">Letra mais tarde</button>
    </div>
    <button class="btn btn-ghost btn-sm" data-act="music-mark">Marcar: a primeira linha começa agora</button>
    ${
      other.length
        ? `<label class="field"><span>Outra versão da letra</span>
            <select id="music-lyrics" data-act-change="music-lyrics">${[m.lyrics!.chosen, ...other]
              .map((c) => `<option value="${c.id}">${esc(c.track)} — ${esc(c.artist)} (${mmss(c.duration)})</option>`)
              .join("")}</select></label>`
        : ""
    }
  </details>`;
}

function playerScreen(s: AppState): string {
  const m = s.music;
  const v = m.video!;
  return `<div class="page"><section class="band"><div class="wrap music-play">
    <button class="link-btn subtle mus-back" data-act="music-back">${ui.back} Outra música</button>
    <div class="yt-box"><div id="yt-player"></div></div>
    <div class="mus-head"><b>${esc(v.title)}</b><span id="mus-score" class="mus-score">${scoreHtml(s)}</span></div>
    <div id="mus-err">${errorHtml(s)}</div>
    <div id="mus-lyrics" class="mus-lyrics" aria-live="polite">${lyricsHtml(s)}</div>
    <div id="mus-options">${optionsHtml(s)}</div>
    <div id="mus-end">${endHtml(s)}</div>
    <div id="mus-sync">${syncHtml(s)}</div>
    <p class="music-credit">Letra: ${m.lyrics ? `${esc(m.lyrics.chosen.track)} — ${esc(m.lyrics.chosen.artist)}, via <a href="https://lrclib.net" target="_blank" rel="noopener">LRCLIB</a>` : "LRCLIB"}</p>
  </div></section></div>`;
}

export const errorHtml = (s: AppState): string => (s.music.error ? `<p class="dl-err">${esc(s.music.error)}</p>` : "");

export function endHtml(s: AppState): string {
  const m = s.music;
  if (!m.ended) return "";
  const hits = Object.values(m.answers).filter((a) => a.ok).length;
  return `<div class="done">
    <div class="ok-ic">${ui.tick}</div>
    <span class="eyebrow">Música concluída</span>
    <div class="score">${hits}<span>/${m.blanks.length}</span></div>
    <p>${hits === m.blanks.length ? "Ouvido afiado! Tenta o nível acima." : "Ouça de novo: na segunda vez as palavras aparecem sozinhas."}</p>
    <div class="btnrow">
      <button class="btn btn-ghost btn-lg" data-act="music-restart">${ui.flip}De novo</button>
      <button class="btn btn-am btn-lg" data-act="music-back">Outra música</button>
    </div>
  </div>`;
}

export const renderMusic = (s: AppState): string => (s.music.video ? playerScreen(s) : searchScreen(s));
