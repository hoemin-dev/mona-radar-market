import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CURRENT_SCHEMA_VERSION, migrateMarketDatabase, openMarketDatabase } from "../storage/database.js";
import { MIGRATIONS } from "../storage/migrations.js";
import { persistRawPage, startCollectorRun, startOperationRun, type PersistRawPageInput } from "../storage/raw-persistence.js";
import { normalizeBidNoticeRawItem } from "./bid-notice-repository.js";
import { BID_NOTICE_OPERATION, BID_NOTICE_SERVICE, normalizeBidNotice } from "./bid-notice.js";

async function liveFixture(name: string): Promise<{ response: { body: { items: Array<Record<string, unknown>>; totalCount: number } } }> {
  return JSON.parse(await readFile(new URL(`../../collector/koneps/fixtures/live-sanitized/${name}`, import.meta.url), "utf8")) as { response: { body: { items: Array<Record<string, unknown>>; totalCount: number } } };
}

function setup(database: DatabaseSync): string {
  const runId = startCollectorRun(database, { mode: "verification", startedAt: "2026-08-14T00:00:00.000Z", appVersion: "test", parserVersion: "normalizer-v1" });
  return startOperationRun(database, { runId, service: BID_NOTICE_SERVICE, operation: BID_NOTICE_OPERATION, queryBasis: "notice_posted_datetime", startedAt: "2026-08-14T00:00:00.000Z" });
}

function persist(database: DatabaseSync, operationRunId: string, items: Array<Record<string, unknown>>, callId: string): readonly number[] {
  const parsedJson = { response: { header: { resultCode: "00", resultMsg: "정상" }, body: { items, pageNo: 1, numOfRows: 5, totalCount: items.length } } };
  const input: PersistRawPageInput = {
    callId, operationRunId, service: BID_NOTICE_SERVICE, operation: BID_NOTICE_OPERATION,
    requestedAt: "2026-08-14T00:00:00.000Z", completedAt: "2026-08-14T00:00:01.000Z", durationMs: 1000,
    httpStatus: 200, resultCode: "00", resultMsg: "정상", pageNo: 1, numOfRows: 5, totalCount: items.length,
    requestMetadata: { inqryDiv: "1" }, requestUrl: "https://apis.data.go.kr/test?pageNo=1&ServiceKey=[REDACTED]",
    responseBytes: new TextEncoder().encode(JSON.stringify(parsedJson)), contentType: "application/json;charset=UTF-8",
    encoding: "UTF-8", parsedJson, parserVersion: "normalizer-v1",
  };
  return persistRawPage(database, input).rawItemIds;
}

test("migrates an existing v1 database through current schema without changing RAW rows", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
  database.exec(MIGRATIONS[0]!.sql);
  database.exec("PRAGMA user_version=1; COMMIT");
  database.prepare(`INSERT INTO collector_run
    (run_id,mode,status,started_at,app_version,parser_version,schema_version) VALUES ('existing','verification','running','now','test','v1',1)`).run();
  migrateMarketDatabase(database);
  assert.equal((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, CURRENT_SCHEMA_VERSION);
  assert.equal((database.prepare("SELECT count(*) AS n FROM collector_run").get() as { n: number }).n, 1);
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name='bid_notice'").get());
  database.close();
});

