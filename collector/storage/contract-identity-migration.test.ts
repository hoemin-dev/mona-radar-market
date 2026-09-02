import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { normalizeContractRawItem } from "../normalization/contract-repository.js";
import { migrateMarketDatabase } from "./database.js";
import { MIGRATIONS } from "./migrations.js";

const HASH = "a".repeat(64);
function v21(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const migration of MIGRATIONS.filter(({version})=>version<=21)) {
    db.exec("BEGIN"); db.exec(migration.sql); db.exec(`PRAGMA user_version=${migration.version}`); db.exec("COMMIT");
  }
  return db;
}
function raw(db:DatabaseSync,id:number,decision:string,name="contract"):void {
  const json=JSON.stringify({dcsnCntrctNo:decision,cntrctNm:name,thtmCntrctAmt:"10",cntrctCnclsDate:"2026-01-01"});
  db.prepare("INSERT INTO api_raw_item(raw_item_id,service,operation,item_sha256,canonical_json,parser_version,first_seen_at)VALUES(?,'CntrctInfoService','getCntrctInfoListThngPPSSrch',?,?, 't','t')").run(id,String(id).padStart(64,"0"),json);
}
function result(db:DatabaseSync,id:number,target:string,decision:string,rawId:number):void {
  db.prepare("INSERT INTO contract_result(contract_result_id,target_detailed_product_class_no,decision_contract_no,contract_name,contract_amount,contract_date,source_raw_item_id,source_operation,semantic_row_hash,semantic_state_json,parse_warnings_json,first_normalized_at,last_normalized_at)VALUES(?,?,?,?,10,'2026-01-01',?,'getCntrctInfoListThngPPSSrch',?,'{}','[]','t','t')").run(id,target,decision,"contract",rawId,HASH);
}

test("v22 merges 5300/5301 Contract identities, normalizes items, and preserves the oldest linked result id",()=>{
  const db=v21(); raw(db,1,"D"); result(db,10,"4015155300","D",1); result(db,20,"4015155301","D",1);
  db.exec("INSERT INTO procurement_group(representative_title,item_category,has_bid,has_award,has_contract,bid_count,award_count,contract_count,match_status,rebuilt_at)VALUES('g','unknown',0,0,1,0,0,2,'UNLINKED','t')");
  db.prepare("INSERT INTO procurement_group_member VALUES(1,'CONTRACT',10,'RESULT','UNLINKED')").run();
  db.prepare("INSERT INTO procurement_relation(from_type,from_id,to_type,to_id,relation_type,match_method,evidence_json,rebuilt_at)VALUES('CONTRACT',20,'BID',99,'x','EXACT','{}','t')").run();
  db.prepare("INSERT INTO contract_header(contract_header_id,unty_cntrct_no,decision_contract_no,source_raw_item_id,source_operation,raw_json,first_seen_at,updated_at)VALUES(1,'U','D',1,'getCntrctInfoListThngPPSSrch','{}','t','t')").run();
  db.prepare("INSERT INTO contract_item(contract_header_id,source_fingerprint,unty_cntrct_no,decision_contract_no,target_detailed_product_class_no,resolution_status,resolution_reason,source_raw_item_id,source_operation,raw_json,first_seen_at,updated_at)VALUES(1,?,'U','D','4015155301','RESOLVED_TARGET','test',1,'getCntrctInfoListThngDetail','{}','t','t')").run("b".repeat(64));
  const bidSchema=(db.prepare("SELECT sql FROM sqlite_master WHERE name='bid_notice'").get()as{sql:string}).sql;
  const awardSchema=(db.prepare("SELECT sql FROM sqlite_master WHERE name='award_result'").get()as{sql:string}).sql;
  migrateMarketDatabase(db); migrateMarketDatabase(db);
  assert.deepEqual({...db.prepare("SELECT contract_result_id id,target_detailed_product_class_no target,decision_contract_no decision FROM contract_result").get()!},{id:10,target:"40151553",decision:"D"});
  assert.equal(db.prepare("SELECT target_detailed_product_class_no target FROM contract_item").get()!.target,"40151553");
  assert.equal(db.prepare("SELECT source_id id FROM procurement_group_member WHERE source_type='CONTRACT'").get()!.id,10);
  assert.equal(db.prepare("SELECT from_id id FROM procurement_relation WHERE from_type='CONTRACT'").get()!.id,10);
  assert.equal((db.prepare("SELECT sql FROM sqlite_master WHERE name='bid_notice'").get()as{sql:string}).sql,bidSchema);
  assert.equal((db.prepare("SELECT sql FROM sqlite_master WHERE name='award_result'").get()as{sql:string}).sql,awardSchema);
  assert.equal(db.prepare("PRAGMA foreign_key_check").get(),undefined); db.close();
});

for(const legacy of ["4015155300","4015155301"]){
  test(`v22 and Contract upsert reuse a ${legacy} identity for the 8-digit target`,()=>{
    const db=v21();raw(db,1,"D");result(db,7,legacy,"D",1);migrateMarketDatabase(db);
    const first=normalizeContractRawItem(db,1,"40151553","fresh"),resume=normalizeContractRawItem(db,1,"40151553","resume");
    assert.equal(first.contractResultId,7);assert.equal(resume.contractResultId,7);
    assert.equal(db.prepare("SELECT count(*) n FROM contract_result").get()!.n,1);db.close();
  });
}

test("a new Contract is inserted once and repeated Fresh/Resume does not grow rows",()=>{
  const db=v21();raw(db,1,"NEW");migrateMarketDatabase(db);
  const created=normalizeContractRawItem(db,1,"40151553","fresh");
  const fresh=normalizeContractRawItem(db,1,"40151553","fresh-again");
  const resume=normalizeContractRawItem(db,1,"40151553","resume");
  assert.equal(created.action,"inserted");assert.equal(fresh.contractResultId,created.contractResultId);assert.equal(resume.contractResultId,created.contractResultId);
  assert.equal(db.prepare("SELECT count(*) n FROM contract_result").get()!.n,1);db.close();
});
