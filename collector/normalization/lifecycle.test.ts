import test from "node:test";
import assert from "node:assert/strict";
import { openMarketDatabase } from "../storage/database.js";
import { saveLifecycle } from "./lifecycle.js";
test("official lifecycle preserves award and contract arrays as group members", () => { const db = openMarketDatabase(":memory:"), at = "2026-08-21T00:00:00.000Z"; db.prepare("INSERT INTO api_raw_item(service,operation,item_sha256,canonical_json,parser_version,first_seen_at)VALUES('CntrctProcssIntgOpenService','getCntrctProcssIntgOpenThng',?,?,'test',?)").run("a".repeat(64), JSON.stringify({ bidNtceNo: "1" }), at); const raw = Number((db.prepare("SELECT last_insert_rowid() id").get() as {
    id: number;
}).id); db.prepare("INSERT INTO bid_notice(bid_ntce_no,bid_ntce_ord,source_raw_item_id,source_operation,semantic_row_hash,semantic_state_json,parse_warnings_json,first_normalized_at,last_normalized_at)VALUES('1','000',?,'test',?,'{}','[]',?,?)").run(raw, "b".repeat(64), at, at); const bid = Number((db.prepare("SELECT bid_notice_id id FROM bid_notice").get() as {
    id: number;
}).id), result = saveLifecycle(db, { bidNoticeId: bid, rawItemId: raw, collectedAt: at, payload: { bidNtceNo: "1", bidNtceOrd: "000", bidwinrInfoList: [{ bidwinrNm: "A" }, { bidwinrNm: "B" }], cntrctInfoList: [{ cntrctNo: "C1" }, { cntrctNo: "C2" }] } }); assert.deepEqual(result, { awards: 2, contracts: 2, matchedAwards: 0, matchedContracts: 0, unmatched: 4, ambiguous: 0 }); assert.equal((db.prepare("SELECT count(*) n FROM lifecycle_group_member").get() as {
    n: number;
}).n, 4); assert.equal((db.prepare("SELECT count(*) n FROM bid_contract_link WHERE contract_result_id IS NULL").get() as {
    n: number;
}).n, 2); db.close(); });
