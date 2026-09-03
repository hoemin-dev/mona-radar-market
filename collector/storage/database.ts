import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./migrations.js";

export const CURRENT_SCHEMA_VERSION = Math.max(0,...MIGRATIONS.map(migration=>migration.version));
// Desktop launches pass this path only to the private Node sidecar.  Keeping the
// default makes the collector CLI convenient during development.
export const DEFAULT_MARKET_DB_PATH = process.env.MARKET_DB_PATH ?? resolve("runtime", "market", "mona-radar-market.sqlite3");

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
  if (current >= 16) assertContractSchemaCompatible(database, false);
  for (const migration of [...MIGRATIONS].sort((left,right)=>left.version-right.version)) {
    if (migration.version <= current) continue;
    if (migration.version === 16) assertContractSchemaCompatible(database, true);
    if (migration.version === 20 || migration.version === 21 || migration.version === 22) database.exec("PRAGMA foreign_keys=OFF; PRAGMA legacy_alter_table=ON;");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      if (migration.version === 16) assertContractSchemaCompatible(database, false);
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
      if (migration.version === 20 || migration.version === 21 || migration.version === 22) {
        database.exec("PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;");
        const violation=database.prepare("PRAGMA foreign_key_check").get();
        if(violation)throw new Error("SCHEMA_INTEGRITY_ERROR: contract target migration foreign key violation");
      }
    } catch (error) {
      if(database.isTransaction)database.exec("ROLLBACK");
      if (migration.version === 20 || migration.version === 21 || migration.version === 22) database.exec("PRAGMA legacy_alter_table=OFF; PRAGMA foreign_keys=ON;");
      throw error;
    }
  }
}

const CONTRACT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  contract_header: ["contract_header_id","unty_cntrct_no","decision_contract_no","contract_ref_no","source_raw_item_id","source_operation","raw_json","first_seen_at","updated_at"],
  contract_detail_state: ["contract_header_id","status","attempts","last_attempt_at","completed_at","last_error_summary","updated_at"],
  contract_item: ["contract_item_id","contract_header_id","source_fingerprint","unty_cntrct_no","decision_contract_no","contract_ref_no","product_class_no","product_identification_no","product_class_name","korean_product_name","quantity","unit_price_amount","product_amount","target_detailed_product_class_no","resolution_status","resolution_reason","source_raw_item_id","source_operation","raw_json","first_seen_at","updated_at"],
  contract_catalog_cache: ["product_identification_no","detailed_product_class_no","lookup_status","source_raw_item_id","last_error_summary","observed_at","updated_at"],
};

function assertContractSchemaCompatible(database: DatabaseSync, allowMissing: boolean): void {
  for (const [table, expected] of Object.entries(CONTRACT_COLUMNS)) {
    const object = database.prepare("SELECT type,sql FROM sqlite_master WHERE name=?").get(table) as {type:string;sql:string}|undefined;
    if (!object) { if (allowMissing) continue; throw new Error(`SCHEMA_INTEGRITY_ERROR: missing ${table}`); }
    if (object.type !== "table") throw new Error(`SCHEMA_INTEGRITY_ERROR: ${table} is not a table`);
    const columns=(database.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(x=>x.name);
    if (expected.some(name=>!columns.includes(name))) throw new Error(`SCHEMA_INTEGRITY_ERROR: incompatible ${table} columns`);
    if (!/\bSTRICT\s*$/iu.test(object.sql)) throw new Error(`SCHEMA_INTEGRITY_ERROR: ${table} is not STRICT`);
  }
  const requiredIndexes: Record<string,string[]>={contract_header:["unty_cntrct_no"],contract_item:["contract_header_id","source_fingerprint"]};
  for(const [table,columns] of Object.entries(requiredIndexes)){
    const exists=(database.prepare(`PRAGMA index_list(${table})`).all() as {name:string;unique:number}[]).some(index=>index.unique===1&&(database.prepare(`PRAGMA index_info(${index.name})`).all() as {name:string}[]).map(x=>x.name).join("|")===columns.join("|"));
    if(!exists && !(allowMissing && !database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))) throw new Error(`SCHEMA_INTEGRITY_ERROR: missing unique key on ${table}(${columns.join(",")})`);
  }
}
