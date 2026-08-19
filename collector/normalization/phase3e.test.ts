import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { openMarketDatabase, migrateMarketDatabase, CURRENT_SCHEMA_VERSION } from "../storage/database.js";
import { MIGRATIONS } from "../storage/migrations.js";
import { persistRawPage, startCollectorRun, startOperationRun } from "../storage/raw-persistence.js";
import { normalizeBidNoticeRawItem } from "./bid-notice-repository.js";
import { BID_NOTICE_OPERATION, BID_NOTICE_SERVICE } from "./bid-notice.js";
import { normalizeBidBasisAmountRawItem, normalizeBidItemRawItem } from "./phase3e-repository.js";
import { BID_BASIS_AMOUNT_OPERATION, BID_ITEM_OPERATION, PHASE3E_SERVICE, normalizeBidBasisAmount, normalizeBidItem } from "./phase3e.js";

type Fixture = { response:{ body:{ items:Array<Record<string,unknown>>; pageNo:number; numOfRows:number; totalCount:number } } };
async function fixture(name:string):Promise<Fixture> { return JSON.parse(await readFile(new URL(`../../collector/koneps/fixtures/live-sanitized/${name}`,import.meta.url),"utf8")) as Fixture; }

function operation(database:DatabaseSync, runId:string, op:string):string {
  return startOperationRun(database,{runId,service:PHASE3E_SERVICE,operation:op,queryBasis:"identity",startedAt:"2026-08-14T02:00:00.000Z"});
}
function persist(database:DatabaseSync, operationRunId:string, operationName:string, item:Record<string,unknown>, callId:string):number {
  const parsedJson={response:{header:{resultCode:"00",resultMsg:"OK"},body:{items:[item],pageNo:1,numOfRows:5,totalCount:1}}};
  return persistRawPage(database,{callId,operationRunId,service:PHASE3E_SERVICE,operation:operationName,requestedAt:"2026-08-14T02:00:00.000Z",completedAt:"2026-08-14T02:00:01.000Z",durationMs:1,httpStatus:200,resultCode:"00",resultMsg:"OK",pageNo:1,numOfRows:5,totalCount:1,requestMetadata:{inqryDiv:"2"},requestUrl:"https://apis.data.go.kr/test?ServiceKey=[REDACTED]",responseBytes:new TextEncoder().encode(JSON.stringify(parsedJson)),parsedJson,parserVersion:"phase3e-test"}).rawItemIds[0]!;
}
async function setup():Promise<{db:DatabaseSync;runId:string;item:Record<string,unknown>;basis:Record<string,unknown>}> {
  const db=openMarketDatabase(":memory:");
  const runId=startCollectorRun(db,{mode:"verification",startedAt:"2026-08-14T02:00:00.000Z",appVersion:"test",parserVersion:"phase3e-test"});
  const notice=(await fixture("bid-notice.json")).response.body.items[0]!;
  const noticeOp=operation(db,runId,BID_NOTICE_OPERATION);
  normalizeBidNoticeRawItem(db,persist(db,noticeOp,BID_NOTICE_OPERATION,notice,"notice-call"),"2026-08-14T02:01:00.000Z");
  return {db,runId,item:(await fixture("bid-item.json")).response.body.items[0]!,basis:(await fixture("bid-basis-amount.json")).response.body.items[0]!};
}

test("migration v3 remains valid when databases continue through current schema",()=>{
  const db=new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys=ON; BEGIN"); db.exec(MIGRATIONS[0]!.sql); db.exec(MIGRATIONS[1]!.sql); db.exec("PRAGMA user_version=2; COMMIT");
  migrateMarketDatabase(db); migrateMarketDatabase(db);
  assert.equal(CURRENT_SCHEMA_VERSION,8); assert.equal((db.prepare("PRAGMA user_version").get() as {user_version:number}).user_version,CURRENT_SCHEMA_VERSION);
  for(const table of ["bid_item","bid_item_revision","bid_basis_amount","bid_basis_amount_revision"]) assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
  db.close(); const fresh=openMarketDatabase(":memory:"); assert.equal((fresh.prepare("PRAGMA user_version").get() as {user_version:number}).user_version,CURRENT_SCHEMA_VERSION); fresh.close();
});

test("live fixtures retain exact array nesting and 19/24 string fields",async()=>{
  const item=await fixture("bid-item.json"), basis=await fixture("bid-basis-amount.json");
  assert.ok(Array.isArray(item.response.body.items)); assert.ok(Array.isArray(basis.response.body.items));
  assert.equal(Object.keys(item.response.body.items[0]!).length,19); assert.equal(Object.keys(basis.response.body.items[0]!).length,24);
  assert.ok(Object.values(item.response.body.items[0]!).every(v=>typeof v==="string")); assert.ok(Object.values(basis.response.body.items[0]!).every(v=>typeof v==="string"));
});

test("pure normalizers apply conservative amount, datetime, empty, and decimal policies",async()=>{
  const item=normalizeBidItem((await fixture("bid-item.json")).response.body.items[0]!);
  assert.equal(item.candidate.unitPrice,19600000n); assert.equal(item.candidate.quantity,"1"); assert.equal(item.candidate.deliveryDeadlineLocal,null); assert.match(item.candidate.noticePostedLocal!,/T16:38:05$/u);
  const basis=normalizeBidBasisAmount((await fixture("bid-basis-amount.json")).response.body.items[0]!);
  assert.equal(basis.candidate.basisAmount,19600000n); assert.equal(basis.candidate.reservePriceRangeBeginRate,"-3"); assert.equal(basis.candidate.reservePriceRangeEndRate,"3"); assert.equal(basis.candidate.evaluationBasisAmount,null);
  const malformed=normalizeBidBasisAmount({...((await fixture("bid-basis-amount.json")).response.body.items[0]!),bssamt:"12,000",dfcltydgrCfcnt:"1.2.3",inptDt:"bad"});
  assert.equal(malformed.candidate.basisAmount,null); assert.equal(malformed.candidate.difficultyCoefficient,null); assert.equal(malformed.candidate.inputLocal,null); assert.equal(malformed.warnings.length,3);
});

