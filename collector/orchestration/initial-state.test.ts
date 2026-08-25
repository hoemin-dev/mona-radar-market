import test from "node:test";
import assert from "node:assert/strict";
import { openMarketDatabase } from "../storage/database.js";
import { ensureInitialJob,monthRange,nextInitialWork,nextMonth } from "./initial-state.js";

test("monthly ranges handle leap years and current-month cutoff",()=>{
  assert.deepEqual(monthRange("2024-02","2024-03-07T12:34:56"),{start:"2024-02-01T00:00:00",end:"2024-02-29T23:59:00"});
  assert.deepEqual(monthRange("2023-04","2024-03-07T12:34:56"),{start:"2023-04-01T00:00:00",end:"2023-04-30T23:59:00"});
  assert.equal(monthRange("2024-03","2024-03-07T12:34:56").end,"2024-03-07T12:34:56");
  assert.equal(nextMonth("2024-12"),"2025-01");
});
test("initial job resumes per target from durable month checkpoint",()=>{const db=openMarketDatabase(":memory:"),now=new Date("2026-08-19T00:00:00Z");const id=ensureInitialJob(db,[{dtilPrdctClsfcNo:"4015155301",dtilPrdctClsfcNoNm:"pump"}],now);assert.equal(nextInitialWork(db,id)?.month,"2001-01");db.prepare("UPDATE initial_collection_target SET successful_through_month='2001-02',status='paused' WHERE job_id=?").run(id);assert.equal(nextInitialWork(db,id)?.month,"2001-03");assert.equal(ensureInitialJob(db,[],now),id);db.close();});

test("adding both fixed targets preserves a completed historical bid target",()=>{const db=openMarketDatabase(":memory:"),now=new Date("2026-08-19T00:00:00Z"),targets=[{dtilPrdctClsfcNo:"4015155300",dtilPrdctClsfcNoNm:"전진공동펌프"},{dtilPrdctClsfcNo:"4015155301",dtilPrdctClsfcNoNm:"전진공동펌프"}];const id=ensureInitialJob(db,[targets[0]!],now);db.prepare("UPDATE initial_collection_target SET successful_through_month='2026-08',status='completed' WHERE job_id=? AND dtil_prdct_clsfc_no='4015155300'").run(id);ensureInitialJob(db,targets,now);const historical=db.prepare("SELECT status,successful_through_month throughMonth FROM initial_collection_target WHERE job_id=? AND dtil_prdct_clsfc_no='4015155300'").get(id)as{status:string;throughMonth:string};assert.equal(historical.status,"completed");assert.equal(historical.throughMonth,"2026-08");assert.equal(nextInitialWork(db,id)?.code,"4015155301");db.close();});

test("partial month is durable and resume stays after the previous successful month",()=>{const db=openMarketDatabase(":memory:"),now=new Date("2026-08-19T00:00:00Z");const id=ensureInitialJob(db,[{dtilPrdctClsfcNo:"4015155301",dtilPrdctClsfcNoNm:"pump"}],now);db.prepare("UPDATE initial_collection_target SET successful_through_month='2016-05',status='paused' WHERE job_id=?").run(id);db.prepare("INSERT INTO initial_month_probe(job_id,dtil_prdct_clsfc_no,month,range_start,range_end,total_count,status,probed_at) VALUES(?,?,?,?,?,?,'partial',?)").run(id,"4015155301","2016-06","2016-06-01T00:00:00","2016-06-30T23:59:00",1,now.toISOString());assert.equal(nextInitialWork(db,id)?.month,"2016-06");assert.equal((db.prepare("SELECT status FROM initial_month_probe WHERE job_id=? AND month='2016-06'").get(id) as {status:string}).status,"partial");db.close();});
