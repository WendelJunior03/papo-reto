/**
 * Build de produção:
 * 1. empacota src/index.html (TS + CSS) em dist/ com nomes com hash
 * 2. copia public/ (manifest e ícones)
 * 3. gera dist/sw.js com a lista de arquivos para funcionar offline
 */
import { rm, cp, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });

const app = await Bun.build({
  entrypoints: [join(root, "src/index.html"), join(root, "src/conheca.html")],
  outdir: dist,
  minify: true,
  sourcemap: "linked",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!app.success) {
  for (const log of app.logs) console.error(log);
  process.exit(1);
}

await cp(join(root, "public"), dist, { recursive: true });

// Os arquivos de public/ não passam pelo empacotador; os links entram direto no HTML final.
const PWA_HEAD = [
  '<link rel="manifest" href="./manifest.webmanifest">',
  '<link rel="icon" type="image/svg+xml" href="./icons/icon.svg">',
  '<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png">',
].join("");
for (const page of ["index.html", "conheca.html"]) {
  const htmlPath = join(dist, page);
  const html = await Bun.file(htmlPath).text();
  await Bun.write(htmlPath, html.replace("</head>", `${PWA_HEAD}</head>`));
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]))),
  );
  return nested.flat();
}

const files = (await listFiles(dist))
  .map((f) => relative(dist, f).split("\\").join("/"))
  .filter((f) => !f.endsWith(".map") && f !== "sw.js" && f !== "_headers" && f !== "index.html" && f !== "conheca.html" && !/^audio(-pt)?\//.test(f));
// index.html entra como "./": no Cloudflare, /index.html redireciona pra /, e página redirecionada no cache não abre.
// Os áudios (mais de mil, em inglês e em português) não entram na instalação: são guardados
// conforme cada pacote é aberto (ou quando a lista do "Ouvir no carro" começa).
const precache = ["./", ...files.map((f) => `./${f}`)];

const hasher = new Bun.CryptoHasher("sha1");
for (const f of files.sort()) hasher.update(await Bun.file(join(dist, f)).arrayBuffer());
const version = hasher.digest("hex").slice(0, 10);

const sw = await Bun.build({
  entrypoints: [join(root, "src/sw.ts")],
  outdir: dist,
  naming: "sw.js",
  minify: true,
  define: { __PRECACHE__: JSON.stringify(precache), __VERSION__: JSON.stringify(version) },
});
if (!sw.success) {
  for (const log of sw.logs) console.error(log);
  process.exit(1);
}

const size = files.reduce((n, f) => n + Bun.file(join(dist, f)).size, 0);
console.log(`✓ dist/ pronto · ${files.length} arquivos · ${(size / 1024).toFixed(0)} KB · versão ${version}`);
