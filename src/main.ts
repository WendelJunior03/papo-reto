import "./styles.css";
import { findPhrase } from "./data";
import { esc } from "./lib/html";
import { play, playSequence, speakTts, stop as stopAudio } from "./lib/speech";
import { cancelListening, listen, looksPortuguese, PORTUGUESE_HELP } from "./lib/listen";
import { bestOf } from "./lib/match";
import { plain } from "./lib/html";
import { packs } from "./data";
import { audioFile } from "./lib/spoken";
import { buildReminderICS, downloadReminder } from "./lib/reminder";
import { ui } from "./icons";
import {
  answer, createState, currentPack, ensurePractice, goToPack, knownCount, knownInPack, persist,
  startPractice, streakDays, toggleKnown, type PracticeMode, type Tab,
  advanceDialogue, dialogueTurnIndex, ensureAi, ensureDialogue, recordTurn, startDialogue,
  setPersistListener, type AppState, nudgeSupport, dialogueDone, dialogueScore, track, emptyMusic, type MusicVideo,
  openDailySupport, markSupported, aiLocked,
} from "./state";
import { api, ApiError } from "./lib/api";
import { mergeData } from "./lib/merge";
import { lastUser, load, loadPix, save, saveAiKey, savePix, setLastUser } from "./lib/storage";
import { pixPayload, type PixConfig } from "./lib/pix";
import { supportNudge, supportSheet } from "./views/support";
import { providerFor } from "./lib/provider";
import { renderAuth, type AuthView } from "./views/auth";
import { renderDialogue } from "./views/dialogue";
import { renderAi } from "./views/ai";
import { renderEvolution } from "./views/evolution";
import { endHtml, errorHtml, lyricsHtml, optionsHtml, renderMusic, scoreHtml, syncHtml } from "./views/music";
import { cleanTitle, lineAt, makeBlanks, parseLrc } from "./lib/lyrics";
import { loadYouTube, YT_ERRORS, type YTPlayer } from "./lib/youtube";
import { renderToday } from "./views/today";
import { renderPractice } from "./views/practice";
import { renderSituations } from "./views/situations";

let s!: AppState;
const app = document.getElementById("app")!;
const stats = document.getElementById("stats")!;
const toastEl = document.getElementById("toast")!;
const installBtn = document.getElementById("install") as HTMLButtonElement;
const sheet = document.getElementById("sheet")!;

/** Copia pro clipboard; se o navegador não deixar, seleciona o texto pra copiar na mão. */
async function copy(text: string, ok: string, fallbackId?: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok, true);
  } catch {
    const el = fallbackId ? (document.getElementById(fallbackId) as HTMLInputElement | null) : null;
    el?.select();
    toast("Selecionei o código — copie com segurar e Copiar");
  }
}

/** Lembrete de apoio ao cruzar 50, 100, 150… frases dominadas. */
function checkKnownMilestone(before: number): void {
  const after = knownCount(s);
  if (Math.floor(after / 50) > Math.floor(before / 50)) nudgeSupport(s, `Você já domina ${Math.floor(after / 50) * 50} frases!`);
}

/* ---------- login ---------- */
const auth: AuthView = { mode: "login", error: null, busy: false, username: "" };

function renderAuthScreen(): void {
  document.body.classList.add("auth");
  app.innerHTML = renderAuth(auth);
  const cv = document.getElementById("dots");
  if (cv instanceof HTMLCanvasElement) drawDots(cv, 3);
  document.getElementById(auth.username ? "auth-pass" : "auth-user")?.focus();
}

async function submitAuth(form: HTMLFormElement): Promise<void> {
  const f = new FormData(form);
  const username = String(f.get("username") ?? "").trim();
  const password = String(f.get("password") ?? "");
  auth.username = username;
  if (!username || !password) {
    auth.error = "Preencha usuário e senha.";
    return renderAuthScreen();
  }
  auth.busy = true;
  auth.error = null;
  renderAuthScreen();
  try {
    const res =
      auth.mode === "signup"
        ? await api.signup(username, password, String(f.get("code") ?? ""))
        : await api.login(username, password);
    auth.busy = false;
    const me = await api.me().catch(() => ({ serverAi: false, pix: null, push: false, musicSearch: false }));
    musicSearchOn = !!me.musicSearch;
    await start(res.username, true, me.serverAi, me.pix, !!me.push);
  } catch (e) {
    auth.busy = false;
    auth.error = e instanceof ApiError ? e.message : "Não foi possível entrar.";
    renderAuthScreen();
  }
}

async function logout(): Promise<void> {
  clearTimeout(pushTimer);
  if (dirty) await pushNow();
  await api.logout().catch(() => {});
  setLastUser(null);
  cancelListening();
  stopAudio();
  auth.mode = "login";
  auth.error = null;
  auth.username = s.user;
  renderAuthScreen();
}

/* ---------- sincronização do progresso ---------- */
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

async function pushNow(): Promise<void> {
  try {
    await api.putProgress(s.data);
    dirty = false;
  } catch (e) {
    dirty = true;
    if (e instanceof ApiError && e.status === 401) {
      auth.error = "Sua sessão expirou. Entre de novo — seu progresso neste aparelho está guardado.";
      auth.username = s.user;
      renderAuthScreen();
    }
  }
}

