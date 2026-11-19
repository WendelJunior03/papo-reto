/** Serve o dist/ como em produção (com service worker), para testar offline e instalação. */
import { join } from "node:path";
import { safePath } from "./static";
import { handleApi } from "../server/api";
import { bunDb } from "../server/db-bun";

const dist = join(import.meta.dir, "../dist");
const api = { db: bunDb(), signupCode: process.env.SIGNUP_CODE, anthropicKey: process.env.ANTHROPIC_API_KEY, openaiKey: process.env.OPENAI_API_KEY };

const server = Bun.serve({
  port: Number(process.env.PORT ?? 4173),
  hostname: "0.0.0.0",
  async fetch(req) {
    const apiRes = await handleApi(req, api);
    if (apiRes) return apiRes;
    let urlPath = new URL(req.url).pathname;
    if (urlPath.endsWith("/")) urlPath += "index.html";
    const full = safePath(dist, urlPath);
    const path = full ? full.slice(dist.length) : "";
    const file = Bun.file(full ?? join(dist, "index.html"));
    if (full && (await file.exists())) {
      const headers: Record<string, string> = path === "/sw.js" ? { "Cache-Control": "no-cache" } : {};
      if (path.endsWith(".webmanifest")) headers["Content-Type"] = "application/manifest+json";
      if (path.endsWith(".m4a")) headers["Content-Type"] = "audio/mp4";
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
      if (range) {
        // Safari só toca áudio servido em pedaços.
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
        return new Response(file.slice(start, end + 1), {
          status: 206,
          headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${file.size}`, "Accept-Ranges": "bytes" },
        });
      }
      return new Response(file, { headers: { ...headers, "Accept-Ranges": "bytes" } });
    }
    return new Response(Bun.file(join(dist, "index.html")));
  },
});

console.log(`Prévia de produção em ${server.url}  (no celular, use o IP do Mac na mesma rede)`);
