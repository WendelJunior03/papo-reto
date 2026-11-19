/** Servidor de desenvolvimento com recarga automática. */
import { join } from "node:path";
import { safePath } from "./static";
import index from "../src/index.html";
import { handleApi } from "../server/api";
import { bunDb } from "../server/db-bun";

const pub = join(import.meta.dir, "../public");
const api = { db: bunDb(), signupCode: process.env.SIGNUP_CODE, anthropicKey: process.env.ANTHROPIC_API_KEY };

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: { hmr: true, console: true },
  routes: { "/": index },
  async fetch(req) {
    const apiRes = await handleApi(req, api);
    if (apiRes) return apiRes;
    const path = safePath(pub, new URL(req.url).pathname);
    const file = path ? Bun.file(path) : null;
    return file && (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  },
});

console.log(`Papo Reto rodando em ${server.url}`);
