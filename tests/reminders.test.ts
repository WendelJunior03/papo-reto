import { afterEach, describe, expect, test } from "bun:test";
import { bunDb } from "../server/db-bun";
import { generateVapid, schedulePush, sendDuePushes, type Vapid } from "../server/push";
import { dueReviews, localNow, reminderDueDay, reminderMessage, sendDueReminders, validTimeZone } from "../server/reminders";

const SP = "America/Sao_Paulo"; // UTC-3, sem horário de verão
const NY = "America/New_York"; // com horário de verão (EDT -4 / EST -5)

describe("hora local", () => {
  test("data e minuto no fuso de cada um", () => {
    const t = new Date("2026-11-25T23:30:00Z");
    expect(localNow(t, SP)).toEqual({ date: "2026-11-25", minute: 20 * 60 + 30 });
    expect(localNow(t, "Asia/Tokyo")).toEqual({ date: "2026-11-26", minute: 8 * 60 + 30 });
    expect(localNow(new Date("2026-11-26T03:00:00Z"), SP)).toEqual({ date: "2026-11-26", minute: 0 }); // meia-noite é 0, não 24
  });
  test("fuso válido e inválido", () => {
    expect(validTimeZone(SP)).toBe(true);
    expect(validTimeZone("UTC")).toBe(true);
    expect(validTimeZone("Marte/Olimpo")).toBe(false);
  });
});

describe("hora de mandar o lembrete", () => {
  const r = { time: "20:00", tz: SP, last_sent: null as string | null };

  test("São Paulo: 20:00 local = 23:00 UTC", () => {
    expect(reminderDueDay(r, new Date("2026-11-25T23:00:00Z"))).toBe("2026-11-25");
    expect(reminderDueDay(r, new Date("2026-11-25T22:59:00Z"))).toBeNull();
  });
  test("cron pulou um minuto: ainda manda até 3 min depois, não mais", () => {
    expect(reminderDueDay(r, new Date("2026-11-25T23:02:00Z"))).toBe("2026-11-25");
    expect(reminderDueDay(r, new Date("2026-11-25T23:03:00Z"))).toBe("2026-11-25");
    expect(reminderDueDay(r, new Date("2026-11-25T23:04:00Z"))).toBeNull();
  });
  test("já mandou hoje: não repete; amanhã manda de novo", () => {
    const sent = { ...r, last_sent: "2026-11-25" };
    expect(reminderDueDay(sent, new Date("2026-11-25T23:01:00Z"))).toBeNull();
    expect(reminderDueDay(sent, new Date("2026-11-26T23:00:00Z"))).toBe("2026-11-26");
  });
  test("horário de verão (Nova York): mesma hora local, hora UTC diferente", () => {
    const ny = { time: "20:00", tz: NY, last_sent: null };
    // julho (EDT, UTC-4): 20:00 local = 00:00 UTC do dia seguinte
    expect(reminderDueDay(ny, new Date("2026-07-16T00:00:00Z"))).toBe("2026-07-15");
    expect(reminderDueDay(ny, new Date("2026-07-16T01:00:00Z"))).toBeNull();
    // dezembro (EST, UTC-5): 20:00 local = 01:00 UTC
    expect(reminderDueDay(ny, new Date("2026-12-16T01:00:00Z"))).toBe("2026-12-15");
    expect(reminderDueDay(ny, new Date("2026-12-16T00:00:00Z"))).toBeNull();
  });
  test("atraso que cruza a meia-noite conta pro dia do lembrete", () => {
    const late = { time: "23:59", tz: SP, last_sent: null };
    // 00:01 de 26/11 em São Paulo = 03:01 UTC
    expect(reminderDueDay(late, new Date("2026-11-26T03:01:00Z"))).toBe("2026-11-25");
    expect(reminderDueDay({ ...late, last_sent: "2026-11-25" }, new Date("2026-11-26T03:01:00Z"))).toBeNull();
  });
});

