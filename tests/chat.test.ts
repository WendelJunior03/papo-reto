import { afterAll, describe, expect, mock, test } from "bun:test";

// Captura o pedido que iria pra cada API, sem chamar Anthropic nem OpenAI de verdade.
let sentAnthropic: { messages: { role: string; content: string }[]; model: string } | null = null;
let sentOpenAI: { messages: { role: string; content: string }[]; model: string } | null = null;
let openaiKey = "";
const reply = { reply: "Hey!", reply_pt: "Oi!", correction: null, correction_note: null };

mock.module("@anthropic-ai/sdk", () => {
  class E extends Error {}
  class Anthropic {
    static APIError = E;
    static AuthenticationError = class extends E {};
    static PermissionDeniedError = class extends E {};
    static NotFoundError = class extends E {};
    static RateLimitError = class extends E {};
    static APIConnectionError = class extends E {};
    beta = {
      messages: {
        parse: async (params: typeof sentAnthropic) => {
          sentAnthropic = params;
          return { stop_reason: "end_turn", parsed_output: reply };
        },
      },
    };
  }
  return { default: Anthropic };
});

mock.module("openai", () => {
  class E extends Error {}
  class OpenAI {
    static APIError = E;
    static AuthenticationError = class extends E {};
    static PermissionDeniedError = class extends E {};
    static NotFoundError = class extends E {};
    static RateLimitError = class extends E {};
    static APIConnectionError = class extends E {};
    constructor(opts: { apiKey: string }) {
      openaiKey = opts.apiKey;
    }
    chat = {
      completions: {
        parse: async (params: typeof sentOpenAI) => {
          sentOpenAI = params;
          return { choices: [{ message: { parsed: reply } }] };
        },
      },
    };
  }
  return { default: OpenAI };
});

const { handleChat, providerFor } = await import("../server/chat");
afterAll(() => mock.restore());

const scenario = { title: "Começando o dia", scene: "Na cafeteria", phrases: ["Can I get a large coffee to go?"] };
const req = (body: unknown) => new Request("http://x/api/chat", { method: "POST", body: JSON.stringify(body) });
const anthropic = { provider: "anthropic" as const, key: "sk-ant-test" };

describe("rota /api/chat", () => {
  test("conversa vazia: a IA abre, com um pedido de usuário na frente", async () => {
    const res = await handleChat(req({ scenario, messages: [] }), anthropic);
    expect(res.status).toBe(200);
    expect(sentAnthropic!.messages[0]!.role).toBe("user");
  });
  test("histórico começando pela IA ganha o pedido inicial na frente", async () => {
    await handleChat(req({ scenario, messages: [{ role: "assistant", content: "Hey!" }, { role: "user", content: "hi" }] }), anthropic);
    expect(sentAnthropic!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
  test("recusa pedido malformado ou mensagem longa demais", async () => {
    expect((await handleChat(req({ nope: 1 }), anthropic)).status).toBe(400);
    expect((await handleChat(req({ scenario, messages: [{ role: "user", content: "x".repeat(601) }] }), anthropic)).status).toBe(400);
  });
  test("chave da Anthropic usa o Claude Opus 5", async () => {
    await handleChat(req({ scenario, messages: [] }), anthropic);
    expect(sentAnthropic!.model).toBe("claude-opus-5");
  });
  test("chave da OpenAI vai pra OpenAI, com o modelo escolhido e o papel no system", async () => {
    const res = await handleChat(req({ scenario, messages: [{ role: "user", content: "hi" }] }), {
      provider: "openai",
      key: "sk-proj-abcdefghijklmnopqrstu",
      model: "gpt-5.4",
    });
    expect(await res.json()).toEqual(reply);
    expect(openaiKey).toBe("sk-proj-abcdefghijklmnopqrstu");
    expect(sentOpenAI!.model).toBe("gpt-5.4");
    expect(sentOpenAI!.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });
});

describe("reconhece a chave", () => {
  test("Anthropic, OpenAI ou nenhuma", () => {
    expect(providerFor("sk-ant-api03-xxxx")).toBe("anthropic");
    expect(providerFor("sk-proj-abcdefghijklmnopqrstu")).toBe("openai");
    expect(providerFor("sk-abcdefghijklmnopqrstuvwx")).toBe("openai");
    expect(providerFor("minha-senha")).toBeNull();
  });
});
