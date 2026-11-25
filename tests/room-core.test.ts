import { describe, expect, test } from "bun:test";
import {
  CLOSE, CODE_RE, createRoom, deliver, disconnect, handleMessage, handleTurn, join, MAX_AUDIO_BYTES, MAX_TURN_MS,
  newRoomCode, nextAlarm, normalizeCode, RATE_MAX, ROOM_MS, STRIKES, tick, TURN_GAP_MS, TURN_GRACE_MS, WAIT_MS,
  type Out, type Peer, type Result, type RoomLevel, type RoomState, type ServerMsg,
} from "../server/room-core";
import { decodeFrame, encodeFrame } from "../src/lib/room-wire";

const T0 = 1_700_000_000_000;
const ana = { id: 1, name: "ana" };
const bia = { id: 2, name: "bia" };
const caio = { id: 3, name: "caio" };
const duda = { id: 4, name: "duda" };
const eva = { id: 5, name: "eva" };
const rng = () => 0;

function room(size: 2 | 4 = 2, level: RoomLevel = "iniciante"): RoomState {
  return createRoom({ code: "ABCDEFGH", size, level, creator: ana }, T0);
}

const asResult = (r: ReturnType<typeof join>): Result => {
  if (!r.ok || !("out" in r)) throw new Error(`join recusado: ${"code" in r ? r.code : ""}`);
  return r;
};

/** Mensagens que chegariam numa conexão. */
const msgs = (out: Out[], conn: string): ServerMsg[] =>
  out.flatMap((o) => (o.kind === "send" && o.conns.includes(conn) ? [o.msg] : []));
const types = (out: Out[], conn: string) => msgs(out, conn).map((m) => m.t);
const send = (s: RoomState, uid: number, msg: unknown, now: number) => handleMessage(s, uid, JSON.stringify(msg), now, rng);
const turnHeader = (id: number, text: string, extra: Record<string, unknown> = {}) => ({ t: "turn", id, text, mime: "audio/mp4", ...extra });

/** Sala de 2 já começada (ana e bia dentro). */
function live(level: RoomLevel = "iniciante", size: 2 | 4 = 2): RoomState {
  const s = room(size, level);
  asResult(join(s, ana, "c-ana", T0, rng));
  asResult(join(s, bia, "c-bia", T0 + 1, rng));
  if (size === 4) {
    asResult(join(s, caio, "c-caio", T0 + 2, rng));
    asResult(join(s, duda, "c-duda", T0 + 3, rng));
  }
  return s;
}

/** ana pega a palavra e fala `text`. */
function speak(s: RoomState, user: { id: number }, text: string, at: number, bytes = 1000): Result {
  const g = send(s, user.id, { t: "floor" }, at);
  expect(g.ok).toBe(true);
  return handleTurn(s, user.id, turnHeader(s.floor!.id, text), bytes, at + 1500);
}

