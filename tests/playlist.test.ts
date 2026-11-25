import { describe, expect, test } from "bun:test";
import { packs, phraseId } from "../src/data";
import { buildPlaylist, firstTrackOf, playlistFiles, REVIEW_SIZE, reviewIds } from "../src/lib/playlist";
import { audioFile, ptAudioFile, SILENCE } from "../src/lib/spoken";
import type { Progress } from "../src/lib/srs";

const pack = packs[0]!;

describe("ouvir no carro: lista", () => {
  test("pacote, inglês + português: frase, pausa, tradução, pausa, frase de novo, pausa", () => {
    const pl = buildPlaylist({ source: "pack", packIndex: 0 }, "enpt");
    expect(pl.title).toBe(pack.title);
    expect(pl.items.length).toBe(5 + pack.chat.length);
    const p = pack.phrases[0];
    expect(pl.tracks.slice(0, 6).map((t) => t.src)).toEqual([
      audioFile(p.en), SILENCE.short, ptAudioFile(p.pt), SILENCE.long, audioFile(p.en), SILENCE.long,
    ]);
    expect(pl.tracks.slice(0, 6).map((t) => t.voice)).toEqual(["en", "pause", "pt", "pause", "en", "pause"]);
    expect(pl.tracks.slice(0, 6).every((t) => t.item === 0)).toBe(true);
  });

  test("frases primeiro, na ordem do pacote; depois a cena, na ordem das falas", () => {
    const pl = buildPlaylist({ source: "pack", packIndex: 0 }, "enpt");
    expect(pl.items.map((i) => i.en)).toEqual([...pack.phrases.map((p) => p.en), ...pack.chat.map((c) => c.en)]);
    expect(pl.items.map((i) => i.chat)).toEqual([...pack.phrases.map(() => false), ...pack.chat.map(() => true)]);
    // a fila nunca volta pra um item anterior
    const order = pl.tracks.map((t) => t.item);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const c = pack.chat[0]!;
    const first = firstTrackOf(pl, 5);
    expect(pl.tracks.slice(first, first + 4).map((t) => t.src)).toEqual([audioFile(c.en), SILENCE.short, ptAudioFile(c.pt), SILENCE.short]);
    expect(pl.items[5]!.who).toBe(c.me ? "Você" : c.who);
  });

  test("só inglês: nenhum áudio em português", () => {
    const pl = buildPlaylist({ source: "pack", packIndex: 0 }, "en");
    expect(pl.tracks.some((t) => t.voice === "pt" || t.src.startsWith("audio-pt/"))).toBe(false);
    const p = pack.phrases[0];
    expect(pl.tracks.slice(0, 4).map((t) => t.src)).toEqual([audioFile(p.en), SILENCE.long, audioFile(p.en), SILENCE.long]);
    expect(pl.tracks.length).toBe(5 * 4 + pack.chat.length * 2);
  });

  test("revisão: só frases dominadas (caixa ≥ 1), as mais recentes primeiro, no máximo 15", () => {
    const progress: Progress = {
      [phraseId(packs[1]!, 0)]: { box: 1, due: "2026-11-20", at: "2026-11-01" },
      [phraseId(packs[2]!, 3)]: { box: 3, due: "2026-12-01", at: "2026-11-10" },
      [phraseId(packs[3]!, 1)]: { box: 0, due: "2026-11-24", at: "2026-11-15" }, // errou: não sabe mais
      [phraseId(packs[4]!, 2)]: { box: 2, due: "2026-11-30" }, // sem data de quando aprendeu: por último
      "pacote-que-sumiu:0": { box: 4, due: "2026-12-10", at: "2026-11-20" },
    };
    expect(reviewIds(progress)).toEqual([phraseId(packs[2]!, 3), phraseId(packs[1]!, 0), phraseId(packs[4]!, 2)]);

    const pl = buildPlaylist({ source: "review", progress }, "enpt");
    expect(pl.title).toBe("Revisão");
    expect(pl.items.map((i) => i.en)).toEqual([packs[2]!.phrases[3].en, packs[1]!.phrases[0].en, packs[4]!.phrases[2].en]);
    expect(pl.items[0]!.album).toBe(packs[2]!.title);
    expect(pl.items.some((i) => i.chat)).toBe(false); // revisão não tem cena (frases de pacotes diferentes)
  });

  test("revisão limita a 15 e fica vazia sem frases dominadas", () => {
    const progress: Progress = {};
    packs.slice(0, 5).forEach((p, d) =>
      p.phrases.forEach((_, i) => (progress[phraseId(p, i)] = { box: 1, due: "2026-12-01", at: `2026-11-${String(d + 1).padStart(2, "0")}` })),
    );
    const ids = reviewIds(progress);
    expect(ids.length).toBe(REVIEW_SIZE);
    expect(ids[0]!.startsWith(`${packs[4]!.id}:`)).toBe(true); // o pacote aprendido por último vem antes
    expect(buildPlaylist({ source: "review", progress: {} }, "enpt")).toEqual({ title: "Revisão", items: [], tracks: [] });
  });

  test("pular de frase: firstTrackOf e lista de arquivos sem repetição", () => {
    const pl = buildPlaylist({ source: "pack", packIndex: 0 }, "enpt");
    expect(firstTrackOf(pl, 0)).toBe(0);
    expect(firstTrackOf(pl, 1)).toBe(6);
    expect(firstTrackOf(pl, 99)).toBe(pl.tracks.length);
    const files = playlistFiles(pl);
    expect(new Set(files).size).toBe(files.length);
    expect(files).toContain(SILENCE.short);
    expect(files).toContain(SILENCE.long);
  });
});

describe("áudio em português", () => {
  test("ptAudioFile: mesmo hash do inglês, em outra pasta, ignorando colchetes, caixa e espaços", () => {
    expect(ptAudioFile("Bora tomar um café?")).toMatch(/^audio-pt\/[0-9a-f]{8}\.m4a$/);
    expect(ptAudioFile("Bora tomar um café?")).toBe(ptAudioFile("  bora  TOMAR um café? "));
    expect(ptAudioFile("Bora [tomar] um café?")).toBe(ptAudioFile("Bora tomar um café?"));
    expect(ptAudioFile("Bora tomar um café?")).not.toBe(ptAudioFile("Bora tomar um chá?"));
    expect(ptAudioFile("ok").replace("audio-pt/", "")).toBe(audioFile("ok").replace("audio/", ""));
  });
});
