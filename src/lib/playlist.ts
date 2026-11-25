import { findPhrase, packs } from "../data";
import { isKnown, type Progress } from "./srs";
import { audioFile, ptAudioFile, SILENCE } from "./spoken";

/**
 * Lista do modo "Ouvir no carro": tudo vira arquivo de áudio em sequência (frase, pausa, tradução…),
 * porque com a tela bloqueada o iPhone congela timers e a voz do sistema. Função pura, sem DOM.
 */

export type ListenSource = "hoje" | "pacote" | "revisao";
export type ListenLang = "enpt" | "en";

/** O que aparece na tela (e no bloqueio de tela) enquanto toca. */
export interface ListenItem {
  en: string;
  pt: string;
  /** Nome do pacote (vira o "álbum" na tela de bloqueio). */
  album: string;
  /** Fala da cena (false = frase do pacote). */
  chat: boolean;
  who?: string;
}

/** Um arquivo da fila. `item` aponta pro ListenItem que está na tela durante ele. */
export interface ListenTrack {
  src: string;
  item: number;
  voice: "en" | "pt" | "pause";
}

export interface Playlist {
  title: string;
  items: ListenItem[];
  tracks: ListenTrack[];
}

export type PlaylistInput = { source: "pack"; packIndex: number } | { source: "review"; progress: Progress };

/** Quantas frases já dominadas entram na revisão. */
export const REVIEW_SIZE = 15;

/** Frases já dominadas (caixa ≥ 1), as mais recentes primeiro. */
export function reviewIds(progress: Progress, limit = REVIEW_SIZE): string[] {
  return Object.entries(progress)
    .filter(([id, c]) => isKnown(c) && findPhrase(id))
    .sort(([, a], [, b]) => (b.at ?? "").localeCompare(a.at ?? "") || b.due.localeCompare(a.due))
    .slice(0, limit)
    .map(([id]) => id);
}

/**
 * Frase: inglês, pausa curta, português, pausa longa, inglês de novo (pra repetir junto), pausa longa.
 * Só inglês: inglês, pausa longa, inglês, pausa longa.
 * Fala da cena: inglês (+ pausa curta e português), pausa curta.
 */
export function buildPlaylist(input: PlaylistInput, lang: ListenLang): Playlist {
  const items: ListenItem[] = [];
  let title: string;

  if (input.source === "pack") {
    const pack = packs[input.packIndex]!;
    title = pack.title;
    for (const p of pack.phrases) items.push({ en: p.en, pt: p.pt, album: pack.title, chat: false });
    for (const c of pack.chat) items.push({ en: c.en, pt: c.pt, album: pack.title, chat: true, who: c.me ? "Você" : c.who });
  } else {
    title = "Revisão";
    for (const id of reviewIds(input.progress)) {
      const p = findPhrase(id)!;
      items.push({ en: p.en, pt: p.pt, album: packs[p.packIndex]!.title, chat: false });
    }
  }

  const tracks: ListenTrack[] = [];
  items.forEach((it, item) => {
    const en: ListenTrack = { src: audioFile(it.en), item, voice: "en" };
    const pt: ListenTrack = { src: ptAudioFile(it.pt), item, voice: "pt" };
    const short: ListenTrack = { src: SILENCE.short, item, voice: "pause" };
    const long: ListenTrack = { src: SILENCE.long, item, voice: "pause" };
    if (it.chat) tracks.push(en, ...(lang === "enpt" ? [short, pt] : []), short);
    else if (lang === "enpt") tracks.push(en, short, pt, long, en, long);
    else tracks.push(en, long, en, long);
  });
  return { title, items, tracks };
}

/** Posição na fila do primeiro arquivo de um item (pra pular de frase em frase). */
export function firstTrackOf(pl: Playlist, item: number): number {
  const i = pl.tracks.findIndex((t) => t.item === item);
  return i < 0 ? pl.tracks.length : i;
}

/** Arquivos diferentes da lista (pra guardar offline antes de sair de casa). */
export const playlistFiles = (pl: Playlist): string[] => [...new Set(pl.tracks.map((t) => t.src))];