setPersistListener(() => {
  dirty = true;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void pushNow(), 1500);
});
window.addEventListener("online", () => {
  if (dirty && s) void pushNow();
});

/** Entra no app como `user`: junta o progresso do aparelho com o da conta e desenha. */
let musicSearchOn = false;
async function start(user: string, online = true, serverAi = false, pix: PixConfig | null = loadPix(), push = false): Promise<void> {
  setLastUser(user);
  if (online) savePix(pix);
  document.body.classList.remove("auth");
  s = createState(user, new Date(), undefined, serverAi, pix);
  s.canInstall = installEvent !== null;
  s.pushAvailable = push;
  render();
  if (!online) return;
  try {
    const remote = await api.getProgress();
    const merged = mergeData(load(user), remote.data);
    s = createState(user, new Date(), merged, serverAi, pix);
    s.canInstall = installEvent !== null;
    s.pushAvailable = push;
    s.musicSearch = musicSearchOn;
    void checkPushOn();
    if (s.tab === "ia") void refreshAiSession();
    save(user, merged);
    // Primeira abertura do dia: janela do PIX (pra quem ainda não apoiou).
    openDailySupport(s);
    render();
    await pushNow();
  } catch {
    dirty = true; // sem conexão: sobe quando voltar
  }
}

async function boot(): Promise<void> {
  try {
    const me = await api.me();
    musicSearchOn = !!me.musicSearch;
    await start(me.username, true, me.serverAi, me.pix, !!me.push);
  } catch (e) {
    const cached = lastUser();
    if (e instanceof ApiError && e.status === 0 && cached) {
      // Offline: quem já entrou neste aparelho continua usando.
      await start(cached, false);
    } else {
      auth.username = cached ?? "";
      renderAuthScreen();
    }
  }
}

/* ---------- render ---------- */
function render(): void {
  const days = streakDays(s);
  stats.innerHTML = `<button class="stats-btn" data-act="goto-evolucao" aria-label="Ver sua evolução">
    <span class="st at">${days} ${days === 1 ? "dia" : "dias"}</span><span class="st ok">${knownCount(s)}</span>${ui.chart}</button>`;
  if (s.tab === "dialogo") ensureDialogue(s);
  // Música tocando: só atualiza as partes que mudam (redesenhar pararia o player).
  if (s.tab === "musica" && s.music.video && player && document.getElementById("yt-player")) {
    updateMusicParts();
    document.querySelectorAll<HTMLButtonElement>("nav.tabbar button").forEach((b) =>
      b.setAttribute("aria-selected", String(b.dataset.tab === s.tab)),
    );
    sheet.innerHTML = supportSheet(s) + supportNudge(s);
    return;
  }
  app.innerHTML =
    s.tab === "hoje" ? renderToday(s)
    : s.tab === "dialogo" ? renderDialogue(s)
    : s.tab === "ia" ? renderAi(s)
    : s.tab === "treino" ? renderPractice(s)
    : s.tab === "evolucao" ? renderEvolution(s)
    : s.tab === "musica" ? renderMusic(s)
    : renderSituations(s);
  document.querySelectorAll<HTMLButtonElement>("nav.tabbar button").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.tab === s.tab)),
  );
  installBtn.hidden = !s.canInstall;
  const cv = document.getElementById("dots");
  if (cv instanceof HTMLCanvasElement) drawDots(cv, s.packIndex);
  sheet.innerHTML = supportSheet(s) + supportNudge(s);
  document.body.classList.toggle("sheet-open", s.support.open);
  cachePackAudio();
  if (s.tab === "musica" && s.music.video) void mountPlayer();
}

/* ---------- música ---------- */
let player: YTPlayer | null = null;
let musicLoop: ReturnType<typeof setInterval> | undefined;
let resumeAt = 0;

function updateMusicParts(): void {
  const set = (id: string, html: string) => {
    const el = document.getElementById(id);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  };
  set("mus-lyrics", lyricsHtml(s));
  set("mus-options", optionsHtml(s));
  set("mus-score", scoreHtml(s));
  set("mus-end", endHtml(s));
  set("mus-err", errorHtml(s));
  // o painel de sincronia só é refeito quando muda o ajuste (pra não fechar o <details>)
  const sync = document.getElementById("mus-sync");
  const off = sync?.querySelector(".sync-row .mono")?.textContent;
  if (sync && off !== `${s.music.offset >= 0 ? "+" : ""}${s.music.offset.toFixed(1)} s`) {
    const open = sync.querySelector("details")?.open;
    sync.innerHTML = syncHtml(s);
    if (open) sync.querySelector("details")?.setAttribute("open", "");
  }
}

function destroyPlayer(): void {
  clearInterval(musicLoop);
  musicLoop = undefined;
  if (player) {
    try {
      resumeAt = player.getCurrentTime();
      player.destroy();
    } catch {
      // player ainda não estava pronto
    }
  }
  player = null;
}

