/** Empresas de IA aceitas. Compartilhado entre o app e o servidor. */
export type Provider = "anthropic" | "openai" | "gemini";

export const PROVIDER_NAME: Record<Provider, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI (GPT)", gemini: "Google (Gemini)" };

export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-5.4-mini",
  gemini: "gemini-3.8-flash",
};

/** Se o modelo padrão do Gemini estiver sobrecarregado (503), tenta estes em ordem. */
export const GEMINI_FALLBACKS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
] as const;

/** Reconhece de quem é a chave pelo começo dela. */
export function providerFor(key: string): Provider | null {
  if (/^sk-ant-/.test(key)) return "anthropic";
  if (/^(AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z._-]{20,})$/.test(key)) return "gemini";
  if (/^sk-[A-Za-z0-9_-]{16,}/.test(key)) return "openai";
  return null;
}

/** "sk-proj-…a1B2" — pra mostrar qual chave está salva sem expor a chave. */
export const maskKey = (key: string): string => `${key.slice(0, key.startsWith("sk-ant-") ? 7 : 4)}…${key.slice(-4)}`;