describe("mensagem", () => {
  const progress = (cards: Record<string, { box: number; due: string }>) => JSON.stringify({ start: "2026-11-01", progress: cards });

  test("conta as revisões vencidas até hoje", () => {
    const p = progress({ "a:0": { box: 1, due: "2026-11-24" }, "a:1": { box: 2, due: "2026-11-25" }, "a:2": { box: 3, due: "2026-11-30" } });
    expect(dueReviews(p, "2026-11-25")).toBe(2);
    expect(dueReviews(null, "2026-11-25")).toBe(0);
    expect(dueReviews("não é json", "2026-11-25")).toBe(0);
    expect(dueReviews(JSON.stringify({ visits: [] }), "2026-11-25")).toBe(0);
  });
  test("texto com e sem revisões", () => {
    expect(reminderMessage(0)).toEqual({ title: "Papo Reto English", body: "Seu pacote do dia chegou!", url: "./#hoje" });
    expect(reminderMessage(1).body).toBe("Seu pacote do dia chegou! E tem 1 revisão te esperando.");
    expect(reminderMessage(4).body).toBe("Seu pacote do dia chegou! E tem 4 revisões te esperando.");
  });
});

describe("envio pelo cron (sem internet: o fetch é simulado)", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function setup() {
    const db = bunDb(":memory:");
    const v: Vapid = { ...(await generateVapid()), subject: "https://papo.app" };
    await db.run(
      "INSERT INTO users (username, pass_hash, pass_salt, progress) VALUES ('wendel', 'h', 's', ?)",
      JSON.stringify({ progress: { "a:0": { box: 1, due: "2026-11-20" }, "a:1": { box: 1, due: "2026-11-25" } } }),
    );
    await db.run("INSERT INTO push_subs (endpoint, user_id, p256dh, auth) VALUES ('https://push.exemplo.com/ok', 1, 'p', 'a')");
    await db.run("INSERT INTO push_subs (endpoint, user_id, p256dh, auth) VALUES ('https://push.exemplo.com/velho', 1, 'p', 'a')");
    const hits: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      hits.push(u);
      return new Response(null, { status: u.endsWith("/velho") ? 410 : 201 });
    }) as typeof fetch;
    return { db, v, hits };
  }

  test("manda uma vez por dia, grava o texto e apaga inscrição vencida", async () => {
    const { db, v, hits } = await setup();
    await db.run("INSERT INTO reminders (user_id, time, tz) VALUES (1, '20:00', ?)", SP);

    expect(await sendDueReminders(db, v, new Date("2026-11-25T23:01:00Z"))).toBe(1);
    expect(hits).toHaveLength(2);
    expect((await db.first<{ last_sent: string }>("SELECT last_sent FROM reminders"))!.last_sent).toBe("2026-11-25");
    expect(await db.first("SELECT body, url FROM push_outbox WHERE kind = 'reminder'")).toEqual({
      body: "Seu pacote do dia chegou! E tem 2 revisões te esperando.",
      url: "./#hoje",
    });
    expect(await db.all("SELECT endpoint FROM push_subs")).toHaveLength(1);

    // minuto seguinte: já foi hoje
    expect(await sendDueReminders(db, v, new Date("2026-11-25T23:02:00Z"))).toBe(0);
    expect(hits).toHaveLength(2);
  });

  test("lembrete desativado não sai", async () => {
    const { db, v, hits } = await setup();
    await db.run("INSERT INTO reminders (user_id, time, tz, enabled) VALUES (1, '20:00', ?, 0)", SP);
    expect(await sendDueReminders(db, v, new Date("2026-11-25T23:00:00Z"))).toBe(0);
    expect(hits).toHaveLength(0);
  });

  test("aviso da IA também grava o texto pro service worker", async () => {
    const { db, v } = await setup();
    await schedulePush(db, 1, "ai-ready", 1000);
    expect(await sendDuePushes(db, v, 2000)).toBe(1);
    expect(await db.first("SELECT title, body, url FROM push_outbox WHERE kind = 'ai-ready'")).toEqual({
      title: "Papo Reto English",
      body: "Sua conversa com a IA liberou! Bora praticar mais 7 minutos?",
      url: "./#ia",
    });
    expect(await db.first("SELECT 1 FROM push_jobs")).toBeNull();
  });
});
