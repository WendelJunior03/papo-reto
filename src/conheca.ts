/**
 * Página de divulgação (/conheca): demonstração das frases com o áudio de verdade,
 * lista de recursos, passo a passo de instalação e PIX opcional antes do cadastro.
 * Página solta: não usa o estado do app nem precisa de login.
 */
import qrcode from "qrcode-generator";
import { esc, highlight } from "./lib/html";
import { pixPayload, type PixConfig } from "./lib/pix";
import { audioFile } from "./lib/spoken";
import { ui, packIcon } from "./icons";

/* ---------- demonstração (frases reais do primeiro pacote, com áudio gravado) ---------- */
const DEMO = [
  { en: "[What's up]?", pt: "E aí?", tag: "gíria", note: "Não é pergunta de verdade. A resposta natural é <strong>Not much, you?</strong>" },
  { en: "I'm [running late].", pt: "Tô atrasado.", tag: "casual", note: "Manda isso por mensagem quando você <em>ainda está</em> a caminho." },
  { en: "[Can I get] a large coffee to go?", pt: "Me vê um café grande pra viagem?", tag: "casual", note: "Nativo pede com <strong>Can I get…</strong>, bem mais natural que “I want”." },
  { en: "[No worries].", pt: "De boa. / Relaxa.", tag: "casual", note: "Resposta curtinha pra “desculpa” ou “obrigado”." },
];

const demoEl = document.getElementById("demo")!;
let open = 0;
let player: HTMLAudioElement | null = null;

function play(i: number, slow = false): void {
  player?.pause();
  player = new Audio(`./${audioFile(DEMO[i]!.en)}`);
  player.playbackRate = slow ? 0.7 : 1;
  void player.play().catch(() => toast("Não deu pra tocar o áudio agora."));
}

function renderDemo(): void {
  demoEl.innerHTML = DEMO.map(
    (p, i) => `<article class="d-card${i === open ? " on" : ""}">
      <button class="d-main" data-i="${i}" aria-expanded="${i === open}">
        <span class="d-tag">${p.tag}</span>
        <span class="d-en" lang="en">${highlight(p.en)}</span>
        <span class="d-pt">${esc(p.pt)}</span>
      </button>
      ${i === open
        ? `<div class="d-more"><p class="d-note">${p.note}</p>
            <div class="d-acts"><button class="d-play" data-play="${i}">${ui.play}Ouvir</button>
            <button class="d-slow" data-slow="${i}">${ui.slow}Devagar</button></div></div>`
        : ""}
    </article>`,
  ).join("");
}

demoEl.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest("button");
  if (!t) return;
  if (t.dataset.play) return play(Number(t.dataset.play));
  if (t.dataset.slow) return play(Number(t.dataset.slow), true);
  const i = Number(t.dataset.i);
  open = i;
  renderDemo();
  play(i);
});
renderDemo();

/* ---------- recursos ---------- */
const FEATS: [string, string, string][] = [
  [packIcon("sun"), "5 frases por dia", "Um pacote novo todo dia: café, trabalho, festa, viagem… com áudio, dica e exemplos."],
  [packIcon("people"), "Diálogo guiado", "Converse numa cena real, fale no microfone e veja se acertou."],
  [packIcon("sparkle"), "Conversa com IA", "Bata papo em inglês por 7 minutos. A IA corrige sua frase com carinho."],
  [ui.music, "Aprenda cantando", "A música toca com a letra, algumas palavras somem e você completa de ouvido."],
  [ui.flip, "Treino inteligente", "Cards de falar e ouvir que voltam no tempo certo pra você não esquecer."],
  [ui.car, "Ouvir no carro", "Inglês e tradução em áudio, até com a tela bloqueada."],
  [packIcon("book"), "Historinhas", "Contos curtinhos feitos só com as frases que você já sabe."],
  [ui.mic, "Salas ao vivo", "Chame amigos pra falar inglês por voz. Falou português? Tá fora! 😅"],
  [ui.chart, "Sua evolução", "Sequência de dias, frases dominadas, ouvido afiado e selos pra conquistar."],
];
document.getElementById("feats")!.innerHTML = FEATS.map(
  ([ic, t, d]) => `<div class="feat"><span class="feat-ic">${ic}</span><b>${t}</b><p>${d}</p></div>`,
).join("");

/* ---------- instalar: abre na aba do aparelho da pessoa ---------- */
const tabs = [...document.querySelectorAll<HTMLButtonElement>(".inst-tabs [role=tab]")];
function selectTab(id: string): void {
  for (const t of tabs) {
    const on = t.id === id;
    t.setAttribute("aria-selected", String(on));
    document.getElementById(t.getAttribute("aria-controls")!)!.hidden = !on;
  }
}
for (const t of tabs) t.addEventListener("click", () => selectTab(t.id));
const ua = navigator.userAgent;
selectTab(/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "t-ios" : /Android/.test(ua) ? "t-and" : /Mobi/.test(ua) ? "t-ios" : "t-pc");

// Onde o navegador oferece instalar direto (Chrome/Edge), um botão faz tudo.
interface InstallPrompt extends Event { prompt(): Promise<void> }
const installBtn = document.getElementById("install") as HTMLButtonElement;
let installEvent: InstallPrompt | null = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e as InstallPrompt;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async () => {
  if (!installEvent) return;
  await installEvent.prompt();
  installEvent = null;
  installBtn.hidden = true;
});

/* ---------- PIX (opcional) ---------- */
const qrBox = document.getElementById("pix-qr")!;
const toLine = document.getElementById("pix-to")!;
const copyBtn = document.getElementById("pix-copy") as HTMLButtonElement;
const amountBtns = [...document.querySelectorAll<HTMLButtonElement>(".pix-amounts button")];
let pix: PixConfig | null = null;
let amount = 0;

/** QR escuro sobre branco: o contraste que a câmera do banco espera. */
function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const m = 3;
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + m} ${r + m}h1v1h-1z`;
  const size = n + m * 2;
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="QR Code do PIX" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#0E1E33"/></svg>`;
}

function renderPix(): void {
  if (!pix) return;
  qrBox.innerHTML = qrSvg(pixPayload(pix, amount || undefined));
  toLine.textContent = `${amount ? `R$ ${amount},00 · ` : ""}para ${pix.name}`;
  copyBtn.disabled = false;
}

for (const b of amountBtns) {
  b.addEventListener("click", () => {
    amount = Number(b.dataset.amount);
    for (const x of amountBtns) x.setAttribute("aria-pressed", String(x === b));
    renderPix();
  });
}

copyBtn.addEventListener("click", async () => {
  if (!pix) return;
  try {
    await navigator.clipboard.writeText(pixPayload(pix, amount || undefined));
    toast("Código PIX copiado — cole no app do banco");
  } catch {
    toast("Não deu pra copiar. Use o QR Code.");
  }
});

fetch("./api/pix")
  .then((r) => (r.ok ? (r.json() as Promise<{ pix: PixConfig | null }>) : { pix: null }))
  .then((d) => {
    pix = d.pix;
    if (pix) renderPix();
    else document.getElementById("pix")!.classList.add("no-pix");
  })
  .catch(() => {
    qrBox.innerHTML = `<span class="pix-wait">Sem conexão pra mostrar o QR Code agora.</span>`;
  });

/* ---------- aviso rápido ---------- */
const toastEl = document.getElementById("toast")!;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2200);
}
