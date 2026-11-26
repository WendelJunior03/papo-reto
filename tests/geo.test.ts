import { describe, expect, test } from "bun:test";
import { bunDb } from "../server/db-bun";
import { geoOf, placeLabel, saveGeo } from "../server/geo";

const withCf = (cf: Record<string, unknown>): Request => {
  const req = new Request("http://localhost/api/me");
  Object.defineProperty(req, "cf", { value: cf });
  return req;
};

describe("cidade aproximada", () => {
  test("lê cidade, estado e país do Cloudflare; fora dele não há nada", () => {
    expect(geoOf(withCf({ city: "Uberlândia", regionCode: "MG", country: "BR" }))).toEqual({ city: "Uberlândia", region: "MG", country: "BR" });
    expect(geoOf(new Request("http://localhost/api/me"))).toBeNull();
    expect(geoOf(withCf({}))).toBeNull();
  });

  test("rótulo: estado no Brasil, país fora", () => {
    expect(placeLabel({ city: "Uberlândia", region: "MG", country: "BR" })).toBe("Uberlândia, MG");
    expect(placeLabel({ city: "Lisbon", region: "11", country: "PT" })).toBe("Lisbon, PT");
    expect(placeLabel({ city: null, region: null, country: null })).toBeNull();
  });

  test("grava e só atualiza depois de 6 h", async () => {
    const db = bunDb(":memory:");
    await db.run("INSERT INTO users (username, pass_hash, pass_salt) VALUES ('ana', 'h', 's')");
    const t0 = 1_000_000_000_000;
    await saveGeo(db, 1, { city: "Uberlândia", region: "MG", country: "BR" }, t0);
    await saveGeo(db, 1, { city: "Goiânia", region: "GO", country: "BR" }, t0 + 3_600_000);
    expect((await db.first<{ city: string }>("SELECT city FROM user_geo WHERE user_id = 1"))!.city).toBe("Uberlândia");
    await saveGeo(db, 1, { city: "Goiânia", region: "GO", country: "BR" }, t0 + 7 * 3_600_000);
    expect((await db.first<{ city: string }>("SELECT city FROM user_geo WHERE user_id = 1"))!.city).toBe("Goiânia");
  });
});
