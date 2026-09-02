import assert from "node:assert/strict";
import test from "node:test";
import { openMarketDatabase } from "../storage/database.js";
import { ensureContractJob, nextContractWork, parseContractAction, monthRange } from "./contract-state.js";
import { createHash } from "node:crypto";
import { upsertContractHeader, upsertContractItem } from "../normalization/contract-source-derived.js";
import { normalizeEvidenceBackedContractResults } from "../normalization/contract-repository.js";

const targets = ["4015155300", "4015155301"].map(dtilPrdctClsfcNo => ({dtilPrdctClsfcNo, dtilPrdctClsfcNoNm: "전진공동펌프"}));

test("fresh preserves old jobs and data, registers selected targets, and resumes its own checkpoint", () => {
  const db = openMarketDatabase(":memory:");
  try {
    const oldTime = new Date("2026-08-28T00:00:00Z"), now = new Date("2026-08-31T00:00:00Z");
    const old = ensureContractJob(db, targets, oldTime);
    db.prepare("UPDATE contract_collection_target SET successful_through_month='2024-05',status='paused' WHERE job_id=?").run(old);
    const snapshot = (table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    const oldJobs = snapshot("contract_collection_job"), oldTargets = snapshot("contract_collection_target");
    const raw = (operation: string, item: Record<string, string>) => {
      const json = JSON.stringify(item);
      return Number(db.prepare("INSERT INTO api_raw_item(service,operation,item_sha256,canonical_json,parser_version,first_seen_at)VALUES('CntrctInfoService',?,?,?,'test',?)").run(operation,createHash("sha256").update(json).digest("hex"),json,oldTime.toISOString()).lastInsertRowid);
    };
    const rawId = raw("getCntrctInfoListThngPPSSrch", {untyCntrctNo:"U-preserve",dcsnCntrctNo:"D-preserve",cntrctNm:"preserved"});
    const header = upsertContractHeader(db, rawId, oldTime.toISOString());
    const detail = raw("getCntrctInfoListThngDetail", {untyCntrctNo:"U-preserve",prdctClsfcNo:"40151553",prdctIdntNo:"11111111"});
    upsertContractItem(db,header,detail,["40151553"],oldTime.toISOString());
    normalizeEvidenceBackedContractResults(db,rawId,header,["40151553"],oldTime.toISOString());
    const tables = ["api_raw_item","contract_header","contract_item","contract_result"];
    const before = tables.map(snapshot);
    for(const rows of before) assert.ok(rows.length > 0);
    assert.equal(ensureContractJob(db,[],now,"resume"),old);
    assert.equal(nextContractWork(db,old)?.month,"2024-06");
    const fresh = ensureContractJob(db,targets,now,"fresh");
    assert.notEqual(fresh,old);
    assert.equal(nextContractWork(db,fresh)?.month,"2004-07");
    assert.deepEqual(db.prepare("SELECT * FROM contract_collection_job WHERE job_id=?").all(old),oldJobs);
    assert.deepEqual(db.prepare("SELECT * FROM contract_collection_target WHERE job_id=? ORDER BY rowid").all(old),oldTargets);
    assert.deepEqual(tables.map(snapshot),before);
    const states=db.prepare("SELECT dtil_prdct_clsfc_no code,successful_through_month throughMonth,status FROM contract_collection_target WHERE job_id=? ORDER BY code").all(fresh);
    assert.deepEqual(states.map(row=>({...row})),[{code:"40151553",throughMonth:null,status:"pending"}]);
    const cutoff=db.prepare("SELECT cutoff_at FROM contract_collection_job WHERE job_id=?").get(fresh)!.cutoff_at as string;
    assert.equal(cutoff,"2026-08-31T09:00:00");
    assert.equal(monthRange("2026-08",cutoff).end,cutoff);
    // A failed process can leave the new job/targets running; resume uses its durable checkpoint.
    db.prepare("UPDATE contract_collection_job SET status='running' WHERE job_id=?").run(fresh);
    db.prepare("UPDATE contract_collection_target SET successful_through_month='2008-03',status='running' WHERE job_id=?").run(fresh);
    assert.equal(ensureContractJob(db,[],new Date("2026-09-01T00:00:00Z"),"resume"),fresh);
    assert.equal(nextContractWork(db,fresh)?.month,"2008-04");
    assert.equal(db.prepare("SELECT cutoff_at FROM contract_collection_job WHERE job_id=?").get(fresh)!.cutoff_at,cutoff);
  } finally { db.close(); }
});

test("fresh requires targets even with a running job; equal timestamps resume the newest job", () => {
  const db=openMarketDatabase(":memory:"), now=new Date("2026-08-31T00:00:00Z");
  try {
    const old=ensureContractJob(db,targets,now);
    db.prepare("UPDATE contract_collection_job SET status='running' WHERE job_id=?").run(old);
    assert.throws(()=>ensureContractJob(db,[],now,"fresh"),/CONTRACT_TARGET_REQUIRED/);
    assert.throws(()=>ensureContractJob(db,[{dtilPrdctClsfcNo:"bad",dtilPrdctClsfcNoNm:"bad"}],now,"fresh"),/INVALID_CONTRACT_TARGET/);
    assert.equal(db.prepare("SELECT count(*) n FROM contract_collection_job").get()!.n,1);
    const fresh=ensureContractJob(db,targets,now,"fresh");
    assert.notEqual(fresh,old);
    assert.equal(ensureContractJob(db,[],now),fresh);
    assert.equal(parseContractAction(),"resume");
    assert.equal(parseContractAction("fresh"),"fresh");
    assert.throws(()=>parseContractAction("invalid"),/INVALID_CONTRACT_ACTION/);
  } finally { db.close(); }
});

test("failed contract month remains resumable until the successful month advances", () => {
  const database = openMarketDatabase(":memory:");
  const now = new Date("2026-08-26T00:00:00Z");
  const jobId = ensureContractJob(database, [{
    dtilPrdctClsfcNo: "4015155301",
    dtilPrdctClsfcNoNm: "전진공동펌프",
  }], now);

  database.prepare(`
    UPDATE contract_collection_target
    SET status = 'paused', successful_through_month = '2007-04'
    WHERE job_id = ?
  `).run(jobId);
  database.prepare(`
    INSERT INTO contract_month_probe (
      job_id, dtil_prdct_clsfc_no, month, range_start, range_end,
      total_count, status, probed_at
    ) VALUES (?, '40151553', '2007-05', '2007-05-01T00:00:00',
      '2007-05-31T23:59:00', 1, 'collecting', ?)
  `).run(jobId, now.toISOString());

  assert.equal(nextContractWork(database, jobId)?.month, "2007-05");

  database.prepare(`
    UPDATE contract_collection_target
    SET successful_through_month = '2007-05'
    WHERE job_id = ?
  `).run(jobId);
  assert.equal(nextContractWork(database, jobId)?.month, "2007-06");
  database.close();
});