async function mountPlayer(): Promise<void> {
  const v = s.music.video;
  if (!v || player || !document.getElementById("yt-player")) return;
  try {
    const YT = await loadYouTube();
    if (s.tab !== "musica" || s.music.video?.id !== v.id || player) return;
    player = new YT.Player("yt-player", {
      videoId: v.id,
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(resumeAt) },
      events: {
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED) finishSong();
        },
        onError: (e) => {
          s.music.error = YT_ERRORS[e.data] ?? "O vídeo não pôde ser tocado.";
          render();
        },
      },
    });
    clearInterval(musicLoop);
    musicLoop = setInterval(musicTick, 200);
  } catch (e) {
    s.music.error = e instanceof Error ? e.message : "Não deu pra carregar o player.";
    render();
  }
}

/** Acompanha a música: muda a linha, e pausa no fim da linha que tem lacuna sem resposta. */
function musicTick(): void {
  const m = s.music;
  if (!player || !m.lines.length || m.pending || m.paused || typeof player.getCurrentTime !== "function") return;
  const t = player.getCurrentTime() - m.offset;
  const idx = lineAt(m.lines, t);
  const prev = m.line;
  if (idx !== m.line) {
    m.line = idx;
    updateMusicParts();
  }
  if (idx < 0) return;
  const ask = (blank: (typeof m.blanks)[number]) => {
    player!.pauseVideo();
    m.pending = blank;
    updateMusicParts();
  };
  // Passou pra linha seguinte sem pausar (a checagem atrasou): pergunta a lacuna da anterior.
  if (idx === prev + 1 && prev >= 0) {
    const missed = m.blanks.find((b) => b.line === prev);
    if (missed && !m.answers[prev]) return ask(missed);
  }
  const blank = m.blanks.find((b) => b.line === idx);
  if (!blank || m.answers[idx]) return;
  const end = m.lines[idx + 1]?.t ?? m.lines[idx]!.t + 4;
  if (t >= end - 0.35) ask(blank);
}

function finishSong(): void {
  const m = s.music;
  if (m.ended || !m.video) return;
  m.ended = true;
  const hits = Object.values(m.answers).filter((a) => a.ok).length;
  const prev = s.data.songs[m.video.id];
  const attempt = { date: s.today, hits, total: m.blanks.length, level: m.level };
  const attempts = [...(prev?.attempts ?? []), attempt].slice(-30);
  const better = !prev || hits / (m.blanks.length || 1) >= prev.best / (prev.total || 1);
  s.data.songs[m.video.id] = better
    ? { title: m.video.title, best: hits, total: m.blanks.length, level: m.level, date: s.today, attempts }
    : { ...prev!, date: s.today, attempts };
  persist(s);
  updateMusicParts();
}

async function openVideo(v: MusicVideo): Promise<void> {
  destroyPlayer();
  resumeAt = 0;
  const keep = s.music;
  s.music = { ...emptyMusic(), query: keep.query, results: keep.results, level: keep.level, video: v };
  render();
  window.scrollTo(0, 0);
  // Letra: primeiro pelo título limpo; se não achar, título + canal.
  const tries = [cleanTitle(v.title), `${cleanTitle(v.title)} ${v.channel.replace(/\s*-\s*Topic$|VEVO$/i, "")}`];
  for (const q of tries) {
    try {
      const r = await fetch(`./api/music/lyrics?q=${encodeURIComponent(q)}&duration=${v.duration}`);
      const d = (await r.json()) as { lrc?: string; chosen?: never; candidates?: never; error?: string; notFound?: boolean };
      if (r.ok && d.lrc) return applyLyrics(d.lrc, d as never);
      if (!d.notFound) throw new Error(d.error);
    } catch (e) {
      s.music.error = e instanceof Error && e.message ? e.message : "Sem conexão pra buscar a letra.";
      return render();
    }
  }
  s.music.error = "Não achei a letra sincronizada dessa música. Tente outro vídeo (o oficial ou com letra) ou outra música.";
  render();
}

function applyLyrics(lrc: string, meta: { chosen: never; candidates?: never }): void {
  const m = s.music;
  m.lines = parseLrc(lrc);
  m.blanks = makeBlanks(m.lines, m.level, m.video!.id);
  m.lyrics = { chosen: meta.chosen, candidates: meta.candidates ?? m.lyrics?.candidates ?? [meta.chosen] };
  m.answers = {};
  m.pending = null;
  m.error = null;
  m.line = -1;
  updateMusicParts();
}

async function musicSearch(raw: string): Promise<void> {
  const m = s.music;
  const q = raw.trim();
  m.query = q;
  if (!q) return;
  m.loading = true;
  m.error = null;
  render();
  try {
    const isLink = /youtu\.?be|^[\w-]{11}$/.test(q);
    if (isLink || !s.musicSearch) {
      const r = await fetch(`./api/music/video?url=${encodeURIComponent(q)}`);
      const d = (await r.json()) as { video?: MusicVideo; error?: string };
      m.loading = false;
      if (!r.ok || !d.video) {
        m.error = !s.musicSearch && !isLink ? "Cole o link de um vídeo do YouTube (a busca por nome ainda não está ligada)." : (d.error ?? "Vídeo não encontrado.");
        return render();
      }
      return openVideo(d.video);
    }
    const r = await fetch(`./api/music/search?q=${encodeURIComponent(q)}`);
    const d = (await r.json()) as { videos?: MusicVideo[]; error?: string };
    m.loading = false;
    if (!r.ok) m.error = d.error ?? "Não deu pra buscar agora.";
    m.results = d.videos ?? [];
    if (r.ok && !m.results.length) m.error = "Nada encontrado. Tente o nome da música e do artista.";
  } catch {
    m.loading = false;
    m.error = "Sem conexão pra buscar agora.";
  }
  render();
}

