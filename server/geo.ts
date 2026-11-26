/**
 * De onde a pessoa é, de forma aproximada: o Cloudflare manda cidade, estado e país
 * de cada conexão (pelo IP). Sem GPS e sem pedir permissão; o IP não é guardado.
 */
import type { Db } from "./db";

export interface Geo {
  city: string | null;
  region: string | null;
  country: string | null;
}

interface CfInfo {
  city?: string;
  regionCode?: string;
  region?: string;
  country?: string;
}

/** Atualiza no máximo a cada 6 h (mudou de cidade, aparece no próximo acesso). */
const EVERY = 6 * 3_600_000;

const clean = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : null);

/** Localização aproximada da conexão (null fora do Cloudflare, como no servidor local). */
export function geoOf(req: Request): Geo | null {
  const cf = (req as Request & { cf?: CfInfo }).cf;
  if (!cf) return null;
  const geo = { city: clean(cf.city), region: clean(cf.regionCode ?? cf.region), country: clean(cf.country) };
  return geo.city || geo.region || geo.country ? geo : null;
}

export async function saveGeo(db: Db, userId: number, geo: Geo | null, now = Date.now()): Promise<void> {
  if (!geo) return;
  await db.run(
    `INSERT INTO user_geo (user_id, city, region, country, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET city = excluded.city, region = excluded.region, country = excluded.country, updated_at = excluded.updated_at
     WHERE user_geo.updated_at < ?`,
    userId,
    geo.city,
    geo.region,
    geo.country,
    now,
    now - EVERY,
  );
}

/** "Uberlândia, MG" no Brasil; "Lisboa, PT" fora. */
export function placeLabel(g: Partial<Geo>): string | null {
  if (!g.city && !g.region && !g.country) return null;
  const tail = g.country === "BR" ? g.region : g.country;
  return [g.city, tail].filter(Boolean).join(", ") || null;
}
