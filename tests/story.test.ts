import { afterAll, describe, expect, mock, test } from "bun:test";
import { cleanText, mergeStories, pickKnownPhrases, sanitizeStory, type Story } from "../src/lib/story";
import { mergeData } from "../src/lib/merge";
import { emptyData } from "../src/lib/storage";
import { highlight } from "../src/lib/html";

// Gemini falso: devolve o que o teste mandar (sem sair pra internet).
let geminiText = "null";
let geminiCalls = 0;
mock.module("@google/genai", () => {
  class ApiError extends Error {
    constructor(public status: number) {
      super("busy");
    }
  }
  class GoogleGenAI {
    models = {
      generateContent: async () => {
        geminiCalls++;
        return { text: geminiText };
      },
    };
  }
  return { GoogleGenAI, ApiError };
});
const { handleApi } = await import("../server/api");
const { bunDb } = await import("../server/db-bun");
afterAll(() => mock.restore());

const line = (en: string, pt = "tradução") => ({ en, pt });
const good = {
  title: "A Busy Morning",
  title_pt: "Uma manhã corrida",
  lines: [
    line("Ana walks into the café."),
    line("[Can I get a large coffee to go?]"),
    line("The barista smiles."),
    line("[No worries], she says."),
    line("Ana runs to work."),
  ],
};

describe("frases que a pessoa sabe", () => {
  const phrases = [
    { id: "a:0", en: "Can I get a [large coffee] to go?" },
    { id: "a:1", en: "No worries" },
    { id: "a:2", en: "See you around" },
    { id: "b:0", en: "No worries" }, // mesmo texto em outro pacote: entra uma vez só
  ];
  const progress = { "a:0": { box: 1, due: "2026-11-30" }, "a:1": { box: 3, due: "2026-12-01" }, "a:2": { box: 0, due: "2026-11-25" }, "b:0": { box: 2, due: "2026-11-28" } };

  test("só as dominadas (caixa 1+), sem colchetes e sem repetir", () => {
    expect(pickKnownPhrases(phrases, progress).sort()).toEqual(["Can I get a large coffee to go?", "No worries"]);
  });
  test("embaralha com o sorteio dado e respeita o máximo", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `p:${i}`, en: `Phrase ${i}` }));
    const all = Object.fromEntries(many.map((p) => [p.id, { box: 1, due: "2026-12-01" }]));
    const a = pickKnownPhrases(many, all, 8, () => 0);
    expect(a.length).toBe(8);
    expect(new Set(a).size).toBe(8);
    expect(a).not.toEqual(many.slice(0, 8).map((p) => p.en));
    expect(pickKnownPhrases(many, {}, 8)).toEqual([]);
  });
});

describe("limpa a historinha da IA", () => {
  test("historinha boa passa igual", () => {
    expect(sanitizeStory(good)).toEqual(good);
  });
  test("tira tags e controle, e só deixa colchetes bem formados", () => {
    expect(cleanText("<b>Hi</b>\u0000 there <script>x</script>", 100, true)).toBe("Hi there x");
    expect(cleanText("I said [no [worries]] ok]", 100, true)).toBe("I said no [worries] ok");
    expect(cleanText("Empty [ ] here [", 100, true)).toBe("Empty here");
    expect(cleanText("tradução [com] colchete", 100, false)).toBe("tradução com colchete");
    expect(highlight(cleanText("a <img src=x onerror=alert(1)> [b]", 100, true))).toBe("a <mark>b</mark>");
  });
  test("corta texto longo sem deixar colchete aberto", () => {
    const s = cleanText(`${"x".repeat(15)} [long phrase here]`, 22, true);
    expect(s.length).toBeLessThanOrEqual(22);
    expect(s).not.toContain("[");
  });
  test("no máximo 8 falas; poucas falas, título vazio ou falas vazias derrubam", () => {
    const long = { ...good, lines: Array.from({ length: 12 }, (_, i) => line(`Line ${i}.`)) };
    expect(sanitizeStory(long)!.lines.length).toBe(8);
    expect(sanitizeStory({ ...good, lines: good.lines.slice(0, 3) })).toBeNull();
    expect(sanitizeStory({ ...good, title: "<br>" })).toBeNull();
    expect(sanitizeStory({ ...good, lines: [...good.lines.slice(0, 3), line("[ ]"), line("ok", "")] })).toBeNull();
  });
  test("sem título em português, usa o em inglês", () => {
    expect(sanitizeStory({ ...good, title_pt: " " })!.title_pt).toBe("A Busy Morning");
  });
});