/** Pede ao service worker pra guardar os áudios do pacote aberto (fica disponível offline). */
let cachedPack = -1;
function cachePackAudio(): void {
  if (!s) return; // ainda na tela de login
  const sw = navigator.serviceWorker?.controller;
  if (!sw || cachedPack === s.packIndex) return;
  cachedPack = s.packIndex;
  const pack = currentPack(s);
  const texts = [
    ...pack.phrases.flatMap((p) => [p.en, ...(p.examples ?? []).map((e) => e.en)]),
    ...pack.chat.map((c) => c.en),
  ];
  const base = new URL("./", location.href);
  sw.postMessage({ type: "cache-audio", urls: texts.map((t) => new URL(audioFile(t), base).href) });
}

/** Retícula de pontos da faixa noite — eco do mapa da identidade JMD. */
function drawDots(cv: HTMLCanvasElement, seed: number): void {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = 260;
  cv.width = cv.height = W * dpr;
  ctx.scale(dpr, dpr);
  for (let y = 6; y < W; y += 11) {
    for (let x = 6; x < W; x += 11) {
      const d = Math.hypot(x - W / 2, y - W / 2) / (W / 2);
      if (d > 1) continue;
      const hot = (x * 7 + y * 3 + seed * 13) % 23 === 0;
      ctx.fillStyle = hot ? "#FEF203" : `rgba(255,255,255,${0.6 - d * 0.45})`;
      ctx.beginPath();
      ctx.arc(x, y, hot ? 2.4 : 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, ok = false): void {
  toastEl.innerHTML = (ok ? ui.tick : "") + esc(msg);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 1800);
}

function setTab(tab: Tab): void {
  if (s.tab === "musica" && tab !== "musica") destroyPlayer();
  cancelListening();
  if (s.dialogue) s.dialogue.listening = false;
  stopAudio();
  s.tab = tab;
  history.replaceState(null, "", tab === "hoje" ? location.pathname : `#${tab}`);
  const revealed = tab === "dialogo" ? ensureDialogue(s) : [];
  if (tab === "ia") void refreshAiSession();
  render();
  window.scrollTo(0, 0);
  playLines(revealed);
}

/* ---------- diálogo guiado ---------- */
let stopListening: () => void = () => {};

/** Toca as falas da outra pessoa que acabaram de aparecer. */
function playLines(indexes: number[]): void {
  const chat = packs[s.dialogue?.packIndex ?? s.packIndex]!.chat;
  if (indexes.length) playSequence(indexes.map((i) => chat[i]!.en));
}

function scrollToEnd(): void {
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
}

function expectedLine(): string | null {
  const d = s.dialogue;
  const i = d && dialogueTurnIndex(d);
  return d && i !== null && i !== undefined ? packs[d.packIndex]!.chat[i]!.en : null;
}

function checkAnswer(alternatives: string[], spoken = true): void {
  const expected = expectedLine();
  const d = s.dialogue;
  if (!expected || !d) return;
  const { said, result } = bestOf(expected, alternatives);
  // Veio em português (teclado/ditado no idioma errado): explica em vez de dar nota.
  if (!result.pass && looksPortuguese(said)) {
    d.error = spoken ? PORTUGUESE_HELP : "Isso parece português — escreva a frase em inglês.";
    return render();
  }
  recordTurn(s, { said, result });
  render();
  scrollToEnd();
}

function toggleMic(): void {
  const d = s.dialogue;
  if (!d) return;
  // Tocar de novo enquanto ouve: encerra na hora e confere o que já foi dito.
  if (d.listening) return stopListening();
  stopAudio();
  d.listening = true;
  d.error = null;
  render();
  // Liga o microfone dentro do próprio toque (o iPhone só libera nesse momento);
  // o áudio que estivesse tocando já foi parado acima.
  stopListening = startDialogueListening(d);
}

function startDialogueListening(d: NonNullable<AppState["dialogue"]>): () => void {
  return listen({
    onPartial: (text) => {
      const live = document.getElementById("dl-live");
      if (live) live.textContent = text || "Ouvindo… fale agora";
    },
    onDone: (alts) => {
      d.listening = false;
      checkAnswer(alts);
    },
    onError: (msg) => {
      d.listening = false;
      d.error = msg;
      render();
    },
  });
}

/* ---------- conversa com IA ---------- */
type SessionInfo = NonNullable<AppState["aiSession"]>;

/** Pergunta ao servidor como está a sessão com a IA do app (só quando usa a IA do app). */
async function refreshAiSession(): Promise<void> {
  if (!s || s.aiKey || !s.serverAi) return;
  try {
    s.aiSession = await api.aiSession();
    if (s.tab === "ia") render();
  } catch {
    // offline: mantém o que já sabia
  }
}

/** Relógio da sessão: atualiza a contagem sem redesenhar a tela inteira. */
setInterval(() => {
  const st = s?.aiSession;
  if (!s || !st || s.aiKey) return;
  const now = Date.now();
  if (st.state === "active") {
    if (now >= st.endsAt) {
      s.aiSession = { state: "cooldown", endedAt: st.endsAt, availableAt: st.endsAt + 60 * 60_000 };
      if (s.tab === "ia") {
        render();
        toast("Sessão concluída! Revise as correções.", true);
      }
      return;
    }
    const el = document.getElementById("ai-timer");
    if (el) {
      const t = Math.ceil((st.endsAt - now) / 1000);
      el.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
    }
  } else if (st.state === "cooldown") {
    if (now >= st.availableAt) {
      void refreshAiSession();
      toast("Sua conversa com a IA liberou!", true);
      s.aiSession = { state: "ready", minutes: 7 };
      return;
    }
    const el = document.getElementById("ai-wait");
    if (el) el.textContent = `${Math.max(1, Math.ceil((st.availableAt - now) / 60_000))} min`;
  }
}, 1000);

/* ---------- notificações ---------- */
const b64ToBytes = (b64: string): Uint8Array<ArrayBuffer> => {
  const raw = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  // Em desenvolvimento não há service worker: não espera pra sempre.
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
}

async function checkPushOn(): Promise<void> {
  if (!s?.pushAvailable || !("PushManager" in window)) return;
  const reg = await swRegistration();
  s.pushOn = !!(await reg?.pushManager.getSubscription());
}

async function enablePush(): Promise<void> {
  const standalone =
    matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!("PushManager" in window) || !("Notification" in window)) {
    return toast(/iPhone|iPad/.test(navigator.userAgent) && !standalone
      ? "No iPhone, instale o app na Tela de Início pra receber avisos"
      : "Este navegador não recebe notificações");
  }
  if ((await Notification.requestPermission()) !== "granted") return toast("Sem permissão pra notificar. Dá pra liberar nos ajustes do navegador.");
  try {
    const reg = await swRegistration();
    if (!reg) return toast("Abra o app instalado pra ativar os avisos");
    const { publicKey } = await api.pushKey();
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
    await api.pushSubscribe(sub.toJSON());
    s.pushOn = true;
    render();
    toast("Pronto! Te avisamos quando liberar.", true);
  } catch {
    toast("Não deu pra ativar os avisos agora. Tenta de novo.");
  }
}

async function sendToAi(text: string): Promise<void> {
  const chat = ensureAi(s);
  const content = text.trim().slice(0, 600);
  if (chat.loading || aiLocked(s)) return;
  if (content) {
    chat.messages.push({ role: "user", content });
    track(s, { ai: 1 });
    persist(s);
  }
  chat.draft = "";
  chat.loading = true;
  chat.error = null;
  render();
  scrollToEnd();

  const pack = packs[chat.packIndex]!;
  try {
    const res = await fetch("./api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(s.aiKey ? { "X-AI-Key": s.aiKey.key, ...(s.aiKey.model ? { "X-AI-Model": s.aiKey.model } : {}) } : {}),
      },
      body: JSON.stringify({
        scenario: chat.free ? null : { title: pack.title, scene: pack.scene, phrases: pack.phrases.map((p) => plain(p.en)) },
        messages: chat.messages.slice(-24).map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      reply?: string; reply_pt?: string; correction?: string | null; correction_note?: string | null; error?: string; needsKey?: boolean;
      session?: SessionInfo;
    };
    if (data.session) s.aiSession = data.session;
    if (res.status === 429 && data.session?.state === "cooldown") {
      // sessão acabou: o cartão de espera explica, sem mensagem de erro
      const last = chat.messages.at(-1);
      if (content && last?.role === "user" && !last.checked) chat.messages.pop();
      return;
    }
    if (data.needsKey) {
      s.serverAi = false;
      s.aiSettings = { open: true, error: null };
    }
    if (!res.ok || !data.reply) {
      throw new Error(
        data.error ?? (res.status === 404 ? "A conversa com IA precisa do servidor do app (bun dev ou bun preview com GEMINI_API_KEY)." : "A IA não respondeu. Tenta de novo."),
      );
    }
    const last = chat.messages.at(-1);
    if (content && last?.role === "user") {
      last.checked = true;
      last.correction = data.correction ?? null;
      last.note = data.correction_note ?? null;
    }
    chat.messages.push({ role: "assistant", content: data.reply, pt: data.reply_pt });
    speakTts(data.reply);
  } catch (e) {
    chat.error = e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Sem internet: a conversa com IA precisa de conexão.";
  } finally {
    chat.loading = false;
    if (s.tab === "ia") {
      render();
      scrollToEnd();
    }
  }
}

function aiMic(): void {
  stopAudio();
  const input = document.getElementById("ai-input") as HTMLTextAreaElement | null;
  toast("Ouvindo… fale em inglês");
  {
    stopListening = listen({
      onPartial: (text) => {
        if (input) input.value = text;
      },
      onDone: (alts) => {
        const text = alts[0] ?? "";
        if (looksPortuguese(text)) {
          if (input) input.value = "";
          return toast("Entendi em português — fale em inglês (veja o teclado English no iPhone)");
        }
        void sendToAi(text);
      },
      onError: (msg) => toast(msg),
    });
  }
}

/* ---------- ações ---------- */
const actions: Record<string, (el: HTMLElement) => void> = {
  say: (el) => play(findPhrase(el.dataset.id!)!.en),
  slow: (el) => play(findPhrase(el.dataset.id!)!.en, true),
  flip: (el) => {
    const id = el.dataset.id!;
    s.openFlips.has(id) ? s.openFlips.delete(id) : s.openFlips.add(id);
    render();
  },
  "say-flip": (el) => {
    const f = findPhrase(el.dataset.id!)?.flip;
    if (f) play(f.en);
  },
  "say-ex": (el) => {
    const ex = findPhrase(el.dataset.id!)?.examples?.[Number(el.dataset.ex)];
    if (ex) play(ex.en);
  },
  tip: (el) => {
    const id = el.dataset.id!;
    s.openTips.has(id) ? s.openTips.delete(id) : s.openTips.add(id);
    render();
  },
  known: (el) => {
    const before = knownCount(s);
    if (toggleKnown(s, el.dataset.id!)) {
      checkKnownMilestone(before);
      toast(knownInPack(s, s.packIndex) === 5 ? "Pacote completo" : "Anotado. Volta na revisão", true);
    }
    render();
  },
  prev: () => { goToPack(s, s.packIndex - 1); render(); },
  next: () => { goToPack(s, s.packIndex + 1); render(); },
  today: () => { goToPack(s, s.todayIndex); render(); },
  chatpt: () => { s.showChatPt = !s.showChatPt; render(); },
  saychat: () => playSequence(currentPack(s).chat.map((c) => c.en)),
  "goto-treino": () => setTab("treino"),
  "dismiss-ios": () => { s.data.installHintDismissed = true; persist(s); render(); },
  pick: (el) => { goToPack(s, Number(el.dataset.pack)); setTab("hoje"); },
  logout: () => void logout(),
  "goto-dialogo": () => setTab("dialogo"),
  "goto-evolucao": () => setTab("evolucao"),
  "goto-musica": () => setTab("musica"),
  "goto-hoje": () => setTab("hoje"),
  "goto-ia": () => setTab("ia"),

  "dl-play": (el) => play(packs[s.dialogue!.packIndex]!.chat[Number(el.dataset.line)]!.en),
  "dl-hint": () => { s.dialogue!.hint = true; render(); },
  "dl-mic": () => toggleMic(),
  "dl-pt": () => { s.showDialoguePt = !s.showDialoguePt; render(); },
  "dl-retry": () => {
    const d = s.dialogue!;
    const i = dialogueTurnIndex(d);
    if (i !== null) delete d.turns[i];
    render();
  },
  "dl-next": () => {
    const revealed = advanceDialogue(s);
    if (s.dialogue && dialogueDone(s.dialogue) && dialogueScore(s.dialogue) >= 0.9) {
      nudgeSupport(s, "Diálogo mandado com mais de 90%!");
    }
    render();
    scrollToEnd();
    playLines(revealed);
  },
  "dl-skip": () => {
    const expected = expectedLine();
    if (expected) recordTurn(s, { said: "(pulou)", result: bestOf(expected, [""]).result });
    actions["dl-next"]!(document.body);
  },
  "dl-restart": () => { const revealed = startDialogue(s); render(); window.scrollTo(0, 0); playLines(revealed); },

  "ai-start": () => void sendToAi(""),

  "music-level": (el) => {
    s.music.level = el.dataset.level as typeof s.music.level;
    if (s.music.lines.length && s.music.video) s.music.blanks = makeBlanks(s.music.lines, s.music.level, s.music.video.id);
    render();
  },
  "music-pick": (el) => {
    const v = s.music.results.find((x) => x.id === el.dataset.id);
    if (v) void openVideo(v);
  },
  "music-pick-recent": (el) => void musicSearch(el.dataset.id!),
  "music-back": () => {
    destroyPlayer();
    resumeAt = 0;
    s.music = { ...emptyMusic(), query: s.music.query, results: s.music.results, level: s.music.level };
    render();
  },
  "music-answer": (el) => {
    const m = s.music;
    const b = m.pending;
    if (!b) return;
    const ok = el.dataset.word === b.answer;
    m.answers[b.line] = { chosen: el.dataset.word!, ok };
    m.pending = null;
    track(s, { listen: 1, listenHits: ok ? 1 : 0 });
    persist(s);
    if (ok) {
      toast("Isso!", true);
      updateMusicParts();
      setTimeout(() => player?.playVideo(), 500);
    } else {
      m.paused = true;
      updateMusicParts();
    }
  },
  "music-continue": () => {
    s.music.paused = false;
    updateMusicParts();
    player?.playVideo();
  },
  "music-replay": (el) => {
    const m = s.music;
    const line = m.lines[Number(el.dataset.line)];
    if (!line || !player) return;
    m.pending = null;
    m.paused = false;
    // Se ainda não respondeu, a música pausa de novo no fim da linha.
    player.seekTo(Math.max(0, line.t + m.offset - 0.6), true);
    player.playVideo();
    updateMusicParts();
  },
  "music-say": (el) => speakTts(el.dataset.word!),
  "music-offset": (el) => {
    s.music.offset = Math.round((s.music.offset + Number(el.dataset.delta)) * 10) / 10;
    updateMusicParts();
  },
  "music-mark": () => {
    const first = s.music.lines[0];
    if (!player || !first) return;
    s.music.offset = Math.round((player.getCurrentTime() - first.t) * 10) / 10;
    toast("Sincronia ajustada", true);
    updateMusicParts();
  },
  "music-restart": () => {
    const m = s.music;
    m.answers = {};
    m.ended = false;
    m.pending = null;
    m.paused = false;
    m.line = -1;
    player?.seekTo(0, true);
    player?.playVideo();
    updateMusicParts();
  },
  "ai-mode": (el) => {
    const free = el.dataset.free === "1";
    s.ai = { free, packIndex: s.packIndex, messages: [], loading: false, error: null, draft: "", openPt: new Set() };
    render();
  },
  "ai-notify": () => void enablePush(),

  "support-open": () => { s.support = { open: true, amount: 0, nudge: null, daily: false }; render(); },
  "support-done": () => { markSupported(s); render(); toast("Muito obrigado pelo apoio!", true); },
  "support-close": () => { s.support.open = false; render(); },
  "support-later": () => { s.support.nudge = null; render(); },
  "support-amount": (el) => { s.support.amount = Number(el.dataset.amount); render(); },
  "support-copy": () => {
    if (s.pix) void copy(pixPayload(s.pix, s.support.amount || undefined), "Código PIX copiado — cole no app do banco", "pix-code");
  },
  "support-copy-key": () => { if (s.pix) void copy(s.pix.key, "Chave PIX copiada"); },
  "ai-key-edit": () => { s.aiSettings = { open: true, error: null }; render(); },
  "ai-key-cancel": () => { s.aiSettings = { open: false, error: null }; render(); },
  "ai-key-remove": () => {
    saveAiKey(s.user, null);
    s.aiKey = null;
    s.aiSettings = { open: false, error: null };
    render();
    toast("Chave removida deste aparelho", true);
  },
  "ai-mic": () => aiMic(),
  "ai-say": (el) => { const m = s.ai?.messages[Number(el.dataset.i)]; if (m) speakTts(m.content); },
  "ai-say-fix": (el) => { const m = s.ai?.messages[Number(el.dataset.i)]; if (m?.correction) speakTts(m.correction); },
  "ai-pt": (el) => {
    const set = ensureAi(s).openPt;
    const i = Number(el.dataset.i);
    set.has(i) ? set.delete(i) : set.add(i);
    render();
  },
  "ai-reset": () => {
    const free = s.ai?.free ?? true;
    s.ai = { free, packIndex: s.packIndex, messages: [], loading: false, error: null, draft: "", openPt: new Set() };
    render();
  },
  "ai-prev": () => { goToPack(s, s.packIndex - 1); ensureAi(s); render(); },
  "ai-next": () => { goToPack(s, s.packIndex + 1); ensureAi(s); render(); },
  reminder: () => {
    const input = document.getElementById("reminder-time") as HTMLInputElement | null;
    const time = input?.value || s.data.reminderTime;
    downloadReminder(buildReminderICS({ time, appUrl: location.origin + location.pathname }));
    s.data.reminderTime = time;
    s.data.reminderAdded = true;
    persist(s);
    render();
    toast(`Abra o arquivo pra salvar o lembrete das ${time}`, true);
  },

  mode: (el) => {
    const pr = startPractice(s, el.dataset.mode as PracticeMode);
    render();
    if (pr.mode === "ouvir") playCurrent();
  },
  reveal: () => {
    const pr = ensurePractice(s);
    pr.revealed = true;
    document.getElementById("flip")?.classList.add("on");
    // Espera a animação de virar antes de trocar os botões.
    setTimeout(render, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 560);
  },
  "say-card": () => playCurrent(),
  "slow-card": () => playCurrent(true),
  hit: () => next(true),
  miss: () => next(false),
  restart: () => { startPractice(s); render(); if (s.practice?.mode === "ouvir") playCurrent(); },
};

function playCurrent(slow = false): void {
  const pr = s.practice;
  const id = pr?.deck[pr.pos];
  const p = id ? findPhrase(id) : undefined;
  if (p) play(p.en, slow);
}

function next(hit: boolean): void {
  const before = knownCount(s);
  answer(s, hit);
  checkKnownMilestone(before);
  render();
  if (s.practice?.mode === "ouvir") playCurrent();
}

/* ---------- detalhe dos gráficos (passar o mouse ou tocar) ---------- */
function showTip(target: Element): void {
  const chart = target.closest<HTMLElement>("[data-chart]");
  const text = target.getAttribute("data-tip");
  if (!chart || !text) return;
  const tip = chart.querySelector<HTMLElement>(".tip")!;
  tip.textContent = text;
  tip.hidden = false;
  const box = chart.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  const cx = target.getAttribute("data-cx");
  if (cx) {
    // gráfico de linha: crosshair e ponto em foco
    const svg = chart.querySelector("svg")!;
    const cross = svg.querySelector(".cross")!;
    const focus = svg.querySelector(".focus")!;
    cross.setAttribute("x1", cx);
    cross.setAttribute("x2", cx);
    cross.setAttribute("visibility", "visible");
    focus.setAttribute("cx", cx);
    focus.setAttribute("cy", target.getAttribute("data-cy")!);
    focus.setAttribute("visibility", "visible");
  }
  const left = Math.min(Math.max(r.left + r.width / 2 - box.left, 60), box.width - 60);
  tip.style.left = `${left}px`;
  tip.style.top = `${r.top - box.top - 8}px`;
}
function hideTips(chart: Element | null): void {
  if (!chart) return;
  chart.querySelector<HTMLElement>(".tip")?.setAttribute("hidden", "");
  chart.querySelectorAll(".cross,.focus").forEach((el) => el.setAttribute("visibility", "hidden"));
}
document.addEventListener("pointerover", (e) => {
  const t = (e.target as Element).closest?.("[data-chart] [data-tip]");
  if (t) showTip(t);
});
document.addEventListener("pointerout", (e) => {
  const from = (e.target as Element).closest?.("[data-chart]");
  const to = (e.relatedTarget as Element | null)?.closest?.("[data-chart]");
  if (from && from !== to) hideTips(from);
});

document.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  if (form.dataset.form === "login" || form.dataset.form === "signup") {
    void submitAuth(form);
    return;
  }
  if (form.dataset.form === "dl-type") {
    const value = (document.getElementById("dl-input") as HTMLInputElement | null)?.value.trim();
    if (value) checkAnswer([value], false);
  }
  if (form.dataset.form === "ai-key") {
    const f = new FormData(form);
    const key = String(f.get("key") ?? "").trim();
    const model = String(f.get("model") ?? "").trim();
    if (!providerFor(key)) {
      s.aiSettings = { open: true, error: "Essa não parece uma chave da OpenAI (sk-...) nem da Anthropic (sk-ant-...)." };
      return render();
    }
    if (model && !/^[a-zA-Z0-9._:-]+$/.test(model)) {
      s.aiSettings = { open: true, error: "Nome de modelo inválido. Deixe em branco pra usar o padrão." };
      return render();
    }
    s.aiKey = { key, model };
    saveAiKey(s.user, s.aiKey);
    s.aiSettings = { open: false, error: null };
    render();
    toast("Chave salva neste aparelho", true);
    return;
  }
  if (form.dataset.form === "music-search") {
    void musicSearch((document.getElementById("music-q") as HTMLInputElement | null)?.value ?? "");
    return;
  }
  if (form.dataset.form === "ai-send") {
    const value = (document.getElementById("ai-input") as HTMLTextAreaElement | null)?.value ?? "";
    if (value.trim()) void sendToAi(value);
  }
});

