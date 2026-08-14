import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations.js";

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;
export const DEFAULT_MARKET_DB_PATH = resolve("runtime", "market", "mona-radar-market.sqlite3");

export function openMarketDatabase(path = DEFAULT_MARKET_DB_PATH): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;");
  migrateMarketDatabase(database);
  return database;
}

export function migrateMarketDatabase(database: DatabaseSync): void {
  const current = Number((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  if (current > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Market database schema ${current} is newer than supported ${CURRENT_SCHEMA_VERSION}`);
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
