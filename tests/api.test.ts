import { beforeEach, describe, expect, test } from "bun:test";
import { handleApi, type ApiConfig } from "../server/api";
import { bunDb } from "../server/db-bun";
import { hashPassword, verifyPassword } from "../server/auth";

let cfg: ApiConfig;
let cookie = "";

async function call(method: string, path: string, body?: unknown, withCookie = true) {
  const res = (await handleApi(
    new Request(`http://localhost/api/${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(withCookie && cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
    cfg,
  ))!;
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0]!;
  return { status: res.status, data: (await res.json()) as Record<string, unknown>, setCookie: set };
}

beforeEach(() => {
  cfg = { db: bunDb(":memory:"), signupCode: "convite-123" };
  cookie = "";
});

describe("senhas", () => {
  test("confere a senha certa e recusa a errada", async () => {
    const { hash, salt } = await hashPassword("senha-forte-1");
    expect(await verifyPassword("senha-forte-1", hash, salt)).toBe(true);
    expect(await verifyPassword("senha-forte-2", hash, salt)).toBe(false);
  });
  test("mesma senha gera hash diferente (sal aleatório)", async () => {
    expect((await hashPassword("abc12345")).hash).not.toBe((await hashPassword("abc12345")).hash);
  });
});

describe("contas", () => {
  test("cadastro exige o código de convite", async () => {
    expect((await call("POST", "auth/signup", { username: "wendel", password: "12345678", code: "errado" })).status).toBe(403);
    const ok = await call("POST", "auth/signup", { username: "wendel", password: "12345678", code: "convite-123" });
    expect(ok.status).toBe(201);
    expect(ok.setCookie).toContain("HttpOnly");
    expect(ok.setCookie).not.toContain("Secure"); // http://localhost
  });
  test("sem código configurado, cadastro fechado", async () => {
    cfg.signupCode = undefined;
    expect((await call("POST", "auth/signup", { username: "ana", password: "12345678", code: "x" })).status).toBe(403);
  });
  test("valida usuário e senha curta", async () => {
    const r = await call("POST", "auth/signup", { username: "ana", password: "123", code: "convite-123" });
    expect(r.status).toBe(400);
    expect(String(r.data.error)).toContain("8 caracteres");
  });
  test("aceita nome com acento, espaço e e-mail; login com espaços extras", async () => {
    for (const username of ["João Silva", "maria@exemplo.com", "Wendel Junior"]) {
      cookie = "";
      const r = await call("POST", "auth/signup", { username, password: "12345678", code: "convite-123" });
      expect({ username, status: r.status }).toEqual({ username, status: 201 });
    }
    cookie = "";
    expect((await call("POST", "auth/login", { username: "  wendel   junior ", password: "12345678" })).status).toBe(200);
    expect((await call("GET", "me")).data.username).toBe("Wendel Junior");
  });
  test("recusa usuário com símbolo estranho, explicando o que pode", async () => {
    const r = await call("POST", "auth/signup", { username: "<script>", password: "12345678", code: "convite-123" });
    expect(r.status).toBe(400);
    expect(String(r.data.error)).toContain("letras, números, espaço");
  });
  test("usuário repetido (sem diferenciar maiúscula)", async () => {
    await call("POST", "auth/signup", { username: "Wendel", password: "12345678", code: "convite-123" });
    expect((await call("POST", "auth/signup", { username: "wendel", password: "12345678", code: "convite-123" })).status).toBe(409);
  });
  test("login, sessão e logout", async () => {
    await call("POST", "auth/signup", { username: "wendel", password: "12345678", code: "convite-123" });
    cookie = "";
    expect((await call("GET", "me")).status).toBe(401);
    expect((await call("POST", "auth/login", { username: "wendel", password: "errada00" })).status).toBe(401);
    expect((await call("POST", "auth/login", { username: "WENDEL", password: "12345678" })).status).toBe(200);
    expect((await call("GET", "me")).data.username).toBe("wendel");
    await call("POST", "auth/logout");
    expect((await call("GET", "me")).status).toBe(401);
  });
  test("bloqueia depois de 5 senhas erradas", async () => {
    await call("POST", "auth/signup", { username: "wendel", password: "12345678", code: "convite-123" });
    for (let i = 0; i < 5; i++) await call("POST", "auth/login", { username: "wendel", password: "errada00" }, false);
    const r = await call("POST", "auth/login", { username: "wendel", password: "12345678" }, false);
    expect(r.status).toBe(429);
  });
  test("cookie forjado não entra", async () => {
    cookie = "papo_session=" + "a".repeat(64);
    expect((await call("GET", "me")).status).toBe(401);
  });
});

describe("proteções", () => {
  test("recusa ação vinda de outro site (CSRF)", async () => {
    const res = (await handleApi(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "text/plain", origin: "https://site-malicioso.com" },
        body: JSON.stringify({ username: "x", password: "y" }),
      }),
      cfg,
    ))!;
    expect(res.status).toBe(403);
  });
  test("sem chave nenhuma, pede a chave do usuário", async () => {
    await call("POST", "auth/signup", { username: "wendel", password: "12345678", code: "convite-123" });
    const r = await call("POST", "chat", { scenario: { title: "t", scene: "s", phrases: [] }, messages: [] });
    expect(r.status).toBe(403);
    expect(r.data.needsKey).toBe(true);
  });
  test("chave do usuário que não é de IA é recusada", async () => {
    await call("POST", "auth/signup", { username: "wendel", password: "12345678", code: "convite-123" });
    const res = (await handleApi(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie, "x-ai-key": "minha-senha" },
        body: JSON.stringify({ scenario: { title: "t", scene: "s", phrases: [] }, messages: [] }),
      }),
      cfg,
    ))!;
    expect(res.status).toBe(400);
  });
  test("limita mensagens pra IA por dia (com a chave do servidor)", async () => {
    // Limite já estourado: bloqueia antes de qualquer chamada à IA (o teste não sai pra internet).
    cfg.aiDailyLimit = 0;
    cfg.anthropicKey = "sk-ant-servidor";
    await call("POST", "auth/signup", { username: "wendel", password: "12345678", code: "convite-123" });
    const r = await call("POST", "chat", { scenario: { title: "t", scene: "s", phrases: [] }, messages: [] });
    expect(r.status).toBe(429);
    expect(String(r.data.error)).toContain("limite");
  });
});

describe("progresso", () => {
  test("salva e devolve o progresso só pro dono", async () => {
    await call("POST", "auth/signup", { username: "wendel", password: "12345678", code: "convite-123" });
    const data = { start: "2026-11-19", visits: ["2026-11-19"], progress: { "a:0": { box: 2, due: "2026-11-22" } } };
    expect((await call("PUT", "progress", { data, updatedAt: "2026-11-19T10:00:00Z" })).status).toBe(200);
    expect((await call("GET", "progress")).data.data).toEqual(data);

    cookie = "";
    await call("POST", "auth/signup", { username: "ana", password: "12345678", code: "convite-123" });
    expect((await call("GET", "progress")).data.data).toBeNull();
  });
  test("IA e progresso exigem login", async () => {
    expect((await call("GET", "progress")).status).toBe(401);
    expect((await call("POST", "chat", { scenario: {}, messages: [] })).status).toBe(401);
  });
});
