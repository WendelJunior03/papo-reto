/**
 * Durable Object de uma Sala ao vivo (um por código). Embrulha a máquina de estados pura
 * (server/room-core.ts) com a API de hibernação de WebSocket: a sala "dorme" entre uma fala
 * e outra sem cobrar tempo, e acorda com o estado salvo no armazenamento (SQLite) do próprio objeto.
 *
 * Só o Worker fala com ele (nunca é público): o login já foi conferido, e quem é a pessoa
 * vem no cabeçalho x-room-user. O áudio é repassado na hora e nunca é guardado.
 */
import {
  CLOSE, createRoom, deliver, disconnect, handleMessage, handleTurn, join, nextAlarm, tick,
  type Peer, type Result, type RoomInit, type RoomState, type ServerMsg,
} from "../server/room-core";
import { decodeFrame, encodeFrame } from "../src/lib/room-wire";

/* Tipos mínimos do runtime do Cloudflare (o projeto não usa @cloudflare/workers-types). */
interface CfWebSocket {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
interface DurableObjectState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    deleteAll(): Promise<void>;
    setAlarm(time: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
  acceptWebSocket(ws: CfWebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): CfWebSocket[];
  setWebSocketAutoResponse(pair: unknown): void;
}
declare const WebSocketPair: new () => { 0: CfWebSocket; 1: CfWebSocket };
declare const WebSocketRequestResponsePair: new (request: string, response: string) => unknown;

export interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

interface Attachment {
  userId: number;
  conn: string;
}

/** Quanto tempo a sala encerrada fica guardada (pra quem reconectar ver o resumo); depois, apagada. */
const KEEP_MS = 10 * 60_000;

export class Room {
  private s: RoomState | null = null;

  constructor(private readonly ctx: DurableObjectState, _env: unknown) {
    // O "ping" que o aparelho manda pra manter a conexão é respondido sem acordar a sala.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    void ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<RoomState>("room")) ?? null;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === "/init" && req.method === "POST") {
      if (this.s) return new Response(null, { status: 409 });
      this.s = createRoom((await req.json()) as RoomInit, Date.now());
      await this.ctx.storage.put("room", this.s);
      await this.schedule();
      return new Response(null, { status: 201 });
    }
    if (pathname !== "/ws") return new Response(null, { status: 404 });

    let user: { id: number; name: string } | null = null;
    try {
      user = JSON.parse(decodeURIComponent(req.headers.get("x-room-user") ?? "")) as { id: number; name: string };
    } catch {
      return new Response(null, { status: 400 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const ws = pair[1];
    const conn = crypto.randomUUID();
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ userId: user.id, conn } satisfies Attachment);

    if (!this.s) {
      this.refuse(ws, { t: "error", code: "notFound", message: "Sala não encontrada. Confira o código." });
    } else {
      const res = join(this.s, user, conn, Date.now());
      if (!res.ok && "code" in res) {
        this.refuse(ws, { t: "error", code: res.code, message: res.message }, res.summary && { t: "summary", summary: res.summary });
      } else {
        await this.apply(res as Result);
      }
    }
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  async webSocketMessage(ws: CfWebSocket, msg: string | ArrayBuffer): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!this.s || !a) return;
    const member = this.s.members.find((m) => m.id === a.userId);
    if (!member || member.conn !== a.conn) return; // conexão antiga ou recusada
    const now = Date.now();
    if (typeof msg === "string") return this.apply(handleMessage(this.s, a.userId, msg, now));
    const frame = decodeFrame(msg);
    if (!frame) return;
    await this.apply(handleTurn(this.s, a.userId, frame.header, frame.audio.length, now), frame.audio);
  }

  async webSocketClose(ws: CfWebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "tchau");
    } catch {
      // já fechada
    }
    await this.dropped(ws);
  }

  async webSocketError(ws: CfWebSocket): Promise<void> {
    await this.dropped(ws);
  }

  async alarm(): Promise<void> {
    if (!this.s) return;
    const now = Date.now();
    if (this.s.phase === "ended") {
      if (now >= (this.s.endedAt ?? 0) + KEEP_MS) {
        await this.ctx.storage.deleteAll();
        this.s = null;
      } else {
        await this.schedule();
      }
      return;
    }
    await this.apply(tick(this.s, now));
  }

  private async dropped(ws: CfWebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!this.s || !a) return;
    await this.apply(disconnect(this.s, a.userId, a.conn, Date.now()));
  }

  private peers(): Peer[] {
    return this.ctx.getWebSockets().map((ws) => ({
      conn: (ws.deserializeAttachment() as Attachment | null)?.conn ?? "",
      send: (d) => ws.send(d),
      close: (code, reason) => ws.close(code, reason),
    }));
  }

  private refuse(ws: CfWebSocket, msg: Extract<ServerMsg, { t: "error" }>, summary?: ServerMsg): void {
    if (summary) ws.send(JSON.stringify(summary));
    ws.send(JSON.stringify(msg));
    ws.close(CLOSE[msg.code], msg.code);
  }

  private async apply(res: Result, audio?: Uint8Array): Promise<void> {
    deliver(res.out, this.peers(), audio, encodeFrame);
    if (res.changed && this.s) await this.ctx.storage.put("room", this.s);
    await this.schedule();
  }

  private async schedule(): Promise<void> {
    if (!this.s) return;
    const at = this.s.phase === "ended" ? (this.s.endedAt ?? Date.now()) + KEEP_MS : nextAlarm(this.s);
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }
}
