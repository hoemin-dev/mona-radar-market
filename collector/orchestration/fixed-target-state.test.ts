import assert from "node:assert/strict";
import test from "node:test";
import { openMarketDatabase } from "../storage/database.js";
import { FIXED_TARGETS } from "../koneps/target-registry.js";
import { ensureAwardJob } from "./award-state.js";
import { ensureContractJob } from "./contract-state.js";

test("award and contract jobs accept both fixed targets", () => {
  const db = openMarketDatabase(":memory:");
  const now = new Date("2026-08-25T00:00:00Z");
  const awardJob = ensureAwardJob(db, FIXED_TARGETS, now);
  const contractJob = ensureContractJob(db, FIXED_TARGETS, now);
  const codes = (table: string, job: string) => (db.prepare(`SELECT dtil_prdct_clsfc_no code FROM ${table} WHERE job_id=? ORDER BY code`).all(job) as {code:string}[]).map(row => row.code);
  assert.deepEqual(codes("award_collection_target", awardJob), ["4015155300", "4015155301"]);
  assert.deepEqual(codes("contract_collection_target", contractJob), ["40151553"]);
  db.close();
});
