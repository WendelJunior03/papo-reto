import { describe, expect, test } from "bun:test";
import { DEFAULT_SESSION, sessionState } from "../server/session";
import { generateVapid } from "../server/push";

const cfg = DEFAULT_SESSION; // 7 min, 1 h de espera, 40 mensagens
const t0 = 1_800_000_000_000;
const min = 60_000;

describe("sessão com a IA do app", () => {
  test("sem sessão: pronta", () => {
    expect(sessionState(null, t0, cfg)).toEqual({ state: "ready", minutes: 7 });
  });
  test("durante os 7 minutos: em andamento, com mensagens restantes", () => {
    expect(sessionState({ started_at: t0, ends_at: t0 + 7 * min, messages: 5 }, t0 + 3 * min, cfg)).toEqual({
      state: "active", endsAt: t0 + 7 * min, messagesLeft: 35,
    });
  });
  test("depois do fim: espera de 1 hora", () => {
    expect(sessionState({ started_at: t0, ends_at: t0 + 7 * min, messages: 9 }, t0 + 20 * min, cfg)).toEqual({
      state: "cooldown", endedAt: t0 + 7 * min, availableAt: t0 + 67 * min,
    });
  });
  test("passou a espera: pronta de novo", () => {
    expect(sessionState({ started_at: t0, ends_at: t0 + 7 * min, messages: 9 }, t0 + 68 * min, cfg).state).toBe("ready");
  });
  test("mensagem que chega até 30 s depois do fim ainda conta como sessão em andamento", () => {
    const row = { started_at: t0, ends_at: t0 + 7 * min, messages: 9 };
    expect(sessionState(row, t0 + 7 * min + 10_000, cfg, true).state).toBe("active");
    expect(sessionState(row, t0 + 7 * min + 10_000, cfg).state).toBe("cooldown");
  });
});

test("gera chaves VAPID válidas (65 bytes públicos, JWK privada)", async () => {
  const v = await generateVapid();
  expect(Buffer.from(v.publicKey, "base64url").length).toBe(65);
  expect(JSON.parse(v.privateJwk)).toMatchObject({ kty: "EC", crv: "P-256" });
});

import { vapidJwt } from "../server/push";

test("assinatura das notificações (JWT ES256) confere com a chave pública", async () => {
  const v = await generateVapid();
  const jwt = await vapidJwt("https://web.push.apple.com/abc123", { ...v, subject: "https://papo.app" });
  const [h, c, sig] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(c!, "base64url").toString());
  expect(claims.aud).toBe("https://web.push.apple.com");
  expect(claims.sub).toBe("https://papo.app");
  const pub = await crypto.subtle.importKey("raw", Buffer.from(v.publicKey, "base64url"), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, Buffer.from(sig!, "base64url"), new TextEncoder().encode(`${h}.${c}`));
  expect(ok).toBe(true);
});