describe("historinhas guardadas", () => {
  const st = (id: string, at: number): Story => ({ id, date: "2026-11-25", at, title: id, title_pt: id, lines: [line("Hi.")] });

  test("junta por id, mais recentes primeiro, no máximo 5", () => {
    const phone = [st("a", 5), st("b", 3), st("c", 1)];
    const laptop = [st("d", 6), st("b", 3), st("e", 2), st("f", 0)];
    expect(mergeStories(phone, laptop).map((x) => x.id)).toEqual(["d", "a", "b", "e", "c"]);
  });
  test("lixo e formato estranho ficam de fora", () => {
    expect(mergeStories("x", { a: 1 })).toEqual([]);
    expect(mergeStories([null, 3, { id: "z" }, st("ok", 1)], undefined).map((x) => x.id)).toEqual(["ok"]);
  });
  test("mergeData junta as historinhas e aceita servidor sem o campo", () => {
    const local = { ...emptyData(), stories: [st("a", 2)] };
    expect(mergeData(local, { stories: [st("b", 3)] }).stories.map((x) => x.id)).toEqual(["b", "a"]);
    expect(mergeData(local, { visits: [] }).stories.map((x) => x.id)).toEqual(["a"]);
    expect(emptyData().stories).toEqual([]);
  });
});

describe("rota /api/story", () => {
  async function setup(extra: Record<string, unknown> = {}) {
    const cfg = { db: bunDb(":memory:"), signupCode: "c", geminiKey: "AIza" + "x".repeat(35), ...extra };
    const signup = await handleApi(
      new Request("http://x/api/auth/signup", { method: "POST", body: JSON.stringify({ username: "ana", password: "12345678", code: "c" }) }),
      cfg,
    );
    const cookie = signup!.headers.get("set-cookie")!.split(";")[0]!;
    const story = async (phrases: string[], headers: Record<string, string> = {}) => {
      const res = (await handleApi(
        new Request("http://x/api/story", { method: "POST", headers: { cookie, ...headers }, body: JSON.stringify({ phrases }) }),
        cfg,
      ))!;
      return { status: res.status, data: (await res.json()) as Record<string, unknown> };
    };
    return { cfg, story };
  }
  const three = ["No worries", "See you around", "Can I get a large coffee to go?"];

  test("menos de 3 frases: pede pra marcar frases, sem chamar a IA", async () => {
    const { story } = await setup();
    geminiCalls = 0;
    const r = await story(["No worries"]);
    expect(r.status).toBe(400);
    expect(String(r.data.error)).toContain("Sei essa");
    expect(geminiCalls).toBe(0);
  });

  test("devolve a historinha limpa e o que sobra no dia; o limite diário bloqueia com mensagem amigável", async () => {
    const { cfg, story } = await setup({ storiesPerDay: 2 });
    geminiText = JSON.stringify({ ...good, title: "<i>A Busy Morning</i>" });
    const a = await story(three);
    expect(a.status).toBe(200);
    expect((a.data.story as { title: string }).title).toBe("A Busy Morning");
    expect(a.data.left).toBe(1);
    expect((await story(three)).data.left).toBe(0);
    geminiCalls = 0;
    const c = await story(three);
    expect(c.status).toBe(429);
    expect(String(c.data.error)).toContain("Amanhã tem mais");
    expect(geminiCalls).toBe(0);
    // Não gasta a sessão de conversa; conta no painel do dono.
    expect(await cfg.db.first("SELECT 1 FROM ai_sessions")).toBeNull();
    expect((await cfg.db.first<{ n: number }>("SELECT SUM(count) AS n FROM ai_usage"))!.n).toBe(2);
  });

  test("resposta quebrada da IA não conta no limite", async () => {
    const { cfg, story } = await setup();
    geminiText = JSON.stringify({ ...good, lines: good.lines.slice(0, 2) });
    expect((await story(three)).status).toBe(502);
    geminiText = "{not json";
    expect((await story(three)).status).toBe(502);
    expect(await cfg.db.first("SELECT 1 FROM story_usage")).toBeNull();
  });

  test("chave do próprio usuário não tem limite do app; chave estranha é recusada", async () => {
    const { cfg, story } = await setup({ storiesPerDay: 0 });
    geminiText = JSON.stringify(good);
    expect((await story(three)).status).toBe(429);
    expect((await story(three, { "x-ai-key": "AIza" + "y".repeat(35) })).status).toBe(200);
    expect((await story(three, { "x-ai-key": "minha-senha" })).status).toBe(400);
    expect(await cfg.db.first("SELECT 1 FROM story_usage")).toBeNull();
  });

  test("sem chave nenhuma, pede a chave do usuário", async () => {
    const { story } = await setup({ geminiKey: undefined });
    const r = await story(three);
    expect(r.status).toBe(403);
    expect(r.data.needsKey).toBe(true);
  });
});
