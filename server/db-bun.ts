/** Banco local para `bun dev` e `bun preview`: um arquivo SQLite, criado na primeira execução. */
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Db } from "./db";

const MIGRATIONS = join(import.meta.dir, "../migrations");

export function bunDb(path = join(import.meta.dir, "../data/papo.db")): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  // Mesmos arquivos que o `wrangler d1 migrations apply` usa; todos idempotentes (IF NOT EXISTS).
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  return {
    first: async <T>(sql: string, ...params: unknown[]) =>
      (sqlite.query(sql).get(...(params as SQLQueryBindings[])) as T | null) ?? null,
    run: async (sql: string, ...params: unknown[]) => {
      sqlite.query(sql).run(...(params as SQLQueryBindings[]));
    },
  };
}
