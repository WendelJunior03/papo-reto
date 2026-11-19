import "./styles.css";
import { findPhrase } from "./data";
import { esc } from "./lib/html";
import { play, playSequence, speakTts, stop as stopAudio } from "./lib/speech";
import { listen } from "./lib/listen";
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
  setPersistListener, type AppState, nudgeSupport, dialogueDone, dialogueScore,
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
    const me = await api.me().catch(() => ({ serverAi: false, pix: null }));
    await start(res.username, true, me.serverAi, me.pix);
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
  stopListening();
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
async function start(user: string, online = true, serverAi = false, pix: PixConfig | null = loadPix()): Promise<void> {
  setLastUser(user);
  if (online) savePix(pix);
  document.body.classList.remove("auth");
  s = createState(user, new Date(), undefined, serverAi, pix);
  render();
  if (!online) return;
  try {
    const remote = await api.getProgress();
    const merged = mergeData(load(user), remote.data);
    s = createState(user, new Date(), merged, serverAi, pix);
    save(user, merged);
    const days = streakDays(s);
    if (days >= 7) nudgeSupport(s, `${days} dias seguidos estudando!`);
    render();
    await pushNow();
  } catch {
    dirty = true; // sem conexão: sobe quando voltar
  }
}

async function boot(): Promise<void> {
  try {
    const me = await api.me();
    await start(me.username, true, me.serverAi, me.pix);
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
  stats.innerHTML = `<span class="st at" title="Dias seguidos">${days} ${days === 1 ? "dia" : "dias"}</span>
    <span class="st ok" title="Frases que você já sabe">${knownCount(s)}</span>`;
  if (s.tab === "dialogo") ensureDialogue(s);
  app.innerHTML =
    s.tab === "hoje" ? renderToday(s)
    : s.tab === "dialogo" ? renderDialogue(s)
    : s.tab === "ia" ? renderAi(s)
    : s.tab === "treino" ? renderPractice(s)
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
}

/** Pede ao service worker pra guardar os áudios do pacote aberto (fica disponível offline). */
let cachedPack = -1;
function cachePackAudio(): void {
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
  stopListening();
  stopAudio();
  s.tab = tab;
  history.replaceState(null, "", tab === "hoje" ? location.pathname : `#${tab}`);
  const revealed = tab === "dialogo" ? ensureDialogue(s) : [];
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

function checkAnswer(alternatives: string[]): void {
  const expected = expectedLine();
  if (!expected) return;
  const { said, result } = bestOf(expected, alternatives);
  recordTurn(s, { said, result });
  render();
  scrollToEnd();
}

function toggleMic(): void {
  const d = s.dialogue;
  if (!d) return;
  if (d.listening) return stopListening();
  stopAudio();
  d.listening = true;
  d.error = null;
  render();
  stopListening = listen({
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
async function sendToAi(text: string): Promise<void> {
  const chat = ensureAi(s);
  const content = text.trim().slice(0, 600);
  if (chat.loading) return;
  if (content) chat.messages.push({ role: "user", content });
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
        scenario: { title: pack.title, scene: pack.scene, phrases: pack.phrases.map((p) => plain(p.en)) },
        messages: chat.messages.slice(-24).map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      reply?: string; reply_pt?: string; correction?: string | null; correction_note?: string | null; error?: string; needsKey?: boolean;
    };
    if (data.needsKey) {
      s.serverAi = false;
      s.aiSettings = { open: true, error: null };
    }
    if (!res.ok || !data.reply) {
      throw new Error(
        data.error ?? (res.status === 404 ? "A conversa com IA precisa do servidor do app (bun dev ou bun preview com ANTHROPIC_API_KEY)." : "A IA não respondeu. Tenta de novo."),
      );
    }
    const last = chat.messages.at(-1);
    if (content && last?.role === "user") {
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
  stopListening = listen({
    onPartial: (text) => {
      if (input) input.value = text;
    },
    onDone: (alts) => void sendToAi(alts[0] ?? ""),
    onError: (msg) => toast(msg),
  });
  toast("Ouvindo… fale em inglês");
}

/* ---------- ações ---------- */
const actions: Record<string, (el: HTMLElement) => void> = {
  say: (el) => play(findPhrase(el.dataset.id!)!.en),
  slow: (el) => play(findPhrase(el.dataset.id!)!.en, true),
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

  "support-open": () => { s.support = { open: true, amount: 0, nudge: null }; render(); },
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
  "ai-reset": () => { s.ai = null; ensureAi(s); render(); },
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

document.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  if (form.dataset.form === "login" || form.dataset.form === "signup") {
    void submitAuth(form);
    return;
  }
  if (form.dataset.form === "dl-type") {
    const value = (document.getElementById("dl-input") as HTMLInputElement | null)?.value.trim();
    if (value) checkAnswer([value]);
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
  if (form.dataset.form === "ai-send") {
    const value = (document.getElementById("ai-input") as HTMLTextAreaElement | null)?.value ?? "";
    if (value.trim()) void sendToAi(value);
  }
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
  s.canInstall = true;
  render();
});
window.addEventListener("appinstalled", () => {
  installEvent = null;
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
