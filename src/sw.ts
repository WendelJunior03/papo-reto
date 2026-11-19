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

  if (url.pathname.includes("/audio/")) {
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
