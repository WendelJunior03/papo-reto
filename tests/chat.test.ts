import { afterAll, describe, expect, mock, test } from "bun:test";

// Captura o pedido que iria pra API, sem chamar a Anthropic de verdade.
let sent: { messages: { role: string; content: string }[]; model: string } | null = null;
mock.module("@anthropic-ai/sdk", () => {
  class Anthropic {
    static APIError = class extends Error {};
    static AuthenticationError = class extends Error {};
    static RateLimitError = class extends Error {};
    static APIConnectionError = class extends Error {};
    beta = {
      messages: {
        parse: async (params: typeof sent) => {
          sent = params;
          return { stop_reason: "end_turn", parsed_output: { reply: "Hey!", reply_pt: "Oi!", correction: null, correction_note: null } };
        },
      },
    };
  }
  return { default: Anthropic };
});
const { handleChat } = await import("../server/chat");
afterAll(() => mock.restore());

const scenario = { title: "Começando o dia", scene: "Na cafeteria", phrases: ["Can I get a large coffee to go?"] };
const post = (body: unknown) => handleChat(new Request("http://x/api/chat", { method: "POST", body: JSON.stringify(body) }), "test-key");

describe("rota /api/chat", () => {
  test("conversa vazia: a IA abre, com um pedido de usuário na frente", async () => {
    const res = await post({ scenario, messages: [] });
    expect(res.status).toBe(200);
    expect(sent!.messages[0]!.role).toBe("user");
  });
  test("histórico começando pela IA ganha o pedido inicial na frente", async () => {
    await post({ scenario, messages: [{ role: "assistant", content: "Hey!" }, { role: "user", content: "hi" }] });
    expect(sent!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
  test("recusa pedido malformado ou mensagem longa demais", async () => {
    expect((await post({ nope: 1 })).status).toBe(400);
    expect((await post({ scenario, messages: [{ role: "user", content: "x".repeat(601) }] })).status).toBe(400);
  });
  test("usa o Claude Opus 5", async () => {
    await post({ scenario, messages: [] });
    expect(sent!.model).toBe("claude-opus-5");
  });
});
