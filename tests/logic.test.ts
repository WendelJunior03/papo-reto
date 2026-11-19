import { describe, expect, test } from "bun:test";
import { addDays, daysBetween } from "../src/lib/dates";
import { dueIds, grade, INTERVALS, isKnown, markKnown, MAX_BOX } from "../src/lib/srs";
import { packIndexFor, shuffle, streak } from "../src/lib/schedule";
import { highlight } from "../src/lib/html";
import { buildReminderICS } from "../src/lib/reminder";
import { audioFile, spokenText } from "../src/lib/spoken";

describe("datas", () => {
  test("soma dias atravessando mês e ano", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  test("conta dias entre datas", () => {
    expect(daysBetween("2026-11-19", "2026-11-26")).toBe(7);
    expect(daysBetween("2026-11-19", "2026-11-18")).toBe(-1);
  });
});

describe("repetição espaçada", () => {
  const today = "2026-11-19";
  test("'Sei essa' entra na caixa 1 e volta amanhã", () => {
    const c = markKnown(undefined, today);
    expect(c).toEqual({ box: 1, due: "2026-11-20", at: "2026-11-19" });
    expect(isKnown(c)).toBe(true);
  });
  test("acertos espaçam cada vez mais", () => {
    let c = grade(undefined, true, today);
    expect(c.box).toBe(1);
    c = grade(c, true, today);
    expect(c).toEqual({ box: 2, due: addDays(today, INTERVALS[2]), at: today });
  });
  test("caixa não passa do máximo", () => {
    const c = grade({ box: MAX_BOX, due: today }, true, today);
    expect(c.box).toBe(MAX_BOX);
  });
  test("erro volta pro começo e fica pra hoje", () => {
    expect(grade({ box: 4, due: today }, false, today)).toEqual({ box: 0, due: today });
  });
  test("lista revisões vencidas, mais atrasadas primeiro, ignorando excluídas", () => {
    const progress = {
      a: { box: 2, due: "2026-11-18" },
      b: { box: 1, due: "2026-11-10" },
      c: { box: 1, due: "2026-11-25" },
      d: { box: 3, due: "2026-11-19" },
    };
    expect(dueIds(progress, today)).toEqual(["b", "a", "d"]);
    expect(dueIds(progress, today, new Set(["b"]))).toEqual(["a", "d"]);
  });
});

describe("agenda", () => {
  test("primeiro dia abre o pacote 0 e gira um por dia", () => {
    expect(packIndexFor("2026-11-19", "2026-11-19", 30)).toBe(0);
    expect(packIndexFor("2026-11-19", "2026-11-20", 30)).toBe(1);
    expect(packIndexFor("2026-11-19", "2026-12-19", 30)).toBe(0);
  });
  test("relógio voltando no tempo não quebra", () => {
    expect(packIndexFor("2026-11-19", "2026-11-18", 30)).toBe(29);
  });
  test("sequência de dias conta até o primeiro buraco", () => {
    const visits = ["2026-11-15", "2026-11-17", "2026-11-18", "2026-11-19"];
    expect(streak(visits, "2026-11-19")).toBe(3);
  });
  test("sequência não zera se hoje ainda não abriu", () => {
    expect(streak(["2026-11-17", "2026-11-18"], "2026-11-19")).toBe(2);
    expect(streak(["2026-11-16"], "2026-11-19")).toBe(0);
  });
  test("embaralhar mantém os mesmos itens", () => {
    const items = [1, 2, 3, 4, 5, 6];
    expect(shuffle(items).sort()).toEqual(items);
  });
});

describe("html", () => {
  test("grifa o trecho nativo e escapa o resto", () => {
    expect(highlight("I'm [beat] <3")).toBe("I'm <mark>beat</mark> &lt;3");
  });
});

describe("lembrete diário", () => {
  const ics = buildReminderICS({ time: "07:30", appUrl: "https://papo.app/", from: new Date(2026, 10, 19), now: new Date(Date.UTC(2026, 10, 19, 12)) });
  test("repete todo dia no horário escolhido, com alarme", () => {
    expect(ics).toContain("DTSTART:20261119T073000\r\n");
    expect(ics).toContain("RRULE:FREQ=DAILY\r\n");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("URL:https://papo.app/");
  });
  test("usa quebras de linha CRLF e UID fixo (substitui o anterior)", () => {
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
    expect(ics).toContain("UID:lembrete-diario@papo-reto");
  });
});

describe("áudio", () => {
  test("texto falado sem colchetes nem emoji", () => {
    expect(spokenText("Btw you forgot my birthday 😅")).toBe("Btw you forgot my birthday");
    expect(spokenText("I'm [beat].")).toBe("I'm beat.");
  });
  test("nome do arquivo ignora destaque e maiúsculas", () => {
    expect(audioFile("I'm [beat].")).toBe(audioFile("i'm beat."));
    expect(audioFile("I'm [beat].")).toMatch(/^audio\/[0-9a-f]{8}\.m4a$/);
  });
});
