import assert from "node:assert/strict";
import test from "node:test";
import { openMarketDatabase } from "../storage/database.js";
import { ensureContractJob, nextContractWork } from "./contract-state.js";

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
    ) VALUES (?, '4015155301', '2007-05', '2007-05-01T00:00:00',
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