describe("código da sala", () => {
  test("8 letras do alfabeto sem ambiguidade, diferentes a cada vez", () => {
    const codes = new Set(Array.from({ length: 200 }, () => newRoomCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) expect(CODE_RE.test(c)).toBe(true);
    expect([...codes].join("")).not.toMatch(/[01IOL]/);
  });
  test("aceita o que a pessoa digita", () => {
    expect(normalizeCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeCode(" ABCD EFGH ")).toBe("ABCDEFGH");
    expect(normalizeCode("ABCDEFG")).toBeNull();
    expect(normalizeCode("ABCDEFG0")).toBeNull();
    expect(normalizeCode("../../etc")).toBeNull();
  });
});

describe("entrar na sala", () => {
  test("quem entra recebe as boas-vindas e os outros veem a sala atualizada", () => {
    const s = room();
    const r1 = asResult(join(s, ana, "c-ana", T0, rng));
    expect(types(r1.out, "c-ana")).toEqual(["welcome"]);
    const r2 = asResult(join(s, bia, "c-bia", T0 + 1, rng));
    expect(types(r2.out, "c-bia")).toEqual(["welcome"]);
    expect(types(r2.out, "c-ana")).toEqual(["state"]);
  });

  test("sala de 2 começa sozinha quando enche, com 10 minutos", () => {
    const s = live();
    expect(s.phase).toBe("live");
    expect(s.startedAt).toBe(T0 + 1);
    expect(s.endsAt).toBe(T0 + 1 + ROOM_MS);
  });

  test("não passa do limite de pessoas", () => {
    const s = live();
    const r = join(s, caio, "c-caio", T0 + 5, rng);
    expect(r.ok).toBe(false);
    expect("code" in r && r.code).toBe("full");
    expect(s.members).toHaveLength(2);
  });

  test("sala de 4: só começa cheia ou quando quem criou toca em Começar", () => {
    const s = room(4);
    asResult(join(s, ana, "c-ana", T0, rng));
    expect(send(s, ana.id, { t: "start" }, T0 + 1).ok).toBe(false); // sozinha não dá
    asResult(join(s, bia, "c-bia", T0 + 2, rng));
    expect(send(s, bia.id, { t: "start" }, T0 + 3).ok).toBe(false); // bia não criou
    expect(s.phase).toBe("waiting");
    expect(send(s, ana.id, { t: "start" }, T0 + 4).ok).toBe(true);
    expect(s.phase).toBe("live");
    // depois de começar ainda dá pra entrar, se houver vaga
    expect(join(s, caio, "c-caio", T0 + 5, rng).ok).toBe(true);
    expect(join(s, duda, "c-duda", T0 + 6, rng).ok).toBe(true);
    expect(join(s, eva, "c-eva", T0 + 7, rng).ok).toBe(false);
  });

  test("reconectar (rede caiu, outra aba) derruba a conexão antiga e mantém a pessoa", () => {
    const s = live();
    const r = asResult(join(s, ana, "c-ana-2", T0 + 10, rng));
    expect(r.out).toContainEqual({ kind: "close", conn: "c-ana", code: CLOSE.replaced, reason: "aberta em outro lugar" });
    expect(s.members).toHaveLength(2);
    expect(s.members[0]!.conn).toBe("c-ana-2");
    // o "fechou" atrasado da conexão antiga não derruba a nova
    expect(disconnect(s, ana.id, "c-ana", T0 + 11).changed).toBe(false);
    expect(s.members[0]!.online).toBe(true);
  });

  test("sair antes de começar libera a vaga e passa a sala adiante", () => {
    const s = room(4);
    asResult(join(s, ana, "c-ana", T0, rng));
    asResult(join(s, bia, "c-bia", T0 + 1, rng));
    const r = send(s, ana.id, { t: "leave" }, T0 + 2);
    expect(r.out).toContainEqual({ kind: "close", conn: "c-ana", code: CLOSE.left, reason: "saiu" });
    expect(s.members.map((m) => m.name)).toEqual(["bia"]);
    expect(s.creatorId).toBe(bia.id);
  });

  test("sala encerrada devolve o resumo em vez de entrar", () => {
    const s = live();
    tick(s, T0 + 1 + ROOM_MS);
    const r = join(s, ana, "c-ana-3", T0 + ROOM_MS + 5, rng);
    expect(r.ok).toBe(false);
    expect("code" in r && r.code).toBe("ended");
    expect("summary" in r && r.summary?.members).toHaveLength(2);
  });
});

describe("a palavra (walkie-talkie)", () => {
  test("só uma pessoa fala por vez", () => {
    const s = live();
    expect(send(s, ana.id, { t: "floor" }, T0 + 100).ok).toBe(true);
    const denied = send(s, bia.id, { t: "floor" }, T0 + 200);
    expect(denied.ok).toBe(false);
    expect(msgs(denied.out, "c-bia")).toEqual([{ t: "denied", reason: "ana está falando." }]);
    expect(s.floor?.userId).toBe(ana.id);
  });

  test("soltar libera pra outra pessoa", () => {
    const s = live();
    send(s, ana.id, { t: "floor" }, T0 + 100);
    send(s, ana.id, { t: "release" }, T0 + 400);
    expect(s.floor).toBeNull();
    expect(send(s, bia.id, { t: "floor" }, T0 + 500).ok).toBe(true);
  });

  test("antes de começar não tem palavra", () => {
    const s = room(4);
    asResult(join(s, ana, "c-ana", T0, rng));
    expect(send(s, ana.id, { t: "floor" }, T0 + 1).ok).toBe(false);
  });

  test("no máximo uma fala a cada 2 segundos", () => {
    const s = live();
    speak(s, ana, "hello there", T0 + 100);
    expect(send(s, ana.id, { t: "floor" }, T0 + 100 + TURN_GAP_MS - 1).ok).toBe(false);
    expect(send(s, ana.id, { t: "floor" }, T0 + 100 + TURN_GAP_MS).ok).toBe(true);
  });

  test("quem estava falando e caiu solta a palavra", () => {
    const s = live();
    send(s, ana.id, { t: "floor" }, T0 + 100);
    const r = disconnect(s, ana.id, "c-ana", T0 + 200);
    expect(s.floor).toBeNull();
    expect(types(r.out, "c-bia")).toEqual(["state"]);
    expect(s.members[0]!.online).toBe(false);
  });

  test("palavra presa (o áudio nunca chegou) é solta pelo relógio", () => {
    const s = live();
    send(s, ana.id, { t: "floor" }, T0 + 100);
    expect(nextAlarm(s)).toBe(T0 + 100 + MAX_TURN_MS + TURN_GRACE_MS);
    expect(tick(s, T0 + 100 + MAX_TURN_MS).changed).toBe(false);
    expect(tick(s, T0 + 100 + MAX_TURN_MS + TURN_GRACE_MS).changed).toBe(true);
    expect(s.floor).toBeNull();
  });
});

describe("falas", () => {
  test("repassa o áudio só pros outros e a transcrição pra todos", () => {
    const s = live("iniciante", 4);
    const r = speak(s, ana, "I love pizza", T0 + 100);
    const audio = r.out.find((o) => o.kind === "audio");
    expect(audio).toEqual({ kind: "audio", conns: ["c-bia", "c-caio", "c-duda"], header: { t: "audio", id: 1, name: "ana", mime: "audio/mp4" } });
    for (const c of ["c-ana", "c-bia", "c-caio", "c-duda"]) expect(types(r.out, c)).toContain("turn");
    const m = s.members[0]!;
    expect([m.turns, m.words, m.talkMs]).toEqual([1, 3, 1500]);
    expect(s.floor).toBeNull();
  });

  test("tempo de fala conta no máximo 15 s", () => {
    const s = live();
    send(s, ana.id, { t: "floor" }, T0 + 100);
    handleTurn(s, ana.id, turnHeader(s.floor!.id, "long story"), 1000, T0 + 100 + MAX_TURN_MS + 3000);
    expect(s.members[0]!.talkMs).toBe(MAX_TURN_MS);
  });

  test("sem transcrição o áudio vai mesmo assim", () => {
    const s = live();
    const r = speak(s, ana, "", T0 + 100);
    expect(r.out.some((o) => o.kind === "audio")).toBe(true);
    expect(s.members[0]!.turns).toBe(1);
    expect(s.members[0]!.strikes).toBe(0);
  });

  test("recusa fala de quem não tem a palavra, de vez antiga ou grande demais", () => {
    const s = live();
    send(s, ana.id, { t: "floor" }, T0 + 100);
    const id = s.floor!.id;
    expect(handleTurn(s, bia.id, turnHeader(id, "hi"), 100, T0 + 200).ok).toBe(false);
    expect(handleTurn(s, ana.id, turnHeader(id + 7, "hi"), 100, T0 + 200).ok).toBe(false);
    expect(handleTurn(s, ana.id, turnHeader(id, "hi"), MAX_AUDIO_BYTES + 1, T0 + 200).ok).toBe(false);
    expect(s.floor?.userId).toBe(ana.id);
  });

  test("cabeçalho malformado é recusado (zod)", () => {
    const s = live();
    send(s, ana.id, { t: "floor" }, T0 + 100);
    const id = s.floor!.id;
    expect(handleTurn(s, ana.id, { t: "turn", id, text: "x".repeat(601), mime: "audio/mp4" }, 10, T0 + 200).ok).toBe(false);
    expect(handleTurn(s, ana.id, { t: "turn", id, text: "hi", mime: "text/html" }, 10, T0 + 200).ok).toBe(false);
    expect(handleTurn(s, ana.id, { t: "turn", id: "1", text: "hi", mime: "audio/mp4" }, 10, T0 + 200).ok).toBe(false);
    expect(handleTurn(s, ana.id, null, 10, T0 + 200).ok).toBe(false);
    expect(handleTurn(s, ana.id, { t: "turn", id, text: "hi", mime: "audio/webm;codecs=opus" }, 10, T0 + 200).ok).toBe(true);
  });

  test("guarda só as últimas 60 falas (texto)", () => {
    const s = live("nativo");
    for (let i = 0; i < 70; i++) speak(s, i % 2 ? bia : ana, `line ${i}`, T0 + 100 + i * 4000);
    expect(s.log).toHaveLength(60);
    expect(s.log[0]!.text).toBe("line 10");
  });
});

describe("avisos por falar português", () => {
  test.each([
    ["iniciante", 3],
    ["intermediario", 2],
    ["nativo", 1],
  ] as const)("%s: sai no aviso %i", (level, max) => {
    expect(STRIKES[level]).toBe(max);
    const s = live(level, 4);
    let at = T0 + 100;
    for (let i = 1; i < max; i++) {
      const r = speak(s, bia, "tipo, não sei", at);
      expect(msgs(r.out, "c-bia")).toContainEqual({ t: "strike", name: "bia", strikes: i, max });
      expect(s.members[1]!.kicked).toBe(false);
      at += 3000;
    }
    const r = speak(s, bia, "obrigado gente", at);
    expect(msgs(r.out, "c-bia")).toContainEqual({ t: "kicked", name: "bia", you: true });
    expect(msgs(r.out, "c-ana")).toContainEqual({ t: "kicked", name: "bia", you: false });
    expect(r.out).toContainEqual({ kind: "close", conn: "c-bia", code: CLOSE.kicked, reason: "quitado" });
    expect(s.members[1]!.kicked).toBe(true);
    expect(s.phase).toBe("live"); // ainda tem 3 na sala
  });

  test("inglês não dá aviso", () => {
    const s = live("nativo");
    speak(s, ana, "No, I don't think so. Do you want to come?", T0 + 100);
    expect(s.members[0]!.strikes).toBe(0);
  });

  test("o servidor decide (o palpite do aparelho não conta)", () => {
    const s = live("nativo");
    send(s, ana.id, { t: "floor" }, T0 + 100);
    handleTurn(s, ana.id, turnHeader(s.floor!.id, "Hello friends", { pt: true }), 100, T0 + 900);
    expect(s.members[0]!.strikes).toBe(0);
  });

  test("quem foi quitado não volta pra sala", () => {
    const s = live("nativo", 4);
    speak(s, bia, "beleza", T0 + 100);
    const r = join(s, bia, "c-bia-2", T0 + 5000, rng);
    expect(r.ok).toBe(false);
    expect("code" in r && r.code).toBe("banned");
    // nem consegue mandar nada
    expect(send(s, bia.id, { t: "floor" }, T0 + 6000).ok).toBe(false);
    // e a vaga dele libera pra outra pessoa
    expect(join(s, eva, "c-eva", T0 + 7000, rng).ok).toBe(true);
  });

  test("sala de 2: se um sai quitado, a sala acaba (não dá pra conversar sozinho)", () => {
    const s = live("nativo");
    const r = speak(s, bia, "valeu", T0 + 100);
    expect(s.phase).toBe("ended");
    expect(s.endReason).toBe("alone");
    expect(types(r.out, "c-ana")).toContain("summary");
    expect(types(r.out, "c-bia")).not.toContain("summary");
    expect(r.out.some((o) => o.kind === "closeAll")).toBe(true);
  });
});

describe("tempo e resumo", () => {
  test("aos 10 minutos todo mundo recebe o resumo e a sala fecha", () => {
    const s = live("intermediario");
    speak(s, ana, "Hi there, how are you", T0 + 100);
    speak(s, bia, "Great, thanks", T0 + 4000);
    speak(s, ana, "tipo, cool", T0 + 8000);
    expect(nextAlarm(s)).toBe(T0 + 1 + ROOM_MS);
    expect(tick(s, T0 + ROOM_MS).changed).toBe(false);
    const r = tick(s, T0 + 1 + ROOM_MS);
    expect(s.phase).toBe("ended");
    const sum = msgs(r.out, "c-ana").find((m) => m.t === "summary");
    expect(sum).toEqual({
      t: "summary",
      summary: {
        code: "ABCDEFGH",
        level: "intermediario",
        reason: "time",
        durationMs: ROOM_MS,
        members: [
          { name: "ana", turns: 2, words: 7, talkMs: 3000, strikes: 1, kicked: false },
          { name: "bia", turns: 1, words: 2, talkMs: 1500, strikes: 0, kicked: false },
        ],
      },
    });
    expect(types(r.out, "c-bia")).toContain("summary");
    expect(r.out.at(-1)).toEqual({ kind: "closeAll", code: CLOSE.ended, reason: "sala encerrada" });
    expect(nextAlarm(s)).toBeNull();
    // depois de encerrada, nada mais muda
    expect(send(s, ana.id, { t: "floor" }, T0 + ROOM_MS + 10).ok).toBe(false);
  });

  test("sala que ninguém começou expira", () => {
    const s = room(4);
    asResult(join(s, ana, "c-ana", T0, rng));
    expect(nextAlarm(s)).toBe(T0 + WAIT_MS);
    tick(s, T0 + WAIT_MS);
    expect(s.phase).toBe("ended");
    expect(s.endReason).toBe("expired");
  });
});

describe("mensagens e limites", () => {
  test("ignora lixo, tipos desconhecidos e mensagens grandes", () => {
    const s = live();
    expect(handleMessage(s, ana.id, "not json", T0 + 10).ok).toBe(false);
    expect(handleMessage(s, ana.id, JSON.stringify({ t: "hack" }), T0 + 10).ok).toBe(false);
    expect(handleMessage(s, ana.id, JSON.stringify({ t: "ping", pad: "x".repeat(600) }), T0 + 10).ok).toBe(false);
    expect(handleMessage(s, 99, JSON.stringify({ t: "ping" }), T0 + 10).ok).toBe(false);
  });

  test("limite de mensagens por pessoa", () => {
    const s = live();
    for (let i = 0; i < RATE_MAX; i++) expect(send(s, ana.id, { t: "ping" }, T0 + 10 + i).ok).toBe(true);
    expect(send(s, ana.id, { t: "ping" }, T0 + 100).ok).toBe(false);
    // bia não é afetada
    expect(send(s, bia.id, { t: "ping" }, T0 + 100).ok).toBe(true);
    // passou a janela, volta
    expect(send(s, ana.id, { t: "ping" }, T0 + 10 + 10_000).ok).toBe(true);
  });

  test("trocar de tema só no intermediário", () => {
    const s = live("intermediario");
    const before = s.topic;
    expect(send(s, ana.id, { t: "topic" }, T0 + 100).ok).toBe(true);
    expect(s.topic).not.toBe(before);
    const n = live("nativo");
    expect(send(n, ana.id, { t: "topic" }, T0 + 100).ok).toBe(false);
  });

  test("o que vai pro aparelho não leva id interno dos usuários", () => {
    const s = live();
    const r = asResult(join(s, ana, "c-ana-9", T0 + 50, rng));
    const welcome = JSON.stringify(msgs(r.out, "c-ana-9")[0]);
    expect(welcome).not.toContain('"id":1,"name"');
    expect(welcome).not.toContain("conn");
    expect(welcome).not.toContain("c-bia");
  });
});

describe("entrega e quadro binário", () => {
  test("quadro: cabeçalho e áudio vão e voltam iguais", () => {
    const audio = new Uint8Array([1, 2, 3, 250]);
    const back = decodeFrame(encodeFrame({ t: "turn", id: 3, text: "hi" }, audio));
    expect(back?.header).toEqual({ t: "turn", id: 3, text: "hi" });
    expect([...back!.audio]).toEqual([1, 2, 3, 250]);
    expect(decodeFrame(new Uint8Array([0, 0, 0]))).toBeNull();
    expect(decodeFrame(new Uint8Array([0, 0, 0xff, 0xff, 1]))).toBeNull();
  });

  test("deliver manda cada coisa pra conexão certa", () => {
    const s = live("iniciante", 4);
    const got: Record<string, (string | Uint8Array)[]> = {};
    const closed: string[] = [];
    const peers: Peer[] = ["c-ana", "c-bia", "c-caio", "c-duda", "c-estranho"].map((conn) => ({
      conn,
      send: (d) => (got[conn] ??= []).push(d),
      close: () => closed.push(conn),
    }));
    send(s, ana.id, { t: "floor" }, T0 + 100);
    const r = handleTurn(s, ana.id, turnHeader(s.floor!.id, "hello"), 3, T0 + 500);
    deliver(r.out, peers, new Uint8Array([9, 9, 9]), encodeFrame);
    expect(got["c-ana"]!.some((d) => typeof d !== "string")).toBe(false);
    expect(got["c-bia"]!.filter((d) => typeof d !== "string")).toHaveLength(1);
    expect(got["c-estranho"]).toBeUndefined();
    expect(closed).toEqual([]);
  });
});