document.addEventListener("change", (e) => {
  const el = e.target as HTMLSelectElement;
  if (el.id !== "music-lyrics" || !s) return;
  void (async () => {
    const r = await fetch(`./api/music/lyrics?id=${encodeURIComponent(el.value)}`);
    const d = (await r.json()) as { lrc?: string; chosen?: never; error?: string };
    if (r.ok && d.lrc) applyLyrics(d.lrc, d as never);
    else toast(d.error ?? "Não deu pra trocar a letra.");
  })();
});

document.addEventListener("input", (e) => {
  const el = e.target as HTMLElement;
  if (el.id === "ai-input" && s?.ai) s.ai.draft = (el as HTMLTextAreaElement).value;
});

document.addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement;
  if (e.key === "Escape" && s?.support.open) {
    s.support.open = false;
    return render();
  }
  // Enter envia; Shift+Enter quebra linha.
  if (el.id === "ai-input" && e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    (el.closest("form") as HTMLFormElement | null)?.requestSubmit();
  }
});

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const authSwitch = target.closest<HTMLElement>("[data-auth]");
  if (authSwitch) {
    auth.mode = authSwitch.dataset.auth as AuthView["mode"];
    auth.error = null;
    return renderAuthScreen();
  }
  if (!s) return;
  const tab = target.closest<HTMLButtonElement>("nav.tabbar button");
  if (tab) return setTab(tab.dataset.tab as Tab);
  const el = target.closest<HTMLElement>("[data-act]");
  const fn = el && actions[el.dataset.act!];
  if (el && fn) fn(el);
});

/* ---------- PWA: instalar e funcionar offline ---------- */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let installEvent: BeforeInstallPromptEvent | null = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e as BeforeInstallPromptEvent;
  // Pode chegar antes do login terminar; o start() liga o botão depois.
  if (s) {
    s.canInstall = true;
    render();
  }
});
window.addEventListener("appinstalled", () => {
  installEvent = null;
  if (!s) return;
  s.canInstall = false;
  render();
  toast("App instalado", true);
});
installBtn.addEventListener("click", async () => {
  if (!installEvent) return;
  await installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  s.canInstall = false;
  render();
});

if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Na primeira visita o SW só assume depois de instalado; aí guarda o áudio do pacote aberto.
    navigator.serviceWorker.addEventListener("controllerchange", () => cachePackAudio());
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Sem service worker o app funciona normalmente, só não fica offline.
    });
  });
}

void boot();
