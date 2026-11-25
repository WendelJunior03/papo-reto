/**
 * Gera os áudios de todas as frases e falas das cenas usando as vozes do macOS (`say`)
 * e o conversor nativo (`afconvert`):
 *   public/audio/*.m4a        inglês (frases, exemplos, viradas e falas das cenas)
 *   public/audio-pt/*.m4a     português (tradução das frases e das falas), pro modo "Ouvir no carro"
 *   public/audio/silence-*    pausas de 1 s e 2 s (no iPhone bloqueado a pausa também precisa ser áudio)
 *
 *   bun run audio            gera só o que falta e apaga o que não é mais usado
 *   bun run audio --force    regrava tudo (ex.: depois de baixar uma voz Premium)
 *
 * Vozes melhores: Ajustes do Sistema → Acessibilidade → Conteúdo Falado →
 * Voz do Sistema → Gerenciar Vozes → Inglês (EUA) → baixe "Ava (Premium)" ou "Zoe (Premium)";
 * em Português (Brasil), "Luciana (Enhanced)".
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { allPhrases, packs } from "../src/data";
import { audioFile, ptAudioFile, SILENCE, spokenText } from "../src/lib/spoken";

const PREFERRED_VOICES = ["Ava (Premium)", "Zoe (Premium)", "Ava (Enhanced)", "Evan (Enhanced)", "Samantha (Enhanced)", "Samantha"];
const PREFERRED_PT_VOICES = ["Luciana (Premium)", "Luciana (Enhanced)", "Luciana"];
const RATE = 175; // palavras por minuto: natural, sem correr
const PT_RATE = 185; // a tradução pode ir um tiquinho mais rápida: é só o apoio
const force = process.argv.includes("--force");

if (process.platform !== "darwin") {
  console.error("Este script usa as vozes do macOS (say/afconvert). Rode num Mac.");
  process.exit(1);
}

const installed = await Bun.$`say -v ?`.text();
const voice = PREFERRED_VOICES.find((v) => installed.includes(v)) ?? "Samantha";
const ptVoice = PREFERRED_PT_VOICES.find((v) => installed.includes(v)) ?? "Luciana";
console.log(`Vozes: ${voice} (inglês) · ${ptVoice} (português)`);

const root = join(import.meta.dir, "..");

/* ---------- inglês ---------- */
const texts = new Map<string, string>();
for (const p of allPhrases) {
  texts.set(audioFile(p.en), p.en);
  for (const ex of p.examples ?? []) texts.set(audioFile(ex.en), ex.en);
  if (p.flip) texts.set(audioFile(p.flip.en), p.flip.en);
}
for (const pack of packs) for (const c of pack.chat) texts.set(audioFile(c.en), c.en);

/* ---------- português (tradução das frases e das falas) ---------- */
const ptTexts = new Map<string, string>();
for (const p of allPhrases) ptTexts.set(ptAudioFile(p.pt), p.pt);
for (const pack of packs) for (const c of pack.chat) ptTexts.set(ptAudioFile(c.pt), c.pt);

/** Grava o que falta numa pasta de public/ e apaga o que não é mais usado (menos o que está em `keep`). */
async function generate(dir: string, list: Map<string, string>, v: string, rate: number, keep: string[] = []): Promise<void> {
  const outDir = join(root, "public", dir);
  await mkdir(outDir, { recursive: true });
  const existing = new Set(await readdir(outDir));
  const name = (file: string): string => file.slice(file.indexOf("/") + 1);
  const todo = [...list].filter(([file]) => force || !existing.has(name(file)));

  let done = 0;
  async function render([file, text]: [string, string]): Promise<void> {
    const tmp = join(tmpdir(), `papo-${crypto.randomUUID()}.aiff`);
    await Bun.$`say -v ${v} -r ${rate} -o ${tmp} ${spokenText(text)}`.quiet();
    await Bun.$`afconvert -f m4af -d aac -b 40000 -c 1 ${tmp} ${join(root, "public", file)}`.quiet();
    await rm(tmp, { force: true });
    done++;
    if (done % 25 === 0 || done === todo.length) console.log(`  ${dir}: ${done}/${todo.length}`);
  }

  // Algumas em paralelo, sem travar a máquina.
  const CONCURRENCY = 4;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await render(item);
    }),
  );

  const wanted = new Set([...list.keys(), ...keep].map(name));
  const stale = [...existing].filter((f) => f.endsWith(".m4a") && !wanted.has(f));
  await Promise.all(stale.map((f) => rm(join(outDir, f))));
  console.log(`✓ ${dir}: ${list.size} áudios (${todo.length} gerados, ${stale.length} removidos)`);
}

/** Silêncio: um WAV mudo (cabeçalho escrito à mão) convertido pro mesmo formato dos outros áudios. */
async function silence(file: string, seconds: number): Promise<void> {
  const out = join(root, "public", file);
  if (!force && (await Bun.file(out).exists())) return;
  const rate = 22050;
  const bytes = rate * seconds * 2; // mono, 16 bits
  const wav = new DataView(new ArrayBuffer(44 + bytes));
  const tag = (at: number, s: string): void => [...s].forEach((c, i) => wav.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  wav.setUint32(4, 36 + bytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); // PCM
  wav.setUint16(22, 1, true); // mono
  wav.setUint32(24, rate, true);
  wav.setUint32(28, rate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  tag(36, "data");
  wav.setUint32(40, bytes, true);
  const tmp = join(tmpdir(), `papo-${crypto.randomUUID()}.wav`);
  await Bun.write(tmp, wav.buffer);
  await Bun.$`afconvert -f m4af -d aac -b 40000 -c 1 ${tmp} ${out}`.quiet();
  await rm(tmp, { force: true });
  console.log(`✓ ${file}`);
}

await generate("audio", texts, voice, RATE, Object.values(SILENCE));
await silence(SILENCE.short, 1);
await silence(SILENCE.long, 2);
await generate("audio-pt", ptTexts, ptVoice, PT_RATE);
