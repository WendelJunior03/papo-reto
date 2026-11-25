/**
 * Salas ao vivo de ponta a ponta no servidor local (o mesmo do `bun dev`):
 * cria a sala pela API, entra com dois usuários por WebSocket, fala, leva aviso e sai quitado.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { handleApi, type ApiConfig } from "../server/api";
import { bunDb } from "../server/db-bun";
import { localRooms, UPGRADED } from "../server/rooms-local";
import { decodeFrame, encodeFrame } from "../src/lib/room-wire";
import type { ServerMsg } from "../server/room-core";

const rooms = localRooms();
const cfg: ApiConfig = { db: bunDb(":memory:"), signupCode: "convite", rooms: rooms.host };
const server = Bun.serve({
  port: 0,
  websocket: rooms.websocket,
  async fetch(req) {
    const res = await handleApi(req, cfg);
    if (res === UPGRADED) return;
    return res ?? new Response("nada", { status: 404 });
  },
});
rooms.bind(server);
const base = `http://localhost:${server.port}`;

async function signup(username: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "senha-boa-123", code: "convite" }),
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

interface Client {
  ws: WebSocket;
  msgs: ServerMsg[];
  binary: Uint8Array[];
  closed: Promise<number>;
  next(t: ServerMsg["t"]): Promise<ServerMsg>;
}

function connect(code: string, cookie: string, origin = base): Promise<Client> {
  return new Promise((resolve, reject) => {
    // O WebSocket do Bun aceita cabeçalhos (o do navegador manda o cookie sozinho).
    const ws = new WebSocket(`ws://localhost:${server.port}/api/rooms/${code}/ws`, { headers: { cookie, origin } } as never);
    ws.binaryType = "arraybuffer";
    const msgs: ServerMsg[] = [];
    const binary: Uint8Array[] = [];
    const waiting: { t: string; fn: (m: ServerMsg) => void }[] = [];
    let closedFn: (code: number) => void = () => {};
    const closed = new Promise<number>((r) => (closedFn = r));
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return void binary.push(new Uint8Array(e.data as ArrayBuffer));
      if (e.data === "pong") return;
      const m = JSON.parse(e.data) as ServerMsg;
      msgs.push(m);
      const i = waiting.findIndex((w) => w.t === m.t);
      if (i >= 0) waiting.splice(i, 1)[0]!.fn(m);
    };
    ws.onclose = (e) => closedFn(e.code);
    const client: Client = {
      ws,
      msgs,
      binary,
      closed,
      next: (t) => {
        const seen = msgs.findIndex((m) => m.t === t);
        if (seen >= 0) return Promise.resolve(msgs.splice(seen, 1)[0]!);
        return new Promise((r) => waiting.push({ t, fn: (m) => (msgs.splice(msgs.indexOf(m), 1), r(m)) }));
      },
    };
    ws.onopen = () => resolve(client);
    ws.onerror = () => reject(new Error("ws falhou"));
  });
}

let ana = "";
let bia = "";
beforeAll(async () => {
  ana = await signup("ana");
  bia = await signup("bia");
});
afterAll(() => void server.stop(true));

async function createRoom(cookie: string, body: unknown) {
  const res = await fetch(`${base}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as { code?: string; error?: string } };
}

describe("API das salas", () => {
  test("criar exige login e dados válidos", async () => {
    expect((await createRoom("", { size: 2, level: "nativo" })).status).toBe(401);
    expect((await createRoom(ana, { size: 3, level: "nativo" })).status).toBe(400);
    expect((await createRoom(ana, { size: 2, level: "expert" })).status).toBe(400);
    const ok = await createRoom(ana, { size: 2, level: "nativo" });
    expect(ok.status).toBe(201);
    expect(ok.data.code).toMatch(/^[A-Z2-9]{8}$/);
  });

  test("WebSocket sem login, de outro site ou com código inválido é recusado", async () => {
    const plain = (path: string, headers: Record<string, string>) =>
      fetch(`${base}${path}`, { headers: { upgrade: "websocket", connection: "upgrade", ...headers } });
    expect((await plain("/api/rooms/ABCDEFGH/ws", {})).status).toBe(401);
    expect((await plain("/api/rooms/ABCDEFGH/ws", { cookie: ana, origin: "https://malvado.example" })).status).toBe(403);
    expect((await plain("/api/rooms/abc/ws", { cookie: ana })).status).toBe(400);
  });

  test("sala que não existe responde e fecha", async () => {
    const c = await connect("ZZZZZZZZ", ana);
    expect(await c.next("error")).toMatchObject({ code: "notFound" });
    expect(await c.closed).toBe(4004);
  });

  test("conversa de ponta a ponta: palavra, áudio repassado e quitado por português", async () => {
    const { data } = await createRoom(ana, { size: 2, level: "nativo" });
    const a = await connect(data.code!, ana);
    expect(await a.next("welcome")).toMatchObject({ you: "ana" });
    const b = await connect(data.code!, bia);
    expect(await b.next("welcome")).toMatchObject({ you: "bia", room: { phase: "live" } });

    // ana pede a palavra e fala
    a.ws.send(JSON.stringify({ t: "floor" }));
    let st = (await a.next("state")) as Extract<ServerMsg, { t: "state" }>;
    while (!st.room.floor) st = (await a.next("state")) as typeof st;
    expect(st.room.floor.name).toBe("ana");
    a.ws.send(encodeFrame({ t: "turn", id: st.room.floor.id, text: "Hello, how are you?", mime: "audio/mp4" }, new Uint8Array([1, 2, 3])));
    const turn = (await b.next("turn")) as Extract<ServerMsg, { t: "turn" }>;
    expect(turn.entry).toMatchObject({ name: "ana", text: "Hello, how are you?", pt: false });
    // o áudio chegou na bia (e não voltou pra ana)
    await Bun.sleep(30);
    expect(b.binary).toHaveLength(1);
    const frame = decodeFrame(b.binary[0]!);
    expect(frame?.header).toMatchObject({ t: "audio", name: "ana", mime: "audio/mp4" });
    expect([...frame!.audio]).toEqual([1, 2, 3]);
    expect(a.binary).toHaveLength(0);

    // bia fala português no nível Nativo: quitada na hora, e a sala de 2 acaba
    b.ws.send(JSON.stringify({ t: "floor" }));
    let sb = (await b.next("state")) as Extract<ServerMsg, { t: "state" }>;
    while (sb.room.floor?.name !== "bia") sb = (await b.next("state")) as typeof sb;
    b.ws.send(encodeFrame({ t: "turn", id: sb.room.floor.id, text: "beleza, tudo bem", mime: "audio/mp4" }, new Uint8Array([4])));
    expect(await b.next("kicked")).toEqual({ t: "kicked", name: "bia", you: true });
    expect(await b.closed).toBe(4001);
    expect(await a.next("summary")).toMatchObject({ summary: { reason: "alone" } });
    expect(await a.closed).toBe(4002);

    // bia não volta (sala encerrada: recebe o resumo e fecha)
    const again = await connect(data.code!, bia);
    expect(await again.next("error")).toMatchObject({ code: "ended" });
  });

  test("ping é respondido sem mexer na sala", async () => {
    const { data } = await createRoom(ana, { size: 4, level: "iniciante" });
    const a = await connect(data.code!, ana);
    await a.next("welcome");
    const pong = new Promise<string>((r) => a.ws.addEventListener("message", (e) => typeof e.data === "string" && e.data === "pong" && r(e.data)));
    a.ws.send("ping");
    expect(await pong).toBe("pong");
    a.ws.close();
  });
});
