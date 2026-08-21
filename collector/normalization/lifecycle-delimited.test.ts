import test from "node:test";
import assert from "node:assert/strict";
import { openMarketDatabase } from "../storage/database.js";
import { lifecyclePayload, saveLifecycle } from "./lifecycle.js";

test("resultCode 00 with no item is NO_DATA input, not a lifecycle payload", () => {
  assert.equal(lifecyclePayload({ response: { header: { resultCode: "00" }, body: { items: [], totalCount: 0 } } }), undefined);
});

test("official lifecycle parses documented delimited lists", () => {
  const db = openMarketDatabase(":memory:");
  const at = "2026-08-21T00:00:00.000Z";
  db.prepare("INSERT INTO api_raw_item(service,operation,item_sha256,canonical_json,parser_version,first_seen_at)VALUES('CntrctProcssIntgOpenService','getCntrctProcssIntgOpenThng',?,?,'test',?)")
    .run("c".repeat(64), JSON.stringify({ bidNtceNo: "1" }), at);
  const raw = Number((db.prepare("SELECT last_insert_rowid() id").get() as { id: number }).id);
  db.prepare("INSERT INTO bid_notice(bid_ntce_no,bid_ntce_ord,source_raw_item_id,source_operation,semantic_row_hash,semantic_state_json,parse_warnings_json,first_normalized_at,last_normalized_at)VALUES('1','000',?,'test',?,'{}','[]',?,?)")
    .run(raw, "d".repeat(64), at, at);
  const bid = Number((db.prepare("SELECT bid_notice_id id FROM bid_notice").get() as { id: number }).id);

  const result = saveLifecycle(db, { bidNoticeId: bid, rawItemId: raw, collectedAt: at, payload: {
    bidNtceNo: "1", bidNtceOrd: "000",
    bidwinrInfoList: "[1^A^1234567890^CEO^1000^90^2^2026-08-21 10:00]",
    cntrctInfoList: "[1^C1^Contract^Agency^Demand^General^1200^2026-08-21]",
  } });

  assert.deepEqual(result, { awards: 1, contracts: 1, matchedAwards: 0, matchedContracts: 0, unmatched: 2, ambiguous: 0 });
  assert.deepEqual({ ...db.prepare("SELECT winner_name,successful_bid_amount FROM lifecycle_award").get() }, { winner_name: "A", successful_bid_amount: 1000 });
  assert.deepEqual({ ...db.prepare("SELECT contract_no,contract_amount,contract_date FROM lifecycle_contract").get() }, { contract_no: "C1", contract_amount: 1200, contract_date: "2026-08-21" });
  db.close();
});
