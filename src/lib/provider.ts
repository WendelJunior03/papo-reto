/** Empresas de IA aceitas. Compartilhado entre o app e o servidor. */
export type Provider = "anthropic" | "openai";

export const PROVIDER_NAME: Record<Provider, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI (GPT)" };

export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-5.4-mini",
};

/** Reconhece de quem é a chave pelo começo dela. */
export function providerFor(key: string): Provider | null {
  if (/^sk-ant-/.test(key)) return "anthropic";
  if (/^sk-[A-Za-z0-9_-]{16,}/.test(key)) return "openai";
  return null;
}

/** "sk-proj-…a1B2" — pra mostrar qual chave está salva sem expor a chave. */
export const maskKey = (key: string): string => `${key.slice(0, key.startsWith("sk-ant-") ? 7 : 3)}…${key.slice(-4)}`;
