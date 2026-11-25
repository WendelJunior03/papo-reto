/**
 * POST /api/story — historinha curta com frases que a pessoa já sabe.
 * Usa a mesma escolha de IA da conversa (chave do usuário ou a do app) e o mesmo `ask()`.
 * Com a chave do app vale um limite diário por usuário (fora da sessão de 7 minutos).
 */
import { z } from "zod";
import { MIN_KNOWN, MAX_STORY_PHRASES, sanitizeStory } from "../src/lib/story";
import { ask, ChatFailure, json, type ChatAuth } from "./chat";
import { dayOf } from "./admin";
import type { Db } from "./db";

/** Historinhas por dia com a chave do app. */
export const DEFAULT_STORIES_PER_DAY = 3;

/** Formato pedido à IA. Sem min/max: alguns provedores recusam; os limites ficam no sanitizeStory. */
export const StoryReply = z.object({
  title: z.string().describe("Título curto da historinha, em inglês (até 6 palavras)."),
  title_pt: z.string().describe("O título traduzido para português do Brasil."),
  lines: z
    .array(
      z.object({
        en: z.string().describe("Uma frase curta da história em inglês. A expressão da lista usada aqui vai entre [colchetes], exatamente como foi dada."),
        pt: z.string().describe("Tradução natural da frase para português do Brasil, sem colchetes."),
      }),
    )
    .describe("De 5 a 8 frases curtas, em ordem."),
});
export type StoryReply = z.infer<typeof StoryReply>;

export const StoryRequest = z.object({
  phrases: z.array(z.string().trim().min(1).max(160)).min(MIN_KNOWN).max(MAX_STORY_PHRASES),
});

const SYSTEM = `You write very short, light everyday stories for a Brazilian learner of English, using expressions the learner already knows.

Rules:
- 5 to 8 short sentences, easy level (simple vocabulary and grammar), current American English, the way people actually talk.
- A natural, warm slice of everyday life (home, work, friends, coffee, shopping, travel...), with a tiny twist or a nice ending. Nothing sad, violent, romantic-explicit or controversial.
- Use as many of the given expressions as fit naturally (at least 3), each one word for word as given. Wrap each used expression in [square brackets]. Don't put brackets around anything else.
- At most one bracketed expression per sentence. Dialogue lines are fine.
- Give a natural Brazilian Portuguese translation for every sentence and for the title (no brackets in the translations).`;

const userPrompt = (phrases: string[]): string =>
  `Expressions the learner knows:\n${phrases.map((p) => `- ${p}`).join("\n")}\n\nWrite the story.`;

/** Quantas historinhas o usuário já fez hoje com a chave do app. */
export async function storiesToday(db: Db, userId: number, now = Date.now()): Promise<number> {
  const row = await db.first<{ count: number }>("SELECT count FROM story_usage WHERE user_id = ? AND day = ?", userId, dayOf(now));
  return row?.count ?? 0;
}

export async function countStory(db: Db, userId: number, now = Date.now()): Promise<void> {
  await db.run(
    "INSERT INTO story_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1",
    userId,
    dayOf(now),
  );
}

/**
 * Gera a historinha. `extra` (como no handleChat) só roda se a IA responder com uma historinha válida:
 * é onde a rota conta o uso do dia.
 */
export async function handleStory(
  req: Request,
  auth: ChatAuth,
  extra: () => Promise<Record<string, unknown>> = async () => ({}),
): Promise<Response> {
  const parsed = StoryRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Marque algumas frases como \"Sei essa\" primeiro." }, 400);
  const phrases = [...new Set(parsed.data.phrases)];
  try {
    const raw = await ask(auth, {
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt(phrases) }],
      schema: StoryReply,
      name: "story",
      maxTokens: 1500,
    });
    const story = sanitizeStory(raw);
    if (!story) return json({ error: "A historinha veio estranha. Tenta de novo." }, 502);
    return json({ story, ...(await extra()) });
  } catch (error) {
    if (error instanceof ChatFailure) return json({ error: error.message, ...(error.detail ? { detail: error.detail } : {}) }, error.status);
    // Nunca registra a chave: só o tipo do erro.
    console.error("[api/story]", error instanceof Error ? error.name : "erro desconhecido");
    return json({ error: "A IA não respondeu agora. Tenta de novo." }, 502);
  }
}
