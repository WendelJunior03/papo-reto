/** Servidor de desenvolvimento com recarga automática. */
import { join } from "node:path";
import { safePath } from "./static";
import index from "../src/index.html";
import { handleApi } from "../server/api";
import { bunDb } from "../server/db-bun";

const pub = join(import.meta.dir, "../public");
const api = { db: bunDb(), signupCode: process.env.SIGNUP_CODE, geminiKey: process.env.GEMINI_API_KEY,
  anthropicKey: process.env.ANTHROPIC_API_KEY, openaiKey: process.env.OPENAI_API_KEY,
  vapid: process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateJwk: process.env.VAPID_PRIVATE_KEY, subject: "https://papo-reto.papo-reto.workers.dev" }
    : undefined,
  pix: process.env.PIX_KEY ? { key: process.env.PIX_KEY, name: process.env.PIX_NAME ?? "", city: process.env.PIX_CITY ?? "" } : undefined,
};

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
