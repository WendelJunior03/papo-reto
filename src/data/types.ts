/** Registro da frase: gíria aparece quando cabe, não é regra. */
export type Tag = "giria" | "casual" | "neutro" | "texting";

export type IconName =
  | "coffee" | "people" | "briefcase" | "sparkle" | "food" | "phone"
  | "heart" | "question" | "sun" | "thumb" | "pin" | "door"
  | "cart" | "home" | "car" | "dumbbell" | "health" | "money"
  | "music" | "plane" | "film" | "book" | "party" | "cloud" | "gamepad";

export interface Phrase {
  /** Inglês. O trecho entre [colchetes] é o "pedaço" que o nativo usa e vai grifado. */
  en: string;
  /** Tradução natural, do jeito que um brasileiro falaria. */
  pt: string;
  tag: Tag;
  /** Dica de uso. Aceita <strong> e <em>. */
  note: string;
  /** Dois outros exemplos com a mesma expressão, em contextos diferentes. */
  examples?: [Example, Example];
}

export interface Example {
  /** Inglês, com a mesma expressão entre [colchetes]. */
  en: string;
  pt: string;
}

export interface ChatLine {
  who: string;
  /** true = fala do aluno */
  me?: boolean;
  en: string;
  pt: string;
}

export interface Pack {
  /** Identificador estável (kebab-case). Usado para salvar o progresso. */
  id: string;
  title: string;
  scene: string;
  icon: IconName;
  phrases: [Phrase, Phrase, Phrase, Phrase, Phrase];
  chat: ChatLine[];
}
