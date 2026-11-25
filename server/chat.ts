/**
 * POST /api/chat — conversa com IA: papo livre (padrão) ou no papel de uma situação.
 * Funciona com chave do Google (Gemini, a padrão do app), da Anthropic (Claude) ou da
 * OpenAI (GPT): a chave pode ser a do próprio usuário (vem do aparelho dele, a cada pedido,
 * e não é guardada) ou a do servidor.
 * Usa só a API padrão de Request/Response: roda no servidor do Bun e num Cloudflare Worker.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { ApiError as GeminiApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { DEFAULT_MODEL, GEMINI_FALLBACKS, type Provider } from "../src/lib/provider";

export { providerFor } from "../src/lib/provider";

export interface ChatAuth {
  provider: Provider;
  key: string;
  model?: string;
}

const MAX_TURNS = 24;
const MAX_CHARS = 600;

export const ChatReply = z.object({
  reply: z.string().describe("Sua fala em inglês, no papel. 1 a 3 frases curtas, casual e natural."),
  reply_pt: z.string().describe("Tradução natural da sua fala para português do Brasil."),
  correction: z
    .string()
    .nullable()
    .describe("Jeito natural de um nativo dizer a última mensagem do aluno, se ela estava errada, travada ou em português. null se já estava natural."),
  correction_note: z
    .string()
    .nullable()
    .describe("Explicação curta em português do Brasil (1 frase) do porquê da correção. null se não houve correção."),
});
export type ChatReply = z.infer<typeof ChatReply>;

const ChatRequest = z.object({
  /** null = papo livre, sobre o que a pessoa quiser. */
  scenario: z
    .object({
      title: z.string().max(80),
      scene: z.string().max(160),
      phrases: z.array(z.string().max(160)).max(10),
    })
    .nullable(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(MAX_CHARS) }))
    .max(MAX_TURNS),
});
export type ChatRequest = z.infer<typeof ChatRequest>;
export type Turn = ChatRequest["messages"][number];

const CORRECTIONS = `Corrections go only in the correction fields, never in your reply. Correct the learner's last message when it has a grammar mistake, sounds unnatural or textbook-like, or is in Portuguese: give the way a native would say it. Leave small typos and perfectly fine messages alone (null).`;

function systemPrompt(s: ChatRequest["scenario"]): string {
  if (!s) {
    return `You are Sam, a friendly American in your late twenties chatting with a Brazilian learner of English, like a new friend would.

Talk about whatever the learner wants: their day, work, family, hobbies, plans, movies, food, travel, faith, anything. If they don't bring a topic, ask an easy, open question about their day. Follow their lead, react with genuine interest and share a little about yourself so it feels like a real conversation.

How to talk:
- Casual, current American English, the way people actually talk. Contractions, short sentences, natural fillers when they fit. Slang only when it would really be used.
- Keep it at an intermediate level: 1 to 3 short sentences per turn, usually ending with a question that keeps the conversation going.
- If the learner writes in Portuguese or mixes languages, answer in simple English and give the English version in the correction field.

${CORRECTIONS}`;
  }
  return `You are a friendly American native speaker role-playing with a Brazilian learner of English who is practicing everyday conversation.

Situation: "${s.title}" — ${s.scene}. Play the other person in this situation (pick a fitting first name or role) and stay in character.

How to talk:
- Casual, current American English, the way people actually talk. Contractions, short sentences, natural fillers when they fit. Slang only when it would really be used.
- Keep it at an intermediate level: 1 to 3 short sentences per turn, and usually end with something that invites a reply, so the conversation keeps going.
- Work these expressions into the conversation naturally when they fit (don't force them all): ${s.phrases.join(" | ")}.
- If the learner writes in Portuguese or mixes languages, answer in simple English and give the English version in the correction field.

${CORRECTIONS}`;
}

