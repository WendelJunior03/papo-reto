/**
 * Detector de português nas Salas ao vivo. Roda no aparelho (aviso na hora) e de novo no
 * servidor (que é quem conta os avisos de verdade).
 *
 * O reconhecedor está em en-US, então quando alguém fala português ele "traduz" quase tudo
 * pra palavras inglesas parecidas. Sobram as palavras que não têm par em inglês (né, você,
 * obrigado, beleza…) e, às vezes, acentos. É nelas que a gente se apoia.
 *
 * Regra: palavra FORTE (não existe em inglês) vale 1; palavra FRACA (existe em inglês, nome
 * próprio ou gíria emprestada: "cara", "sim", "nada") ou só acentuada vale 0,5.
 * Português = 1 ponto ou mais (uma forte, ou duas fracas).
 * Com confiança baixa do reconhecedor, meio ponto já basta (ele "chutou" inglês em cima de outra língua).
 */

/** Não existem em inglês: uma basta. Com e sem acento (o reconhecedor às vezes tira). */
const STRONG = new Set([
  "obrigado", "obrigada", "obrigadão", "brigado", "brigada", "valeu",
  "então", "entao", "né", "beleza", "mano", "você", "voce", "vocês", "voces", "não", "nao",
  "porque", "porquê", "gente", "nossa", "tipo", "muito", "muita", "tudo", "também", "tambem",
  "isso", "aqui", "estou", "está", "tá", "tô", "falou", "fala", "caramba", "meu", "minha",
  "desculpa", "desculpe", "tchau", "olá", "uai", "oxe", "eita", "ué", "hein", "porra", "caralho",
  "pois", "sério", "serio", "verdade", "legalzão", "bacana", "demais", "noite",
  "só", "já", "até", "mas", "mais", "pra", "nóis", "nós", "eles", "elas",
  "fazer", "falar", "quero", "posso", "acho", "sabe", "olha", "vamo",
  "querido", "querida", "amiga", "galera", "cadê", "quê", "ninguém", "ninguem", "alguém", "alguem",
  "coisa", "coisas", "ficar", "tinha", "tenho", "estava", "trabalho", "português", "portugues",
]);

/**
 * Existem em inglês (ou são nomes): sozinhas não condenam ninguém.
 * "sim" (sim card), "cara" (nome), "nada"/"amigo" (gíria em inglês), "boa" (cobra), "eu" (EU),
 * "com" (ponto com), "pro", "agora", "bora" (Bora Bora)…
 * Ficam de fora de vez as que o inglês usa toda hora: "um" (hesitação), "ai" (AI), "legal", "para", "e".
 */
const WEAK = new Set([
  "sim", "cara", "nada", "amigo", "boa", "bom", "bem", "eu", "que", "ola", "oi", "dia", "ta",
  "vamos", "esta", "deus", "tarde", "ne", "uma", "aí", "com", "sem", "pro", "agora", "bora",
  "massa", "sei",
]);

/** Palavras acentuadas que o inglês usa de verdade (não contam nada). */
const EN_ACCENTED = new Set([
  "café", "cafe", "résumé", "resume", "cliché", "fiancé", "fiancée", "naïve", "touché", "déjà",
  "éclair", "entrée", "protégé", "rosé", "sauté", "exposé", "façade", "garçon", "soufflé", "piñata",
  "jalapeño", "señor", "señora", "über", "doppelgänger", "crème", "brûlée", "pokémon", "beyoncé", "josé",
]);

/** Expressões inglesas que contêm palavras da lista: saem antes de contar. */
const EN_PHRASES = [
  /\bsim cards?\b/g, /\bmano a mano\b/g, /\bque sera,? sera\b/g, /\bthe sims?\b/g, /\bcosa nostra\b/g, /\bbora bora\b/g,
  /\bs[aã]o (paulo|jos[eé]|lu[ií]s)\b/g,
];

/** Expressões portuguesas que valem ponto cheio mesmo feitas de palavras fracas. */
const PT_PHRASES = [/\bpor favor\b/g, /\bbom dia\b/g, /\bboa noite\b/g, /\bboa tarde\b/g, /\bcom licença\b/g, /\btudo bem\b/g, /\bque isso\b/g];

export interface PtResult {
  isPortuguese: boolean;
  score: number;
  /** O que pesou (pra mostrar ou depurar). */
  matches: string[];
}

/** Abaixo disso, o reconhecedor estava chutando. */
const LOW_CONFIDENCE = 0.45;

export function detectPortuguese(transcript: string, confidence?: number): PtResult {
  let text = transcript.normalize("NFC").toLowerCase().replace(/[’`]/g, "'");
  const matches: string[] = [];
  let score = 0;
  for (const re of EN_PHRASES) text = text.replace(re, " ");
  for (const re of PT_PHRASES) {
    text = text.replace(re, (m) => {
      matches.push(m);
      score += 1;
      return " ";
    });
  }
  for (const word of text.match(/[\p{L}]+(?:'[\p{L}]+)?/gu) ?? []) {
    if (EN_ACCENTED.has(word)) continue;
    if (STRONG.has(word)) {
      matches.push(word);
      score += 1;
    } else if (WEAK.has(word) || /[ãõçáéíóúâêôà]/.test(word)) {
      // Acento sozinho vale meio ponto: nomes como João e Conceição aparecem em conversa em inglês.
      matches.push(word);
      score += 0.5;
    }
  }
  const low = confidence !== undefined && confidence > 0 && confidence < LOW_CONFIDENCE;
  return { isPortuguese: score >= 1 || (low && score >= 0.5), score, matches };
}
