/**
 * Aba Música: busca no YouTube (YouTube Data API, chave do servidor), dados de um link
 * colado (oEmbed, sem chave) e letra sincronizada (LRCLIB, aberto). As letras são buscadas
 * na hora e não ficam guardadas no app.
 */
const UA = "PapoReto/1.0 (https://github.com/WendelJunior03/papo-reto)";

export interface Video {
  id: string;
  title: string;
  channel: string;
  thumb: string;
  /** Duração em segundos (0 quando não se sabe). */
  duration: number;
}

export interface LyricsCandidate {
  id: number;
  track: string;
  artist: string;
  duration: number;
}

export class MusicError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const decode = (s: string): string =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** "PT4M5S" → 245 */
export function isoDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

/** Aceita link do YouTube (watch, youtu.be, shorts, music) ou o próprio id. */
export function videoIdFrom(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return null;
    if (u.hostname.endsWith("youtu.be")) return /^\/([\w-]{11})/.exec(u.pathname)?.[1] ?? null;
    const v = u.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;
    return /^\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function searchVideos(q: string, key: string): Promise<Video[]> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({ part: "snippet", type: "video", maxResults: "10", q, key, videoEmbeddable: "true" }).toString();
  const res = await fetch(url);
  if (res.status === 403) throw new MusicError("A busca do YouTube atingiu o limite do dia ou a chave foi recusada.", 503);
  if (!res.ok) throw new MusicError("Não deu pra buscar no YouTube agora.", 502);
  const data = (await res.json()) as {
    items: { id: { videoId: string }; snippet: { title: string; channelTitle: string; thumbnails: Record<string, { url: string }> } }[];
  };
  const ids = data.items.map((i) => i.id.videoId).join(",");
  const durations = new Map<string, number>();
  if (ids) {
    const d = new URL("https://www.googleapis.com/youtube/v3/videos");
    d.search = new URLSearchParams({ part: "contentDetails", id: ids, key }).toString();
    const r = await fetch(d);
    if (r.ok) {
      const dd = (await r.json()) as { items: { id: string; contentDetails: { duration: string } }[] };
      for (const v of dd.items) durations.set(v.id, isoDuration(v.contentDetails.duration));
    }
  }
  return data.items.map((i) => ({
    id: i.id.videoId,
    title: decode(i.snippet.title),
    channel: decode(i.snippet.channelTitle),
    thumb: (i.snippet.thumbnails.medium ?? i.snippet.thumbnails.default)?.url ?? "",
    duration: durations.get(i.id.videoId) ?? 0,
  }));
}

/** Título e canal de um vídeo a partir do link (sem chave). */
export async function videoInfo(id: string): Promise<Video> {
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
  if (!res.ok) throw new MusicError("Não achei esse vídeo (ou ele não pode ser incorporado).", 404);
  const d = (await res.json()) as { title: string; author_name: string; thumbnail_url: string };
  return { id, title: d.title, channel: d.author_name, thumb: d.thumbnail_url, duration: 0 };
}

interface LrclibItem {
  id: number;
  trackName: string;
  artistName: string;
  duration: number;
  syncedLyrics: string | null;
}

/** Procura letras sincronizadas e escolhe a de duração mais parecida com a do vídeo. */
export async function findLyrics(query: string, duration: number): Promise<{ lrc: string; chosen: LyricsCandidate; candidates: LyricsCandidate[] } | null> {
  const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new MusicError("Não deu pra buscar a letra agora.", 502);
  const items = ((await res.json()) as LrclibItem[]).filter((i) => i.syncedLyrics);
  if (!items.length) return null;
  const ranked = duration
    ? [...items].sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration))
    : items;
  const best = ranked[0]!;
  const toCandidate = (i: LrclibItem): LyricsCandidate => ({ id: i.id, track: i.trackName, artist: i.artistName, duration: Math.round(i.duration) });
  return { lrc: best.syncedLyrics!, chosen: toCandidate(best), candidates: ranked.slice(0, 6).map(toCandidate) };
}

export async function lyricsById(id: number): Promise<{ lrc: string; chosen: LyricsCandidate } | null> {
  const res = await fetch(`https://lrclib.net/api/get/${id}`, { headers: { "User-Agent": UA } });
  if (res.status === 404) return null;
  if (!res.ok) throw new MusicError("Não deu pra buscar a letra agora.", 502);
  const i = (await res.json()) as LrclibItem;
  if (!i.syncedLyrics) return null;
  return { lrc: i.syncedLyrics, chosen: { id: i.id, track: i.trackName, artist: i.artistName, duration: Math.round(i.duration) } };
}