/** A IA abre a conversa, mas as APIs esperam que a primeira mensagem seja do usuário. */
const KICKOFF: Turn = { role: "user", content: "(Start the role-play with a short, natural opening line.)" };
const withKickoff = (messages: Turn[]): Turn[] => (messages[0]?.role === "user" ? messages : [KICKOFF, ...messages]);

export class ChatFailure extends Error {
  constructor(message: string, readonly status: number, readonly detail?: string[]) {
    super(message);
  }
}

/** Um pedido com resposta em JSON no formato do schema (conversa, historinha...). */
export interface AskRequest<S extends z.ZodType> {
  system: string;
  /** Precisa começar por uma mensagem do usuário. */
  messages: Turn[];
  schema: S;
  /** Nome do formato (a OpenAI exige). */
  name: string;
  /** Limite de tokens da resposta no Gemini. */
  maxTokens: number;
}

async function askAnthropic<S extends z.ZodType>(auth: ChatAuth, r: AskRequest<S>): Promise<z.infer<S>> {
  const client = new Anthropic({ apiKey: auth.key });
  try {
    const response = await client.beta.messages.parse({
      model: auth.model || DEFAULT_MODEL.anthropic,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(r.schema) },
      system: r.system,
      messages: r.messages,
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new ChatFailure("A IA não conseguiu responder essa. Tenta reformular.", 502);
    }
    return response.parsed_output;
  } catch (error) {
    if (error instanceof ChatFailure) throw error;
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new ChatFailure("A chave da Anthropic foi recusada. Confira se copiou certo.", 401);
    }
    if (error instanceof Anthropic.NotFoundError) throw new ChatFailure("Esse modelo não existe na sua conta da Anthropic.", 400);
    if (error instanceof Anthropic.RateLimitError) throw new ChatFailure("Limite da sua conta Anthropic atingido. Espera um pouco.", 429);
    if (error instanceof Anthropic.APIConnectionError) throw new ChatFailure("Sem conexão com a Anthropic agora.", 502);
    if (error instanceof Anthropic.APIError) throw new ChatFailure(`Erro da Anthropic (${error.status ?? "?"}). Tenta de novo.`, 502);
    throw error;
  }
}

async function askOpenAI<S extends z.ZodType>(auth: ChatAuth, r: AskRequest<S>): Promise<z.infer<S>> {
  const client = new OpenAI({ apiKey: auth.key });
  try {
    const completion = await client.chat.completions.parse({
      model: auth.model || DEFAULT_MODEL.openai,
      messages: [{ role: "system", content: r.system }, ...r.messages],
      response_format: zodResponseFormat(r.schema, r.name),
    });
    const msg = completion.choices[0]?.message;
    if (!msg?.parsed) throw new ChatFailure("A IA não conseguiu responder essa. Tenta reformular.", 502);
    return msg.parsed as z.infer<S>;
  } catch (error) {
    if (error instanceof ChatFailure) throw error;
    if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
      throw new ChatFailure("A chave da OpenAI foi recusada. Confira se copiou certo.", 401);
    }
    if (error instanceof OpenAI.NotFoundError) throw new ChatFailure("Esse modelo não existe na sua conta da OpenAI.", 400);
    if (error instanceof OpenAI.RateLimitError) {
      throw new ChatFailure("Limite ou crédito da sua conta OpenAI acabou. Confira em platform.openai.com.", 429);
    }
    if (error instanceof OpenAI.APIConnectionError) throw new ChatFailure("Sem conexão com a OpenAI agora.", 502);
    if (error instanceof OpenAI.APIError) throw new ChatFailure(`Erro da OpenAI (${error.status ?? "?"}). Tenta de novo.`, 502);
    throw error;
  }
}

