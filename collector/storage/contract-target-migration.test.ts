import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateMarketDatabase } from "./database.js";
import { MIGRATIONS } from "./migrations.js";

test("v19 Contract target state/checkpoints safely merge 10-digit siblings into one 8-digit target",()=>{
 const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON");
 for(const migration of MIGRATIONS.filter(x=>x.version<=19)){db.exec("BEGIN");db.exec(migration.sql);db.exec(`PRAGMA user_version=${migration.version}`);db.exec("COMMIT");}
 db.prepare("INSERT INTO contract_collection_job(job_id,status,cutoff_at,created_at,updated_at)VALUES('j','paused','2020','t','t')").run();
 for(const[code,month]of[["4015155300","2013-12"],["4015155301","2014-02"]]as const){
  db.prepare("INSERT INTO contract_collection_target(job_id,dtil_prdct_clsfc_no,target_name,status,successful_through_month,updated_at)VALUES('j',?,'pump','paused',?,'t')").run(code,month);
  db.prepare("INSERT INTO contract_month_probe(job_id,dtil_prdct_clsfc_no,month,range_start,range_end,total_count,status,probed_at)VALUES('j',?,'2013-12','s','e',1,'collected','t')").run(code);
 }
 migrateMarketDatabase(db);
 assert.deepEqual(db.prepare("SELECT dtil_prdct_clsfc_no code,successful_through_month throughMonth FROM contract_collection_target").all().map(x=>({...x})),[{code:"40151553",throughMonth:"2013-12"}]);
 assert.equal(db.prepare("SELECT count(*) n FROM contract_month_probe WHERE dtil_prdct_clsfc_no='40151553'").get()!.n,1);
 assert.equal(db.prepare("PRAGMA foreign_key_check").get(),undefined);db.close();
});

test("v20 marker with a stale 10-digit Contract target/checkpoint schema is repaired",()=>{
 const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON");
 for(const migration of MIGRATIONS.filter(x=>x.version<=19)){db.exec("BEGIN");db.exec(migration.sql);db.exec(`PRAGMA user_version=${migration.version}`);db.exec("COMMIT");}
 db.exec(`INSERT INTO contract_collection_job(job_id,status,cutoff_at,created_at,updated_at)VALUES('j','paused','2020','t','t');
 INSERT INTO contract_collection_target(job_id,dtil_prdct_clsfc_no,target_name,status,successful_through_month,updated_at)VALUES('j','4015155300','pump','paused','2013-12','t');
 INSERT INTO contract_month_probe(job_id,dtil_prdct_clsfc_no,month,range_start,range_end,total_count,status,probed_at)VALUES('j','4015155300','2013-12','s','e',1,'collected','t');
 PRAGMA user_version=20;`);
 migrateMarketDatabase(db);
 assert.equal(db.prepare("SELECT dtil_prdct_clsfc_no FROM contract_collection_target").get()!.dtil_prdct_clsfc_no,"40151553");
 assert.equal(db.prepare("SELECT dtil_prdct_clsfc_no FROM contract_month_probe").get()!.dtil_prdct_clsfc_no,"40151553");
 assert.match((db.prepare("SELECT sql FROM sqlite_master WHERE name='contract_collection_target'").get()as{sql:string}).sql,/length\(dtil_prdct_clsfc_no\)=8/u);
 assert.equal(db.prepare("PRAGMA foreign_key_check").get(),undefined);db.close();
});
