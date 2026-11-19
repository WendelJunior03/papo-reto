import { corePacks } from "./packs-core";
import { extraPacks } from "./packs-extra";
import { morePacks1 } from "./packs-more-1";
import { morePacks2 } from "./packs-more-2";
import { morePacks3 } from "./packs-more-3";
import type { Pack, Phrase } from "./types";

export type { Pack, Phrase, Tag, ChatLine, IconName } from "./types";

export const packs: readonly Pack[] = [...corePacks, ...extraPacks, ...morePacks1, ...morePacks2, ...morePacks3];

export interface PhraseRef extends Phrase {
  /** "<pack-id>:<índice>" — estável mesmo se a ordem dos pacotes mudar. */
  id: string;
  packIndex: number;
}

export const phraseId = (pack: Pack, i: number): string => `${pack.id}:${i}`;

export const allPhrases: readonly PhraseRef[] = packs.flatMap((pack, packIndex) =>
  pack.phrases.map((p, i) => ({ ...p, id: phraseId(pack, i), packIndex })),
);

const byId = new Map(allPhrases.map((p) => [p.id, p]));
export const findPhrase = (id: string): PhraseRef | undefined => byId.get(id);