/** Gemini: tenta o modelo escolhido ou a lista padrão, pulando os sobrecarregados. */
async function askGemini<S extends z.ZodType>(auth: ChatAuth, r: AskRequest<S>): Promise<z.infer<S>> {
  // O SDK repete sozinho até 5 vezes com espera de até 60 s; aqui quem decide é a lista de reserva.
  const ai = new GoogleGenAI({ apiKey: auth.key, httpOptions: { retryOptions: { attempts: 1 }, timeout: 8_000 } });
  const models = auth.model ? [auth.model] : [...GEMINI_FALLBACKS];
  const deadline = Date.now() + 14_000;
  const contents = r.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  let busy = false;
  const tried: string[] = [];
  // Duas rodadas: se todos estiverem cheios, espera um pouco e tenta de novo (picos costumam durar segundos).
  for (const [round, model] of [...models.map((m) => [0, m] as const), ...models.map((m) => [1, m] as const)]) {
    if (Date.now() > deadline) break; // não deixa a pessoa esperando mais de ~15 s
    if (round === 1 && model === models[0]) {
      if (!busy) break;
      await new Promise((res) => setTimeout(res, 1500));
    }
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: r.system,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(r.schema),
          maxOutputTokens: r.maxTokens,
        },
      });
      const parsed = r.schema.safeParse(JSON.parse(response.text ?? "null"));
      if (parsed.success) return parsed.data;
      throw new ChatFailure("A IA não conseguiu responder essa. Tenta reformular.", 502);
    } catch (error) {
      if (error instanceof ChatFailure) throw error;
      if (error instanceof SyntaxError) throw new ChatFailure("A IA não conseguiu responder essa. Tenta reformular.", 502);
      if (error instanceof GeminiApiError) {
        if (error.status === 401 || error.status === 403) throw new ChatFailure("A chave do Gemini foi recusada. Confira se copiou certo.", 401);
        // Sobrecarregado, limite momentâneo ou modelo indisponível: tenta o próximo.
        if ([404, 429, 500, 502, 503, 504].includes(error.status)) {
          busy ||= error.status !== 404;
          tried.push(`${model}:${error.status}`);
          console.error("[gemini]", model, error.status, String(error.message).slice(0, 160));
          continue;
        }
        throw new ChatFailure(`Erro do Gemini (${error.status}). Tenta de novo.`, 502);
      }
      // Rede caiu ou a tentativa estourou o tempo: também tenta o próximo modelo.
      busy = true;
      tried.push(`${model}:rede`);
      continue;
    }
  }
  throw new ChatFailure(busy ? "A IA está sobrecarregada agora. Tenta de novo em alguns segundos." : "Nenhum modelo do Gemini disponível agora.", 503, tried);
}

/** Manda o pedido pra empresa da chave (Gemini, OpenAI ou Anthropic). Erros viram ChatFailure. */
export function ask<S extends z.ZodType>(auth: ChatAuth, r: AskRequest<S>): Promise<z.infer<S>> {
  return auth.provider === "openai" ? askOpenAI(auth, r)
    : auth.provider === "gemini" ? askGemini(auth, r)
    : askAnthropic(auth, r);
}

/**
 * `extra` vai junto na resposta. Pode ser uma função: ela só roda se a IA responder
 * (ex.: começar/contar a sessão só quando deu certo).
 */
export async function handleChat(
  req: Request,
  auth: ChatAuth,
  extra: Record<string, unknown> | (() => Promise<Record<string, unknown>>) = {},
): Promise<Response> {
  let body: ChatRequest;
  try {
    body = ChatRequest.parse(await req.json());
  } catch {
    return json({ error: "Pedido inválido" }, 400);
  }
  try {
    const reply = await ask(auth, {
      system: systemPrompt(body.scenario),
      messages: withKickoff(body.messages),
      schema: ChatReply,
      name: "chat_reply",
      maxTokens: 800,
    });
    return json({ ...reply, ...(typeof extra === "function" ? await extra() : extra) });
  } catch (error) {
    if (error instanceof ChatFailure) return json({ error: error.message, ...(error.detail ? { detail: error.detail } : {}) }, error.status);
    // Nunca registra a chave: só o tipo do erro.
    console.error("[api/chat]", error instanceof Error ? error.name : "erro desconhecido");
    return json({ error: "A IA não respondeu agora. Tenta de novo." }, 502);
  }
}

export const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
