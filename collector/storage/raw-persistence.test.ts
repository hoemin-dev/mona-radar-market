import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { CURRENT_SCHEMA_VERSION, migrateMarketDatabase, openMarketDatabase } from "./database.js";
import { persistFailedCall, persistRawPage, stableStringify, startCollectorRun, startOperationRun, type PersistRawPageInput } from "./raw-persistence.js";

const SERVICE = "BidPublicInfoService";
const OPERATION = "getBidPblancListInfoThngPPSSrch";
const FAKE_KEY = "TEST_KONEPS_KEY_DO_NOT_USE";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../../collector/koneps/fixtures/${name}`, import.meta.url), "utf8")) as unknown;
}

async function liveFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`../../collector/koneps/fixtures/live-sanitized/${name}`, import.meta.url), "utf8")) as unknown;
}

function count(database: DatabaseSync, table: string): number {
  return Number((database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function setup(database: DatabaseSync): { runId: string; operationRunId: string } {
  const runId = startCollectorRun(database, { mode: "verification", startedAt: "2026-08-14T00:00:00.000Z", appVersion: "test", parserVersion: "test-v1" });
  const operationRunId = startOperationRun(database, { runId, service: SERVICE, operation: OPERATION, queryBasis: "notice_posted_datetime", startedAt: "2026-08-14T00:00:00.000Z" });
  return { runId, operationRunId };
}

function pageInput(operationRunId: string, parsedJson: unknown, overrides: Partial<PersistRawPageInput> = {}): PersistRawPageInput {
  const responseText = JSON.stringify(parsedJson);
  return {
    operationRunId,
    service: SERVICE,
    operation: OPERATION,
    requestedAt: "2026-08-14T00:00:00.000Z",
    completedAt: "2026-08-14T00:00:01.000Z",
    durationMs: 1000,
    httpStatus: 200,
    resultCode: "00",
    resultMsg: "정상",
    pageNo: 1,
    numOfRows: 5,
    totalCount: 0,
    requestMetadata: { inqryDiv: "1", ServiceKey: FAKE_KEY },
    requestUrl: `https://apis.data.go.kr/test?pageNo=1&ServiceKey=${FAKE_KEY}`,
    responseBytes: new TextEncoder().encode(responseText),
    contentType: "application/json;charset=UTF-8",
    encoding: "UTF-8",
    parsedJson,
    parserVersion: "test-v1",
    secrets: [FAKE_KEY],
    ...overrides,
  };
}

test("creates the Phase 3-C schema and migration is idempotent", () => {
  const database = openMarketDatabase(":memory:");
  try {
    assert.equal((database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, CURRENT_SCHEMA_VERSION);
    migrateMarketDatabase(database);
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => (row as { name: string }).name);
    for (const table of ["collector_run", "collector_operation_run", "api_call", "api_response_blob", "api_raw_item", "raw_item_observation"]) assert.ok(tables.includes(table));
  } finally { database.close(); }
});

test("creates a file database in an isolated runtime-style path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mona-market-db-"));
  const path = join(directory, "runtime", "market.sqlite3");
  const database = openMarketDatabase(path);
  database.close();
  assert.ok((await readFile(path)).byteLength > 0);
  await rm(directory, { recursive: true, force: true });
});

test("deduplicates response blobs and raw items while retaining observations per call", async () => {
  const database = openMarketDatabase(":memory:");
  try {
    const { operationRunId } = setup(database);
    const parsed = await liveFixture("bid-notice.json");
    const first = persistRawPage(database, pageInput(operationRunId, parsed, { totalCount: 14 }));
    const second = persistRawPage(database, pageInput(operationRunId, parsed, { callId: "second-call", totalCount: 14 }));
    assert.equal(first.actualItemCount, 5);
    assert.equal(first.responseBlobId, second.responseBlobId);
    assert.deepEqual(first.rawItemIds, second.rawItemIds);
    assert.equal(count(database, "api_response_blob"), 1);
    assert.equal(count(database, "api_raw_item"), 5);
    assert.equal(count(database, "api_call"), 2);
    assert.equal(count(database, "raw_item_observation"), 10);
  } finally { database.close(); }
});

test("persists empty, single, and multi-item response shapes", async () => {
  const database = openMarketDatabase(":memory:");
  try {
    const { operationRunId } = setup(database);
    const empty = { response: { header: { resultCode: "00", resultMsg: "정상" }, body: { items: [], pageNo: 1, numOfRows: 5, totalCount: 0 } } };
    const normal = await fixture("normal.json") as { response: { body: { items: { item: unknown[] } } } };
    const multi = await liveFixture("bid-notice.json");
    assert.equal(persistRawPage(database, pageInput(operationRunId, empty, { callId: "empty" })).actualItemCount, 0);
    assert.equal(persistRawPage(database, pageInput(operationRunId, normal, { callId: "single", totalCount: 1 })).actualItemCount, 1);
    assert.equal(persistRawPage(database, pageInput(operationRunId, multi, { callId: "multi", totalCount: 14 })).actualItemCount, 5);
    assert.equal(count(database, "api_call"), 3);
    assert.equal(count(database, "raw_item_observation"), 6);
  } finally { database.close(); }
});

