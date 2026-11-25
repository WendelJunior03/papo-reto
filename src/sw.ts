/**
 * Service worker: guarda o app inteiro no aparelho na instalação (funciona offline)
 * e as fontes do Google na primeira vez que forem baixadas.
 * __PRECACHE__ e __VERSION__ são injetados pelo scripts/build.ts.
 */
export {};
declare const self: ServiceWorkerGlobalScope;
declare const __PRECACHE__: string[];
declare const __VERSION__: string;

const APP_CACHE = `papo-reto-${__VERSION__}`;
const FONT_CACHE = "papo-reto-fonts";
/** Áudios ficam entre versões: o arquivo só muda se o texto mudar (nome = hash do texto). */
const AUDIO_CACHE = "papo-reto-audio";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((c) => c.addAll(__PRECACHE__)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== APP_CACHE && k !== FONT_CACHE && k !== AUDIO_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Login, progresso e IA sempre vão direto ao servidor.
  if (url.pathname.includes("/api/")) return;

  // Inglês (/audio/) e tradução do modo "Ouvir no carro" (/audio-pt/): guardados sob demanda.
  if (/\/audio(-pt)?\//.test(url.pathname)) {
    event.respondWith(audio(req));
    return;
  }
  if (req.mode === "navigate") {
    // Qualquer rota abre o app guardado ("./"); tenta a rede só se não houver cópia.
    event.respondWith(caches.match("./").then((r) => (r ? unredirected(r) : fetch(req))));
    return;
  }
  event.respondWith(fromCache(req));
});

/**
 * O navegador recusa abrir uma página vinda de uma resposta que foi redirecionada
 * (ex.: o Cloudflare manda /index.html → /). Recria a resposta sem a marca de redirecionamento.
 */
function unredirected(res: Response): Response {
  if (!res.redirected) return res;
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** O app avisa quais áudios o pacote aberto usa; eles são baixados em segundo plano. */
self.addEventListener("message", (event) => {
  const data = event.data as { type?: string; urls?: string[] } | null;
  if (data?.type !== "cache-audio" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(AUDIO_CACHE).then(async (cache) => {
      for (const u of data.urls!) {
        if (await cache.match(u)) continue;
        try {
          const res = await fetch(u);
          if (res.ok) await cache.put(u, res);
        } catch {
          return; // sem internet: tenta de novo na próxima vez
        }
      }
    }),
  );
});

/** Áudio: guarda o arquivo inteiro na primeira vez e responde do cache (com recorte de Range). */
async function audio(req: Request): Promise<Response> {
  const cache = await caches.open(AUDIO_CACHE);
  let full = await cache.match(req.url);
  if (!full) {
    const res = await fetch(req.url); // sem Range: precisa do arquivo inteiro pra guardar
    if (!res.ok) return res;
    await cache.put(req.url, res.clone());
    full = res;
  }
  return withRange(req, full);
}

/**
 * O Safari pede áudio em pedaços (cabeçalho Range) e não toca se receber o arquivo inteiro,
 * então para mídia guardada a resposta é recortada e devolvida como 206.
 */
async function fromCache(req: Request): Promise<Response> {
  const cached = await caches.match(req.url);
  return cached ? withRange(req, unredirected(cached)) : fetch(req);
}

async function withRange(req: Request, cached: Response): Promise<Response> {
  const range = req.headers.get("range");
  if (!range) return cached;

  const buf = await cached.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const start = m?.[1] ? Number(m[1]) : 0;
  const end = m?.[2] ? Math.min(Number(m[2]), buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": cached.headers.get("Content-Type") ?? "audio/mp4",
      "Content-Range": `bytes ${start}-${end}/${buf.byteLength}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}

async function staleWhileRevalidate(req: Request): Promise<Response> {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached ?? Response.error());
  return cached ?? network;
}

/**
 * Notificação do servidor. O push vem sem conteúdo: o texto é buscado em /api/push/latest
 * (com o cookie da conta). Sem internet ou sem login, mostra um texto genérico.
 */
interface PushText {
  kind?: string;
  title: string;
  body: string;
  url: string;
}

const FALLBACK_PUSH: PushText = { kind: "papo-reto", title: "Papo Reto English", body: "Bora praticar inglês? Seu pacote do dia está te esperando.", url: "./" };

async function latestPush(): Promise<PushText> {
  try {
    const res = await fetch("./api/push/latest", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(5000) });
    const data = res.ok ? ((await res.json()) as PushText | null) : null;
    return data?.title && data.body ? data : FALLBACK_PUSH;
  } catch {
    return FALLBACK_PUSH;
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    latestPush().then((msg) =>
      self.registration.showNotification(msg.title, {
        body: msg.body,
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        tag: msg.kind ?? "papo-reto",
        data: { url: msg.url || "./" },
      }),
    ),
  );
});

/** Tocar na notificação abre o app (ou traz a aba aberta pra frente) na tela do aviso. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string } | null)?.url ?? "./", self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) return win.navigate(url).then((w) => w?.focus());
      return self.clients.openWindow(url);
    }),
  );
});
