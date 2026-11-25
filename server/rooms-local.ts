/**
 * Salas ao vivo no `bun dev` e no `bun preview`: as salas ficam na memória do processo e usam
 * a mesma máquina de estados (room-core) que o Durable Object usa no Cloudflare.
 * Reiniciou o servidor, as salas somem (igual a uma sala que acabou).
 */
import type { ServerWebSocket, WebSocketHandler } from "bun";
import type { RoomsHost } from "./api";
import {
  CLOSE, createRoom, deliver, disconnect, handleMessage, handleTurn, join, MAX_AUDIO_BYTES, nextAlarm, tick,
  type Peer, type Result, type RoomState, type ServerMsg,
} from "./room-core";
import { decodeFrame, encodeFrame, MAX_HEADER_BYTES } from "../src/lib/room-wire";

interface WsData {
  code: string;
  userId: number;
  name: string;
  conn: string;
}

interface LocalRoom {
  s: RoomState;
  sockets: Set<ServerWebSocket<WsData>>;
  timer?: ReturnType<typeof setTimeout>;
}

/** Quanto tempo a sala encerrada fica na memória (pra quem reconectar ver o resumo). */
const KEEP_MS = 10 * 60_000;

/** Resposta-sentinela: o Bun já virou a conexão em WebSocket; o fetch do servidor devolve undefined. */
export const UPGRADED = new Response(null, { status: 204 });

interface Upgrader {
  upgrade(req: Request, opts: { data: WsData }): boolean;
}

export function localRooms(): { host: RoomsHost; websocket: WebSocketHandler<WsData>; bind(server: Upgrader): void } {
  const rooms = new Map<string, LocalRoom>();
  let server: Upgrader | null = null;

  const peers = (r: LocalRoom): Peer[] =>
    [...r.sockets].map((ws) => ({
      conn: ws.data.conn,
      send: (d) => void ws.send(d),
      close: (code, reason) => ws.close(code, reason),
    }));

  function schedule(code: string, r: LocalRoom): void {
    clearTimeout(r.timer);
    const at = r.s.phase === "ended" ? (r.s.endedAt ?? Date.now()) + KEEP_MS : nextAlarm(r.s);
    if (at === null) return;
    r.timer = setTimeout(() => {
      if (r.s.phase === "ended") return void rooms.delete(code);
      apply(code, r, tick(r.s, Date.now()));
    }, Math.max(0, at - Date.now()) + 5);
    // O relógio da sala não segura o processo aberto (testes, Ctrl+C).
    (r.timer as { unref?: () => void }).unref?.();
  }

  function apply(code: string, r: LocalRoom, res: Result, audio?: Uint8Array): void {
    deliver(res.out, peers(r), audio, encodeFrame);
    schedule(code, r);
  }

  const refuse = (ws: ServerWebSocket<WsData>, msg: Extract<ServerMsg, { t: "error" }>, summary?: ServerMsg): void => {
    if (summary) ws.send(JSON.stringify(summary));
    ws.send(JSON.stringify(msg));
    ws.close(CLOSE[msg.code], msg.code);
  };

  const host: RoomsHost = {
    async create(init) {
      if (rooms.has(init.code)) return false;
      const r: LocalRoom = { s: createRoom(init, Date.now()), sockets: new Set() };
      rooms.set(init.code, r);
      schedule(init.code, r);
      return true;
    },
    async connect(req, code, user) {
      const data: WsData = { code, userId: user.id, name: user.username, conn: crypto.randomUUID() };
      if (server?.upgrade(req, { data })) return UPGRADED;
      return new Response(JSON.stringify({ error: "Não deu pra abrir a sala." }), { status: 400 });
    },
  };

  const websocket: WebSocketHandler<WsData> = {
    maxPayloadLength: 4 + MAX_HEADER_BYTES + MAX_AUDIO_BYTES,
    open(ws) {
      const r = rooms.get(ws.data.code);
      if (!r) return refuse(ws, { t: "error", code: "notFound", message: "Sala não encontrada. Confira o código." });
      const res = join(r.s, { id: ws.data.userId, name: ws.data.name }, ws.data.conn, Date.now());
      if (!res.ok && "code" in res) {
        return refuse(ws, { t: "error", code: res.code, message: res.message }, res.summary && { t: "summary", summary: res.summary });
      }
      r.sockets.add(ws);
      apply(ws.data.code, r, res as Result);
    },
    message(ws, msg) {
      const r = rooms.get(ws.data.code);
      if (!r || !r.sockets.has(ws)) return;
      // Conexão antiga (reabriu em outra aba) não fala mais pela pessoa.
      if (r.s.members.find((m) => m.id === ws.data.userId)?.conn !== ws.data.conn) return;
      const now = Date.now();
      if (msg === "ping") return void ws.send("pong"); // igual à resposta automática do Durable Object
      if (typeof msg === "string") return apply(ws.data.code, r, handleMessage(r.s, ws.data.userId, msg, now));
      const frame = decodeFrame(msg);
      if (!frame) return;
      apply(ws.data.code, r, handleTurn(r.s, ws.data.userId, frame.header, frame.audio.length, now), frame.audio);
    },
    close(ws) {
      const r = rooms.get(ws.data.code);
      if (!r || !r.sockets.delete(ws)) return;
      apply(ws.data.code, r, disconnect(r.s, ws.data.userId, ws.data.conn, Date.now()));
    },
  };

  return { host, websocket, bind: (s) => void (server = s) };
}
