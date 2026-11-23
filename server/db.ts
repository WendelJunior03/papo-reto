/**
 * Acesso ao banco com duas implementações do mesmo contrato:
 * SQLite local (bun:sqlite, arquivo data/papo.db) e Cloudflare D1 (em produção).
 * As duas falam SQLite, então o SQL é um só.
 */
export interface Db {
  first<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<void>;
}

/* ---------- Cloudflare D1 ---------- */
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
}

export function d1Db(d1: D1Database): Db {
  return {
    first: <T>(sql: string, ...params: unknown[]) => d1.prepare(sql).bind(...params).first<T>(),
    all: async <T>(sql: string, ...params: unknown[]) => (await d1.prepare(sql).bind(...params).all<T>()).results,
    run: async (sql: string, ...params: unknown[]) => {
      await d1.prepare(sql).bind(...params).run();
    },
  };
}
