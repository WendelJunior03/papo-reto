/**
 * Gera os áudios de todas as frases e falas das cenas em public/audio/*.m4a
 * usando as vozes do macOS (`say`) e o conversor nativo (`afconvert`).
 *
 *   bun run audio            gera só o que falta e apaga o que não é mais usado
 *   bun run audio --force    regrava tudo (ex.: depois de baixar uma voz Premium)
 *
 * Vozes melhores: Ajustes do Sistema → Acessibilidade → Conteúdo Falado →
 * Voz do Sistema → Gerenciar Vozes → Inglês (EUA) → baixe "Ava (Premium)" ou "Zoe (Premium)".
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { allPhrases, packs } from "../src/data";
import { audioFile, spokenText } from "../src/lib/spoken";

const PREFERRED_VOICES = ["Ava (Premium)", "Zoe (Premium)", "Ava (Enhanced)", "Evan (Enhanced)", "Samantha (Enhanced)", "Samantha"];
const RATE = 175; // palavras por minuto: natural, sem correr
const force = process.argv.includes("--force");

if (process.platform !== "darwin") {
  console.error("Este script usa as vozes do macOS (say/afconvert). Rode num Mac.");
  process.exit(1);
}

const installed = await Bun.$`say -v ?`.text();
const voice = PREFERRED_VOICES.find((v) => installed.includes(v)) ?? "Samantha";
console.log(`Voz: ${voice}`);

const root = join(import.meta.dir, "..");
const outDir = join(root, "public/audio");
await mkdir(outDir, { recursive: true });

const texts = new Map<string, string>();
for (const p of allPhrases) {
  texts.set(audioFile(p.en), p.en);
  for (const ex of p.examples ?? []) texts.set(audioFile(ex.en), ex.en);
  if (p.flip) texts.set(audioFile(p.flip.en), p.flip.en);
}
for (const pack of packs) for (const c of pack.chat) texts.set(audioFile(c.en), c.en);

const existing = new Set(await readdir(outDir));
const todo = [...texts].filter(([file]) => force || !existing.has(file.replace("audio/", "")));

let done = 0;
async function render([file, en]: [string, string]): Promise<void> {
  const tmp = join(tmpdir(), `papo-${crypto.randomUUID()}.aiff`);
  await Bun.$`say -v ${voice} -r ${RATE} -o ${tmp} ${spokenText(en)}`.quiet();
  await Bun.$`afconvert -f m4af -d aac -b 40000 -c 1 ${tmp} ${join(root, "public", file)}`.quiet();
  await rm(tmp, { force: true });
  done++;
  if (done % 25 === 0 || done === todo.length) console.log(`  ${done}/${todo.length}`);
}

// Algumas em paralelo, sem travar a máquina.
const CONCURRENCY = 4;
const queue = [...todo];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) await render(item);
  }),
);

const wanted = new Set([...texts.keys()].map((f) => f.replace("audio/", "")));
const stale = [...existing].filter((f) => f.endsWith(".m4a") && !wanted.has(f));
await Promise.all(stale.map((f) => rm(join(outDir, f))));

console.log(`✓ ${texts.size} áudios (${todo.length} gerados, ${stale.length} removidos)`);
