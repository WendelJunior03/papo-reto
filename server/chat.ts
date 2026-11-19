/**
 * POST /api/chat — conversa livre com IA, no papel de um nativo da situação escolhida.
 * Usa só a API padrão de Request/Response: roda no servidor do Bun e num Cloudflare Worker.
 * A chave fica no servidor (ANTHROPIC_API_KEY); o navegador nunca vê.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const MODEL = "claude-opus-5";
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
  scenario: z.object({
    title: z.string().max(80),
    scene: z.string().max(160),
    phrases: z.array(z.string().max(160)).max(10),
  }),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(MAX_CHARS) }))
    .max(MAX_TURNS),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

function systemPrompt(s: ChatRequest["scenario"]): string {
  return `You are a friendly American native speaker role-playing with a Brazilian learner of English who is practicing everyday conversation.

Situation: "${s.title}" — ${s.scene}. Play the other person in this situation (pick a fitting first name or role) and stay in character.

How to talk:
- Casual, current American English, the way people actually talk. Contractions, short sentences, natural fillers when they fit. Slang only when it would really be used.
- Keep it at an intermediate level: 1 to 3 short sentences per turn, and usually end with something that invites a reply, so the conversation keeps going.
- Work these expressions into the conversation naturally when they fit (don't force them all): ${s.phrases.join(" | ")}.
- If the learner writes in Portuguese or mixes languages, answer in simple English and give the English version in the correction field.

Corrections go only in the correction fields, never in your in-character reply. Correct the learner's last message when it has a grammar mistake, sounds unnatural or textbook-like, or is in Portuguese: give the way a native would say it. Leave small typos and perfectly fine messages alone (null).`;
}

let client: Anthropic | null = null;

export async function handleChat(req: Request, apiKey?: string): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let body: ChatRequest;
  try {
    body = ChatRequest.parse(await req.json());
  } catch {
    return json({ error: "Pedido inválido" }, 400);
  }

  // A IA abre a conversa, mas a API exige que a primeira mensagem seja do usuário.
  const kickoff: Anthropic.Beta.BetaMessageParam = { role: "user", content: "(Start the role-play with a short, natural opening line.)" };
  const messages: Anthropic.Beta.BetaMessageParam[] =
    body.messages[0]?.role === "user" ? body.messages : [kickoff, ...body.messages];

  try {
    // Sem credencial o construtor lança erro; fica dentro do try pra virar uma resposta clara.
    client ??= new Anthropic(apiKey ? { apiKey } : {});
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(ChatReply) },
      system: systemPrompt(body.scenario),
      messages,
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return json({ error: "A IA não conseguiu responder essa. Tenta reformular." }, 502);
    }
    return json(response.parsed_output);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return json({ error: "Chave da API inválida ou ausente no servidor." }, 503);
    }
    if (error instanceof Anthropic.RateLimitError) {
      return json({ error: "Muitas mensagens seguidas. Espera uns segundos." }, 429);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return json({ error: "Sem conexão com a IA agora." }, 502);
    }
    if (error instanceof Anthropic.APIError) {
      return json({ error: `Erro da IA (${error.status ?? "?"}). Tenta de novo.` }, 502);
    }
    // Sem credencial o SDK falha antes de chamar a API; qualquer outro imprevisto cai aqui também.
    console.error("[api/chat]", error);
    return json({ error: "A IA não está disponível: o servidor precisa da ANTHROPIC_API_KEY configurada." }, 503);
  }
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