test("missing parent defers both projections without orphan rows",async()=>{
  const db=openMarketDatabase(":memory:"); const runId=startCollectorRun(db,{mode:"verification",startedAt:"now",appVersion:"test",parserVersion:"test"});
  const item=(await fixture("bid-item.json")).response.body.items[0]!, basis=(await fixture("bid-basis-amount.json")).response.body.items[0]!;
  assert.equal(normalizeBidItemRawItem(db,persist(db,operation(db,runId,BID_ITEM_OPERATION),BID_ITEM_OPERATION,item,"orphan-item"),"now").action,"deferred");
  assert.equal(normalizeBidBasisAmountRawItem(db,persist(db,operation(db,runId,BID_BASIS_AMOUNT_OPERATION),BID_BASIS_AMOUNT_OPERATION,basis,"orphan-basis"),"now").action,"deferred");
  assert.equal((db.prepare("SELECT count(*) n FROM bid_item").get() as {n:number}).n,0); db.close();
});

test("bid item insert/unchanged/update preserves RAW lineage and creates one revision",async()=>{
  const {db,runId,item}=await setup(); try { const op=operation(db,runId,BID_ITEM_OPERATION);
    const a=persist(db,op,BID_ITEM_OPERATION,item,"item-a"); assert.equal(normalizeBidItemRawItem(db,a,"t1").action,"inserted");
    const b=persist(db,op,BID_ITEM_OPERATION,{...item,unusedLiveField:"ignored"},"item-b"); assert.equal(normalizeBidItemRawItem(db,b,"t2").action,"unchanged");
    const c=persist(db,op,BID_ITEM_OPERATION,{...item,qty:"2"},"item-c"); assert.equal(normalizeBidItemRawItem(db,c,"t3").action,"updated");
    const row=db.prepare("SELECT quantity,source_raw_item_id,bid_notice_id FROM bid_item").get() as Record<string,unknown>; assert.equal(row.quantity,"2"); assert.equal(row.source_raw_item_id,c); assert.ok(row.bid_notice_id);
    const rev=db.prepare("SELECT previous_source_raw_item_id,new_source_raw_item_id FROM bid_item_revision").get() as Record<string,unknown>; assert.equal(rev.previous_source_raw_item_id,b); assert.equal(rev.new_source_raw_item_id,c);
  } finally {db.close();}
});

test("basis amount insert/unchanged/update preserves precision, lineage, and revision",async()=>{
  const {db,runId,basis}=await setup(); try { const op=operation(db,runId,BID_BASIS_AMOUNT_OPERATION);
    const a=persist(db,op,BID_BASIS_AMOUNT_OPERATION,basis,"basis-a"); assert.equal(normalizeBidBasisAmountRawItem(db,a,"t1").action,"inserted");
    const b=persist(db,op,BID_BASIS_AMOUNT_OPERATION,{...basis,unusedLiveField:"ignored"},"basis-b"); assert.equal(normalizeBidBasisAmountRawItem(db,b,"t2").action,"unchanged");
    const c=persist(db,op,BID_BASIS_AMOUNT_OPERATION,{...basis,bssamt:"19600001",dfcltydgrCfcnt:"1.2300"},"basis-c"); assert.equal(normalizeBidBasisAmountRawItem(db,c,"t3").action,"updated");
    const row=db.prepare("SELECT basis_amount,difficulty_coefficient,source_raw_item_id FROM bid_basis_amount").get() as Record<string,unknown>; assert.equal(row.basis_amount,19600001); assert.equal(row.difficulty_coefficient,"1.23"); assert.equal(row.source_raw_item_id,c);
    assert.equal((db.prepare("SELECT count(*) n FROM bid_basis_amount_revision").get() as {n:number}).n,1);
  } finally {db.close();}
});

test("offline RAW-to-normalized projections support parent, product, institution, date, and amount queries without secrets",async()=>{
  const {db,runId,item,basis}=await setup(); try {
    normalizeBidItemRawItem(db,persist(db,operation(db,runId,BID_ITEM_OPERATION),BID_ITEM_OPERATION,item,"e2e-item"),"t");
    normalizeBidBasisAmountRawItem(db,persist(db,operation(db,runId,BID_BASIS_AMOUNT_OPERATION),BID_BASIS_AMOUNT_OPERATION,basis,"e2e-basis"),"t");
    assert.equal((db.prepare("SELECT count(*) n FROM bid_item i JOIN bid_notice n USING(bid_notice_id) WHERE i.detailed_product_class_no=? AND i.demand_institution_code=?").get(String(item.dtilPrdctClsfcNo),String(item.dminsttCd)) as {n:number}).n,1);
    assert.equal((db.prepare("SELECT count(*) n FROM bid_basis_amount WHERE basis_amount BETWEEN ? AND ? AND basis_amount_open_local>=?").get(19000000,20000000,"2026-01-01") as {n:number}).n,1);
    const dump=JSON.stringify(db.prepare("SELECT * FROM bid_item JOIN bid_basis_amount USING(bid_notice_id)").get()); assert.doesNotMatch(dump,/ServiceKey|REDACTED/iu);
  } finally {db.close();}
});