test("canonical JSON preserves empty, null, missing, and key-order-independent identity", () => {
  const left = { z: "", b: null, nested: { y: "2", x: "1" } };
  const right = { nested: { x: "1", y: "2" }, b: null, z: "" };
  assert.equal(stableStringify(left), stableStringify(right));
  const decoded = JSON.parse(stableStringify(left)) as Record<string, unknown>;
  assert.equal(decoded.z, "");
  assert.equal(decoded.b, null);
  assert.equal("missing" in decoded, false);
});

test("round-trips the sanitized live fixture through canonical raw SQLite", async () => {
  const database = openMarketDatabase(":memory:");
  try {
    const { operationRunId } = setup(database);
    const parsed = await liveFixture("bid-notice.json") as { response: { body: { items: Array<Record<string, unknown>> } } };
    persistRawPage(database, pageInput(operationRunId, parsed, { totalCount: 14 }));
    const rows = database.prepare(`SELECT r.canonical_json FROM raw_item_observation o
      JOIN api_raw_item r ON r.raw_item_id = o.raw_item_id ORDER BY o.item_ordinal`).all();
    assert.equal(rows.length, parsed.response.body.items.length);
    rows.forEach((row, index) => assert.equal((row as { canonical_json: string }).canonical_json, stableStringify(parsed.response.body.items[index])));
  } finally { database.close(); }
});

test("redacts ServiceKey from URL and metadata before SQLite persistence", async () => {
  const database = openMarketDatabase(":memory:");
  try {
    const { operationRunId } = setup(database);
    persistRawPage(database, pageInput(operationRunId, await fixture("empty.json")));
    const row = database.prepare("SELECT redacted_url, request_metadata_json FROM api_call").get() as { redacted_url: string; request_metadata_json: string };
    assert.doesNotMatch(JSON.stringify(row), new RegExp(FAKE_KEY, "u"));
    assert.match(row.redacted_url, /ServiceKey=\[REDACTED\]/u);
    const storedText = database.prepare("SELECT group_concat(redacted_url || request_metadata_json) AS text FROM api_call").get() as { text: string };
    assert.doesNotMatch(storedText.text, new RegExp(FAKE_KEY, "u"));
  } finally { database.close(); }
});

test("rolls back the entire page when an item persistence step fails", async () => {
  const database = openMarketDatabase(":memory:");
  try {
    const { operationRunId } = setup(database);
    const parsed = await liveFixture("bid-notice.json");
    assert.throws(() => persistRawPage(database, pageInput(operationRunId, parsed, { failAfterItemOrdinalForTest: 1, totalCount: 14 })), /intentional/u);
    assert.equal(count(database, "api_response_blob"), 0);
    assert.equal(count(database, "api_call"), 0);
    assert.equal(count(database, "api_raw_item"), 0);
    assert.equal(count(database, "raw_item_observation"), 0);
  } finally { database.close(); }
});

test("persists failed call evidence without raw-item observations", () => {
  const database = openMarketDatabase(":memory:");
  try {
    const { operationRunId } = setup(database);
    persistFailedCall(database, {
      callId: "failed-call", operationRunId, service: SERVICE, operation: OPERATION,
      requestedAt: "2026-08-14T00:00:00.000Z", completedAt: "2026-08-14T00:00:01.000Z",
      durationMs: 1000, httpStatus: 500, pageNo: 1, numOfRows: 5,
      requestMetadata: { ServiceKey: FAKE_KEY }, requestUrl: `https://apis.data.go.kr/test?ServiceKey=${FAKE_KEY}`,
      errorCategory: "http", parseStatus: "not_attempted", responseBytes: new TextEncoder().encode("temporary"),
      contentType: "text/plain", encoding: "UTF-8", secrets: [FAKE_KEY],
    });
    const call = database.prepare("SELECT status, error_category, response_blob_id FROM api_call").get() as { status: string; error_category: string; response_blob_id: number };
    assert.deepEqual({ status: call.status, category: call.error_category }, { status: "failed", category: "http" });
    assert.equal(typeof call.response_blob_id, "number");
    assert.equal(count(database, "raw_item_observation"), 0);
  } finally { database.close(); }
});