test("fresh database applies all migrations", () => {
  const database = openMarketDatabase(":memory:");
  assert.equal(CURRENT_SCHEMA_VERSION, MIGRATIONS.at(-1)?.version);
  assert.equal((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, CURRENT_SCHEMA_VERSION);
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name='bid_notice_revision'").get());
  database.close();
});

test("normalizes 2026 live fields with conservative types", async () => {
  const raw = (await liveFixture("bid-notice.json")).response.body.items[0]!;
  const result = normalizeBidNotice(raw);
  assert.equal(typeof result.candidate.bidNtceNo, "string");
  assert.equal(typeof result.candidate.bidNtceOrd, "string");
  assert.match(result.candidate.noticePostedLocal ?? "", /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(typeof result.candidate.allocatedBudgetAmount, "bigint");
  assert.equal(typeof result.candidate.productQuantity, "string");
  assert.equal(result.semanticRowHash.length, 64);
});

test("normalizes sparse 2001 live data instead of rejecting empty optional fields", async () => {
  const raw = (await liveFixture("bid-notice-2001.json")).response.body.items[0]!;
  const result = normalizeBidNotice(raw);
  assert.ok(result.candidate.bidNtceNo);
  assert.ok(result.candidate.bidNtceName);
  assert.ok(result.candidate.noticePostedLocal);
  assert.equal(result.candidate.allocatedBudgetAmount, null);
});

test("empty, malformed optional amount/date produce NULL and warnings without destroying notice", async () => {
  const raw = { ...(await liveFixture("bid-notice.json")).response.body.items[0]!, asignBdgtAmt: "", presmptPrce: "12,345", chgDt: "", opengDt: "not-a-date" };
  const result = normalizeBidNotice(raw);
  assert.equal(result.candidate.allocatedBudgetAmount, null);
  assert.equal(result.candidate.estimatedPrice, null);
  assert.equal(result.candidate.changedLocal, null);
  assert.equal(result.candidate.openingLocal, null);
  assert.ok(result.warnings.some((warning) => warning.field === "presmptPrce" && warning.code === "invalid_integer"));
  assert.ok(result.warnings.some((warning) => warning.field === "opengDt" && warning.code === "invalid_datetime"));
});

test("canonical date and integer conversion reject invalid defaults", () => {
  const result = normalizeBidNotice({ bidNtceNo: "N", bidNtceOrd: "000", bidNtceDt: "2001-03-10 12:30", VAT: "12345", indutyVAT: "" });
  assert.equal(result.candidate.noticePostedLocal, "2001-03-10T12:30:00");
  assert.equal(result.candidate.vatAmount, 12345n);
  assert.equal(result.candidate.industryVatAmount, null);
});

test("inserts, keeps unchanged rows revision-free, and advances current RAW lineage", async () => {
  const database = openMarketDatabase(":memory:");
  try {
    const operationRunId = setup(database);
    const raw = (await liveFixture("bid-notice.json")).response.body.items[0]!;
    const [firstRawId] = persist(database, operationRunId, [raw], "insert-call");
    const inserted = normalizeBidNoticeRawItem(database, firstRawId!, "2026-08-14T00:01:00.000Z");
    const rawWithUnusedChange = { ...raw, ntceInsttOfclNm: "ANOTHER_REDACTED_CONTACT" };
    const [secondRawId] = persist(database, operationRunId, [rawWithUnusedChange], "unchanged-call");
    const unchanged = normalizeBidNoticeRawItem(database, secondRawId!, "2026-08-14T00:02:00.000Z");
    assert.equal(inserted.action, "inserted");
    assert.equal(unchanged.action, "unchanged");
    assert.equal(inserted.semanticRowHash, unchanged.semanticRowHash);
    assert.equal((database.prepare("SELECT source_raw_item_id FROM bid_notice").get() as { source_raw_item_id: number }).source_raw_item_id, secondRawId);
    assert.equal((database.prepare("SELECT count(*) AS n FROM bid_notice_revision").get() as { n: number }).n, 0);
  } finally { database.close(); }
});

test("meaningful update creates revision with old/new RAW lineage and reconstructable states", async () => {
  const database = openMarketDatabase(":memory:");
  try {
    const operationRunId = setup(database);
    const raw = (await liveFixture("bid-notice.json")).response.body.items[0]!;
    const [oldRawId] = persist(database, operationRunId, [raw], "old-call");
    normalizeBidNoticeRawItem(database, oldRawId!, "2026-08-14T00:01:00.000Z");
    const [newRawId] = persist(database, operationRunId, [{ ...raw, bidNtceNm: `${raw.bidNtceNm} 변경` }], "new-call");
    const updated = normalizeBidNoticeRawItem(database, newRawId!, "2026-08-14T00:02:00.000Z");
    assert.equal(updated.action, "updated");
    const revision = database.prepare(`SELECT previous_row_hash,new_row_hash,previous_source_raw_item_id,
      new_source_raw_item_id,previous_state_json,new_state_json FROM bid_notice_revision`).get() as Record<string, unknown>;
    assert.notEqual(revision.previous_row_hash, revision.new_row_hash);
    assert.equal(revision.previous_source_raw_item_id, oldRawId);
    assert.equal(revision.new_source_raw_item_id, newRawId);
    assert.notEqual(revision.previous_state_json, revision.new_state_json);
  } finally { database.close(); }
});

test("semantic hash excludes technical lineage and timestamps", async () => {
  const raw = (await liveFixture("bid-notice.json")).response.body.items[0]!;
  const first = normalizeBidNotice(raw);
  const second = normalizeBidNotice({ ...raw });
  assert.equal(first.semanticRowHash, second.semanticRowHash);
  assert.doesNotMatch(first.semanticStateJson, /source_raw_item_id|normalized_at/iu);
});

test("normalized database supports date, organization, product, and name queries without secrets", async () => {
  const database = openMarketDatabase(":memory:");
  try {
    const operationRunId = setup(database);
    const fixture = await liveFixture("bid-notice.json");
    const rawIds = persist(database, operationRunId, fixture.response.body.items, "search-call");
    rawIds.forEach((rawItemId, index) => normalizeBidNoticeRawItem(database, rawItemId, `2026-08-14T00:0${index}:00.000Z`));
    const sample = fixture.response.body.items[0]!;
    const found = database.prepare(`SELECT bid_ntce_no FROM bid_notice WHERE notice_posted_local IS NOT NULL
      AND notice_institution_code = ? AND detailed_product_class_no = ? AND bid_ntce_name LIKE ?`)
      .all(sample.ntceInsttCd as string, sample.dtilPrdctClsfcNo as string, `%${String(sample.bidNtceNm).slice(0, 2)}%`);
    assert.ok(found.length >= 1);
    const normalizedText = database.prepare("SELECT group_concat(semantic_state_json || parse_warnings_json) AS text FROM bid_notice").get() as { text: string };
    assert.doesNotMatch(normalizedText.text, /ServiceKey|KONEPS_SERVICE_KEY/iu);
  } finally { database.close(); }
});
