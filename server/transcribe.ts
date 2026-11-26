/**
 * Transcrição no servidor (Gemini, chave do app) do áudio gravado no aparelho.
 * Existe por causa do iPhone: o reconhecimento de voz do Safari ouve a primeira fala e,
 * na segunda, às vezes não ouve mais nada. Gravar o áudio funciona sempre; o texto vem daqui.
 */
import { ApiError as GeminiApiError, GoogleGenAI } from "@google/genai";
import { GEMINI_FALLBACKS } from "../src/lib/provider";
import { dayOf } from "./admin";
import type { Db } from "./db";

/** Limite por pessoa por dia (cada fala do Diálogo é uma transcrição). */
export const TRANSCRIBE_PER_DAY = 300;
/** ~15 s de fala a 32 kbps cabem com folga. */
export const MAX_AUDIO_BYTES = 400_000;
const TYPES = ["audio/mp4", "audio/webm", "audio/ogg", "audio/aac", "audio/mpeg", "audio/wav"];

const PROMPT =
  "Transcribe exactly what the speaker says, in the language actually spoken. Do not fix grammar or wording; " +
  "if a word is unclear, write what it sounds like. If there is no speech, answer with nothing. Output only the transcript.";

export class TranscribeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Tipo de áudio aceito, sem parâmetros ("audio/mp4;codecs=..." → "audio/mp4"); null se não for áudio conhecido. */
export function audioType(header: string | null): string | null {
  const t = (header ?? "").split(";")[0]!.trim().toLowerCase();
  return TYPES.includes(t) ? t : null;
}

export async function transcribesToday(db: Db, userId: number, now = Date.now()): Promise<number> {
  const row = await db.first<{ count: number }>("SELECT count FROM transcribe_usage WHERE user_id = ? AND day = ?", userId, dayOf(now));
  return row?.count ?? 0;
}

export async function countTranscribe(db: Db, userId: number, now = Date.now()): Promise<void> {
  await db.run(
    "INSERT INTO transcribe_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1",
    userId,
    dayOf(now),
  );
}

/** Texto falado no áudio ("" quando não tem fala). Tenta os modelos da lista até ~10 s. */
export async function transcribe(key: string, audio: Uint8Array, mime: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: key, httpOptions: { retryOptions: { attempts: 1 }, timeout: 7_000 } });
  const data = btoa(Array.from(audio, (b) => String.fromCharCode(b)).join(""));
  const deadline = Date.now() + 10_000;
  for (const model of GEMINI_FALLBACKS) {
    if (Date.now() > deadline) break;
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data } }, { text: PROMPT }] }],
        config: { temperature: 0, maxOutputTokens: 200 },
      });
      return (res.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    } catch (error) {
      if (error instanceof GeminiApiError && (error.status === 401 || error.status === 403)) {
        throw new TranscribeError("A transcrição está indisponível agora.", 503);
      }
      console.error("[transcribe]", model, error instanceof GeminiApiError ? error.status : "rede");
      continue; // sobrecarregado, fora do ar ou estourou o tempo: tenta o próximo
    }
  }
  throw new TranscribeError("Não deu pra entender o áudio agora. Tenta de novo.", 503);
}
