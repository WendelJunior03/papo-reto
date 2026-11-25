import { beforeEach, describe, expect, test } from "bun:test";
import { handleApi, type ApiConfig } from "../server/api";
import { bunDb } from "../server/db-bun";
import { dayOf, parseAdmins, SEEN_EVERY, tempPassword } from "../server/admin";

let cfg: ApiConfig;

/** Cliente com o próprio cookie (cada usuário num "aparelho"). */
function client() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = (await handleApi(
      new Request(`http://localhost/api/${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }),
      cfg,
    ))!;
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    const text = await res.text();
    return { status: res.status, text, data: JSON.parse(text) as Record<string, unknown> };
  };
}

async function signup(username: string, password = "12345678") {
  const c = client();
  expect((await c("POST", "auth/signup", { username, password, code: "convite" })).status).toBe(201);
  return c;
}

const idOf = async (username: string) => (await cfg.db.first<{ id: number }>("SELECT id FROM users WHERE username = ?", username))!.id;

beforeEach(() => {
  cfg = { db: bunDb(":memory:"), signupCode: "convite", adminUsers: parseAdmins(" WendelJunior03 , outro ") };
});

describe("quem é dono", () => {
  test("ADMIN_USERS vira lista minúscula sem espaços", () => {
    expect(parseAdmins("A, b ,,c")).toEqual(["a", "b", "c"]);
    expect(parseAdmins(undefined)).toBeUndefined();
  });
  test("usuário comum: 403 em todas as rotas do painel e sem admin no /me", async () => {
    const ana = await signup("ana");
    expect((await ana("GET", "me")).data.admin).toBeUndefined();
    expect((await ana("GET", "admin/stats")).status).toBe(403);
    expect((await ana("GET", "admin/users")).status).toBe(403);
    expect((await ana("POST", "admin/reset-password", { username: "ana" })).status).toBe(403);
    expect((await ana("GET", "admin/qualquer")).status).toBe(403);
  });
  test("sem login: 401", async () => {
    expect((await client()("GET", "admin/stats")).status).toBe(401);
  });
  test("dono (sem diferenciar maiúscula): 200 e admin no /me", async () => {
    const dono = await signup("wendeljunior03");
    expect((await dono("GET", "me")).data.admin).toBe(true);
    expect((await dono("GET", "admin/stats")).status).toBe(200);
    expect((await dono("GET", "admin/users")).status).toBe(200);
  });
  test("sem ADMIN_USERS ninguém é dono", async () => {
    cfg.adminUsers = undefined;
    const dono = await signup("WendelJunior03");
    expect((await dono("GET", "admin/stats")).status).toBe(403);
  });
});

describe("números e usuários", () => {
  test("soma cadastros, ativos, IA, apoiadores e não vaza segredo", async () => {
    const dono = await signup("WendelJunior03");
    const ana = await signup("ana");
    await signup("bia");
    const now = Date.now();
    const today = dayOf(now);
    await ana("PUT", "progress", {
      data: {
        visits: [dayOf(now - 2 * 86_400_000), dayOf(now - 86_400_000), today],
        progress: { "a:0": { box: 2, due: today }, "a:1": { box: 0, due: today }, "a:2": { box: 1, due: today } },
        supported: true,
        songs: { x: {}, y: {} },
      },
      updatedAt: new Date().toISOString(),
    });
    const anaId = await idOf("ana");
    await cfg.db.run(
      "INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 5), (?, ?, 2), (?, ?, 9)",
      anaId, today, anaId, dayOf(now - 3 * 86_400_000), anaId, dayOf(now - 20 * 86_400_000),
    );
    await cfg.db.run(
      "INSERT INTO push_subs (endpoint, user_id, p256dh, auth) VALUES ('https://p/1', ?, 'a', 'b'), ('https://p/2', ?, 'a', 'b')",
      anaId, anaId,
    );
    await cfg.db.run("INSERT INTO ai_sessions (user_id, started_at, ends_at, messages) VALUES (?, ?, ?, 5)", anaId, now - 60_000, now + 60_000);
    // bia nunca abriu o /me nem estudou
    await ana("GET", "me");
    await dono("GET", "me");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const st = (await dono("GET", "admin/stats")).data as any;
    expect(st.users).toBe(3);
    expect(st.signupsByDay).toHaveLength(30);
    expect(st.signupsByDay.at(-1)).toEqual({ date: today, value: 3 });
    expect(st.active).toEqual({ today: 2, d7: 2, d30: 2 });
    expect(st.aiMessagesByDay).toHaveLength(30);
    expect(st.aiMessages).toEqual({ today: 5, d7: 7 });
    expect(st.aiMessagesByDay.reduce((n: number, p: { value: number }) => n + p.value, 0)).toBe(16);
    expect(st.aiSessionsToday).toBe(1);
    expect(st.pushSubscribers).toBe(1);
    expect(st.supporters).toBe(1);
    expect(st.songsPracticed).toBe(2);
    expect(st.phrasesKnown).toBe(2);

    const res = await dono("GET", "admin/users");
    expect(res.text).not.toMatch(/pass_|hash|salt|token/i);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const users = (res.data as any).users as any[];
    expect(users.map((u) => u.username).sort()).toEqual(["WendelJunior03", "ana", "bia"]);
    const a = users.find((u) => u.username === "ana");
    expect(a).toMatchObject({ known: 2, days: 3, streak: 3, supporter: true, push: true, ai7d: 7, lastStudy: today });
    expect(typeof a.lastSeen).toBe("string");
    expect(Object.keys(a).sort()).toEqual(["ai7d", "createdAt", "days", "invitedBy", "invites", "known", "lastSeen", "lastStudy", "push", "streak", "supporter", "username"]);
    expect(users.find((u) => u.username === "bia")).toMatchObject({ known: 0, days: 0, lastSeen: null, push: false, supporter: false });
  });

  test("progresso com JSON estranho não quebra o painel", async () => {
    const dono = await signup("wendeljunior03");
    await cfg.db.run("UPDATE users SET progress = '{quebrado' WHERE username = 'wendeljunior03'");
    expect((await dono("GET", "admin/users")).status).toBe(200);
    expect((await dono("GET", "admin/stats")).status).toBe(200);
  });
});

describe("último acesso", () => {
  test("o /me grava no máximo uma vez por hora", async () => {
    const ana = await signup("ana");
    const id = await idOf("ana");
    const seen = async () => (await cfg.db.first<{ t: number }>("SELECT last_seen_at AS t FROM user_activity WHERE user_id = ?", id))?.t;
    await ana("GET", "me");
    expect(await seen()).toBeGreaterThan(Date.now() - 5000);

    const recent = Date.now() - 30 * 60_000;
    await cfg.db.run("UPDATE user_activity SET last_seen_at = ? WHERE user_id = ?", recent, id);
    await ana("GET", "me");
    expect(await seen()).toBe(recent);

    const old = Date.now() - SEEN_EVERY - 60_000;
    await cfg.db.run("UPDATE user_activity SET last_seen_at = ? WHERE user_id = ?", old, id);
    await ana("GET", "me");
    expect(await seen()).toBeGreaterThan(Date.now() - 5000);
  });
});

describe("senha temporária", () => {
  test("formato legível e aleatório", () => {
    const a = tempPassword();
    expect(a).toMatch(/^[a-km-np-z2-9]{5}-[a-km-np-z2-9]{5}$/);
    expect(tempPassword()).not.toBe(a);
  });

  test("troca a senha, derruba as sessões e libera a conta travada", async () => {
    const dono = await signup("WendelJunior03");
    const ana = await signup("ana", "senha-antiga");
    const anaOutro = client();
    expect((await anaOutro("POST", "auth/login", { username: "ana", password: "senha-antiga" })).status).toBe(200);
    await cfg.db.run("UPDATE users SET locked_until = ? WHERE username = 'ana'", Date.now() + 600_000);

    const r = await dono("POST", "admin/reset-password", { username: "  ANA " });
    expect(r.status).toBe(200);
    expect(r.data.username).toBe("ana");
    const temp = String(r.data.password);
    expect(temp).toHaveLength(11);
    expect(Object.keys(r.data).sort()).toEqual(["password", "username"]);

    expect((await ana("GET", "me")).status).toBe(401);
    expect((await anaOutro("GET", "me")).status).toBe(401);
    expect((await dono("GET", "me")).status).toBe(200);

    const nova = client();
    expect((await nova("POST", "auth/login", { username: "ana", password: "senha-antiga" })).status).toBe(401);
    expect((await nova("POST", "auth/login", { username: "ana", password: temp })).status).toBe(200);
    expect((await nova("GET", "me")).data.username).toBe("ana");
  });

  test("usuário inexistente: 404; corpo inválido: 400", async () => {
    const dono = await signup("wendeljunior03");
    expect((await dono("POST", "admin/reset-password", { username: "ninguem" })).status).toBe(404);
    expect((await dono("POST", "admin/reset-password", { username: "" })).status).toBe(400);
    expect((await dono("POST", "admin/reset-password", {})).status).toBe(400);
  });
});
