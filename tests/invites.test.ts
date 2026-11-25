import { beforeEach, describe, expect, test } from "bun:test";
import { handleApi, type ApiConfig } from "../server/api";
import { bunDb } from "../server/db-bun";
import { parseAdmins } from "../server/admin";
import {
  BADGES, earnedBadges, INVITE_ALPHABET, inviteCode, inviteLink, newBadges, nextBadge, normalizeInvite, validBadge,
} from "../src/lib/invites";

let cfg: ApiConfig;

/** Cliente com o próprio cookie (cada usuário num "aparelho"). */
function client() {
  let cookie = "";
  return async (method: string, path: string, body?: unknown) => {
    const res = (await handleApi(
      new Request(`http://localhost/api/${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
      cfg,
    ))!;
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  };
}

async function signup(username: string, code = "convite") {
  const c = client();
  const r = await c("POST", "auth/signup", { username, password: "12345678", code });
  return { c, status: r.status, data: r.data };
}

const codeOf = async (c: ReturnType<typeof client>) => String((await c("GET", "invite")).data.code);

beforeEach(() => {
  cfg = { db: bunDb(":memory:"), signupCode: "convite", adminUsers: parseAdmins("dono") };
});

describe("código de convite", () => {
  test("8 símbolos, sem caracteres ambíguos, e diferente a cada vez", () => {
    const codes = new Set(Array.from({ length: 300 }, inviteCode));
    expect(codes.size).toBe(300);
    for (const c of codes) {
      expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
      expect(c).not.toMatch(/[01OIL]/);
    }
    expect(INVITE_ALPHABET).toHaveLength(31);
  });
  test("aceita minúscula, espaço e hífen; recusa o que não tem o formato", () => {
    expect(normalizeInvite(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizeInvite("ABCD EFGH")).toBe("ABCDEFGH");
    expect(normalizeInvite("ABCDEFG")).toBeNull();
    expect(normalizeInvite("ABCDEFG0")).toBeNull(); // 0 não existe no alfabeto
    expect(normalizeInvite("convite")).toBeNull();
    expect(normalizeInvite("' OR 1=1 --")).toBeNull();
  });
  test("link com ?convite=", () => {
    expect(inviteLink("https://papo.app", "ABCDEFGH")).toBe("https://papo.app/?convite=ABCDEFGH");
  });
});

describe("selos", () => {
  test("marcos 1, 3, 5 e 10 amigos", () => {
    expect(BADGES.map((b) => [b.id, b.friends])).toEqual([["amigo", 1], ["turma", 3], ["embaixador", 5], ["lenda", 10]]);
    expect(earnedBadges(0)).toEqual([]);
    expect(earnedBadges(1)).toEqual(["amigo"]);
    expect(earnedBadges(4)).toEqual(["amigo", "turma"]);
    expect(earnedBadges(5)).toEqual(["amigo", "turma", "embaixador"]);
    expect(earnedBadges(42)).toEqual(["amigo", "turma", "embaixador", "lenda"]);
  });
  test("próximo selo, quanto falta e o progresso desde o anterior", () => {
    expect(nextBadge(0)).toMatchObject({ badge: { id: "amigo" }, missing: 1, progress: 0 });
    expect(nextBadge(1)).toMatchObject({ badge: { id: "turma" }, missing: 2, progress: 0 });
    expect(nextBadge(2)).toMatchObject({ badge: { id: "turma" }, missing: 1, progress: 0.5 });
    expect(nextBadge(7)).toMatchObject({ badge: { id: "lenda" }, missing: 3, progress: 0.4 });
    expect(nextBadge(10)).toBeNull();
  });
  test("selo em uso só vale se ainda está conquistado", () => {
    expect(validBadge("turma", 3)).toBe("turma");
    expect(validBadge("turma", 2)).toBeNull();
    expect(validBadge("inventado", 99)).toBeNull();
    expect(validBadge(null, 5)).toBeNull();
  });
  test("selos novos (ainda não vistos), do maior pro menor", () => {
    expect(newBadges(["amigo", "turma"], ["amigo"])).toEqual(["turma"]);
    expect(newBadges(["amigo", "turma", "embaixador"], [])).toEqual(["embaixador", "turma", "amigo"]);
    expect(newBadges(["amigo"], ["amigo"])).toEqual([]);
  });
});

describe("cadastro com convite pessoal", () => {
  test("o código nasce no primeiro pedido e não muda depois", async () => {
    const { c } = await signup("ana");
    const r = await c("GET", "invite");
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ friends: 0, badges: [], badge: null });
    expect(String(r.data.code)).toMatch(/^[A-Z2-9]{8}$/);
    expect(r.data.link).toBe(`http://localhost/?convite=${r.data.code}`);
    expect(await codeOf(c)).toBe(String(r.data.code));
  });
  test("exige login", async () => {
    expect((await client()("GET", "invite")).status).toBe(401);
    expect((await client()("POST", "badge", { badge: null })).status).toBe(401);
  });
  test("entra com o código de um amigo (em minúscula e com hífen), conta o amigo e guarda quem convidou", async () => {
    const ana = await signup("ana");
    const code = await codeOf(ana.c);
    const bia = await signup("bia", `${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()}`);
    expect(bia.status).toBe(201);
    const inv = await ana.c("GET", "invite");
    expect(inv.data).toMatchObject({ friends: 1, badges: ["amigo"], badge: null });
    expect((await ana.c("GET", "me")).data).toMatchObject({ badges: ["amigo"], badge: null });
    // quem foi convidado não ganha nada por isso
    expect((await bia.c("GET", "invite")).data).toMatchObject({ friends: 0, badges: [] });
    const row = await cfg.db.first<{ invited_by: number }>(
      "SELECT i.invited_by FROM invites i JOIN users u ON u.id = i.user_id WHERE u.username = 'bia'",
    );
    const anaId = (await cfg.db.first<{ id: number }>("SELECT id FROM users WHERE username = 'ana'"))!.id;
    expect(row?.invited_by).toBe(anaId);
  });
  test("código pessoal errado ou inexistente: 403; código geral continua valendo sem marcar convite", async () => {
    await signup("ana");
    expect((await signup("bia", "ZZZZZZZZ")).status).toBe(403);
    expect((await signup("bia", "errado")).status).toBe(403);
    expect((await signup("bia", "convite")).status).toBe(201);
    expect(await cfg.db.first("SELECT 1 FROM invites WHERE invited_by IS NOT NULL")).toBeNull();
  });
  test("sem código geral configurado, o cadastro fica fechado até pra convite pessoal", async () => {
    const ana = await signup("ana");
    const code = await codeOf(ana.c);
    cfg.signupCode = undefined;
    expect((await signup("bia", code)).status).toBe(403);
  });
  test("convite pessoal mantém as validações do cadastro", async () => {
    const ana = await signup("ana");
    const code = await codeOf(ana.c);
    expect((await signup("ANA", code)).status).toBe(409);
    const curta = await client()("POST", "auth/signup", { username: "bia", password: "123", code });
    expect(curta.status).toBe(400);
    expect(await cfg.db.first("SELECT 1 FROM invites WHERE invited_by IS NOT NULL")).toBeNull();
  });
});

describe("selo em uso", () => {
  test("só coloca selo conquistado; null tira; aparece no /me", async () => {
    const ana = await signup("ana");
    const code = await codeOf(ana.c);
    expect((await ana.c("POST", "badge", { badge: "amigo" })).status).toBe(403);
    expect((await ana.c("POST", "badge", { badge: "inventado" })).status).toBe(400);
    for (const name of ["bia", "caio", "duda"]) expect((await signup(name, code)).status).toBe(201);
    expect((await ana.c("GET", "invite")).data).toMatchObject({ friends: 3, badges: ["amigo", "turma"] });
    expect((await ana.c("POST", "badge", { badge: "embaixador" })).status).toBe(403);
    expect((await ana.c("POST", "badge", { badge: "turma" })).data).toEqual({ badge: "turma" });
    expect((await ana.c("GET", "me")).data.badge).toBe("turma");
    expect((await ana.c("GET", "invite")).data.badge).toBe("turma");
    expect((await ana.c("POST", "badge", { badge: null })).data).toEqual({ badge: null });
    expect((await ana.c("GET", "me")).data.badge).toBeNull();
  });
  test("se um amigo apaga a conta e o selo deixa de valer, ele sai de uso", async () => {
    const ana = await signup("ana");
    const code = await codeOf(ana.c);
    await signup("bia", code);
    await ana.c("POST", "badge", { badge: "amigo" });
    await cfg.db.run("DELETE FROM users WHERE username = 'bia'");
    expect((await ana.c("GET", "me")).data).toMatchObject({ badges: [], badge: null });
  });
});

describe("painel do dono", () => {
  test("mostra quem convidou e quantos cada um trouxe", async () => {
    const dono = await signup("dono");
    const code = await codeOf(dono.c);
    await signup("bia", code);
    await signup("caio", code);
    await signup("duda");
    const users = (await dono.c("GET", "admin/users")).data.users as { username: string; invites: number; invitedBy: string | null }[];
    const by = Object.fromEntries(users.map((u) => [u.username, { invites: u.invites, invitedBy: u.invitedBy }]));
    expect(by).toEqual({
      dono: { invites: 2, invitedBy: null },
      bia: { invites: 0, invitedBy: "dono" },
      caio: { invites: 0, invitedBy: "dono" },
      duda: { invites: 0, invitedBy: null },
    });
  });
});
