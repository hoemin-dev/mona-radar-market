import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { KonepsClient } from "./client.js";
import { loadKonepsConfig, type KonepsClientConfig } from "./config.js";
import { BID_BASIS_AMOUNT_OPERATION, BID_ITEM_OPERATION, BID_NOTICE_SEARCH_OPERATION, DETAILED_PRODUCT_CLASSIFICATION_SEARCH_OPERATION } from "./endpoints.js";
import { KonepsError } from "./errors.js";
import { extractLiveItems, inspectLiveShape, sanitizeLiveFixture } from "./live-shape.js";
import { parseVerificationArguments, summarizePagination } from "./verification.js";
import { parsePhase3eArguments } from "./phase3e-verify.js";
import { redactKonepsUrl, redactSecrets } from "./redaction.js";
import type { BidNoticeSearchParams, KonepsFetch } from "./types.js";

const FAKE_KEY = "TEST_KONEPS_KEY_DO_NOT_USE";
const ENCODED_FAKE_KEY = "abc%2Fdef%3D%3D";

const params: BidNoticeSearchParams = {
  pageNo: 1,
  numOfRows: 10,
  type: "json",
  inqryDiv: "1",
  inqryBgnDt: "202608130000",
  inqryEndDt: "202608132359",
};

function config(overrides: Partial<KonepsClientConfig> = {}): KonepsClientConfig {
  return {
    serviceKey: FAKE_KEY,
    serviceKeyMode: "preserve",
    timeoutMs: 100,
    maxRetries: 0,
    baseBackoffMs: 0,
    ...overrides,
  };
}

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`../../collector/koneps/fixtures/${name}`, import.meta.url), "utf8");
}

async function liveFixture(name: string): Promise<string> {
  return readFile(new URL(`../../collector/koneps/fixtures/live-sanitized/${name}`, import.meta.url), "utf8");
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

async function expectKonepsError(action: () => Promise<unknown>, category: KonepsError["category"]): Promise<KonepsError> {
  try {
    await action();
    assert.fail(`Expected ${category} error`);
  } catch (error) {
    assert.ok(error instanceof KonepsError);
    assert.equal(error.category, category);
    return error;
  }
}

test("parses a normal fixture and returns raw bytes plus common envelope", async () => {
  const client = new KonepsClient({ config: config(), fetch: async () => jsonResponse(await fixture("normal.json")) });
  const result = await client.request(BID_NOTICE_SEARCH_OPERATION, params);
  assert.equal(result.envelope.resultCode, "00");
  assert.equal(result.envelope.totalCount, 1);
  assert.ok(result.bodyBytes.byteLength > 0);
  assert.match(result.bodyText, /TEST_NOTICE/u);
  assert.equal(result.metadata.attemptCount, 1);
  assert.equal(client.counters.requestCount, 1);
});

test("accepts an empty-result fixture without assuming an items nesting shape", async () => {
  const client = new KonepsClient({ config: config(), fetch: async () => jsonResponse(await fixture("empty.json")) });
  const result = await client.request(BID_NOTICE_SEARCH_OPERATION, params);
  assert.equal(result.envelope.totalCount, 0);
});

test("classifies HTTP 200 with non-success resultCode as api error", async () => {
  const client = new KonepsClient({ config: config(), fetch: async () => jsonResponse(await fixture("api-error.json")) });
  const error = await expectKonepsError(() => client.request(BID_NOTICE_SEARCH_OPERATION, params), "api");
  assert.equal(error.metadata?.resultCode, "30");
});

test("classifies non-retryable/exhausted HTTP errors without response body leakage", async () => {
  const client = new KonepsClient({ config: config(), fetch: async () => jsonResponse("server details", 500) });
  const error = await expectKonepsError(() => client.request(BID_NOTICE_SEARCH_OPERATION, params), "http");
  assert.equal(error.metadata?.httpStatus, 500);
  assert.doesNotMatch(error.message, /server details/u);
});

test("classifies malformed JSON", async () => {
  const client = new KonepsClient({ config: config(), fetch: async () => jsonResponse(await fixture("malformed.txt")) });
  await expectKonepsError(() => client.request(BID_NOTICE_SEARCH_OPERATION, params), "parse");
});

test("classifies documented-envelope mismatch separately", async () => {
  const client = new KonepsClient({ config: config(), fetch: async () => jsonResponse('{"unexpected":true}') });
  await expectKonepsError(() => client.request(BID_NOTICE_SEARCH_OPERATION, params), "structure");
});

test("aborts and classifies timeout", async () => {
  const timeoutFetch: KonepsFetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  const client = new KonepsClient({ config: config({ timeoutMs: 5 }), fetch: timeoutFetch });
  await expectKonepsError(() => client.request(BID_NOTICE_SEARCH_OPERATION, params), "timeout");
});

test("retries HTTP 500 once and then succeeds", async () => {
  let calls = 0;
  const client = new KonepsClient({
    config: config({ maxRetries: 2 }),
    fetch: async () => {
      calls += 1;
      return calls === 1 ? jsonResponse("temporary", 500) : jsonResponse(await fixture("normal.json"));
    },
    sleep: async () => undefined,
    random: () => 0,
  });
  const result = await client.request(BID_NOTICE_SEARCH_OPERATION, params);
  assert.equal(result.metadata.attemptCount, 2);
  assert.deepEqual(client.counters, { requestCount: 2, retryCount: 1 });
});

test("preserve mode avoids double encoding and all metadata redacts the key", async () => {
  let capturedUrl = "";
  const client = new KonepsClient({
    config: config({ serviceKey: ENCODED_FAKE_KEY, serviceKeyMode: "preserve" }),
    fetch: async (input) => {
      capturedUrl = String(input);
      return jsonResponse(await fixture("normal.json"));
    },
  });
  const result = await client.request(BID_NOTICE_SEARCH_OPERATION, params);
  assert.match(capturedUrl, /ServiceKey=abc%2Fdef%3D%3D/u);
  assert.doesNotMatch(capturedUrl, /%252F|%253D/u);
  assert.doesNotMatch(result.metadata.redactedUrl, /abc%2Fdef|abc\/def/u);
  assert.match(result.metadata.redactedUrl, /ServiceKey=\[REDACTED\]/u);
});

test("generic redaction removes query keys case-insensitively and direct secret occurrences", () => {
  const input = `https://example.test/path?pageNo=1&serviceKEY=${FAKE_KEY}&x=${FAKE_KEY}`;
  const redacted = redactSecrets(redactKonepsUrl(input), [FAKE_KEY]);
  assert.doesNotMatch(redacted, new RegExp(FAKE_KEY, "u"));
  assert.match(redacted, /serviceKEY=\[REDACTED\]/u);
});

test("network exception text cannot leak the service key into the public error", async () => {
  const client = new KonepsClient({
    config: config(),
    fetch: async () => { throw new Error(`transport failed for ServiceKey=${FAKE_KEY}`); },
  });
  const error = await expectKonepsError(() => client.request(BID_NOTICE_SEARCH_OPERATION, params), "network");
  assert.doesNotMatch(JSON.stringify(error), new RegExp(FAKE_KEY, "u"));
  assert.doesNotMatch(error.metadata?.redactedUrl ?? "", new RegExp(FAKE_KEY, "u"));
});

test("missing backend environment key is a configuration error", () => {
  assert.throws(
    () => loadKonepsConfig({}),
    (error: unknown) => error instanceof KonepsError && error.category === "configuration",
  );
});

test("reports the fixture envelope, paging and item array without discarding unknown fields", async () => {
  const parsed = JSON.parse(await fixture("normal.json")) as unknown;
  const report = inspectLiveShape(parsed);
  assert.equal(report.headerPath, "$.response.header");
  assert.equal(report.pagingPath, "$.response.body");
  assert.equal(report.itemPath, "$.response.body.items.item");
  assert.equal(report.itemKind, "array");
  assert.equal(report.itemCount, 1);
  assert.deepEqual(report.itemFields.bidNtceNo, ["string"]);
});

test("sanitization preserves nesting, arrays, null and unknown fields while replacing contact values", () => {
  const source = { response: { body: { items: { item: [{ unknown: 7, ofclTelNo: "02-123-4567", optional: null }] } } } };
  const sanitized = sanitizeLiveFixture(source, FAKE_KEY) as typeof source;
  assert.ok(Array.isArray(sanitized.response.body.items.item));
  assert.equal(sanitized.response.body.items.item[0]?.unknown, 7);
  assert.equal(sanitized.response.body.items.item[0]?.optional, null);
  assert.equal(sanitized.response.body.items.item[0]?.ofclTelNo, "000-0000-0000");
});

test("parses the sanitized live KONEPS items-array shape as regression evidence", async () => {
  const text = await liveFixture("bid-notice.json");
  const parsed = JSON.parse(text) as {
    response: {
      header: { resultCode: unknown; resultMsg: unknown };
      body: { items: Array<Record<string, unknown>>; pageNo: unknown; numOfRows: unknown; totalCount: unknown };
    };
  };
  const report = inspectLiveShape(parsed);
  assert.deepEqual(report.rootKeys, ["response"]);
  assert.equal(report.headerPath, "$.response.header");
  assert.equal(report.bodyPath, "$.response.body");
  assert.equal(report.itemsPath, "$.response.body.items");
  assert.equal(report.itemPath, "$.response.body.items");
  assert.equal(report.itemKind, "array");
  assert.equal(report.itemCount, 5);
  assert.equal(extractLiveItems(parsed).length, 5);
  assert.deepEqual(report.pagingTypes, { pageNo: "number", numOfRows: "number", totalCount: "number" });
  assert.equal(typeof parsed.response.body.items[0]?.bidNtceNo, "string");
  assert.equal(typeof parsed.response.body.items[0]?.bidNtceOrd, "string");
  assert.ok("rsrvtnPrceReMkngMthdNm" in (parsed.response.body.items[0] ?? {}));
  assert.doesNotMatch(text, /ServiceKey/iu);
  assert.equal(parsed.response.body.items[0]?.ntceInsttOfclNm, "TEST_CONTACT");
  assert.equal(parsed.response.body.items[0]?.ntceInsttOfclTelNo, "000-0000-0000");
  assert.equal(parsed.response.body.items[0]?.ntceInsttOfclEmailAdrs, "redacted@example.invalid");
});

test("live verification arguments enforce historical, page, row, range, and fixture safety", () => {
  const now = new Date("2026-08-13T09:00:00.000Z");
  assert.throws(() => parseVerificationArguments(["--from", "202001011000", "--to", "202001011010"], now), /--historical/u);
  assert.throws(() => parseVerificationArguments(["--page", "11"], now), /--page/u);
  assert.throws(() => parseVerificationArguments(["--rows", "11"], now), /--rows/u);
  assert.throws(() => parseVerificationArguments(["--fixture-name", "../private"], now), /--fixture-name/u);
  assert.throws(() => parseVerificationArguments(["--from", "202608130900", "--to", "202608131501"], now), /360 minutes/u);
  const args = parseVerificationArguments([
    "--historical", "--execute", "--from", "202001011000", "--to", "202001011010",
    "--page", "2", "--rows", "5", "--fixture-name", "bid-notice-2020",
  ], now);
  assert.deepEqual(args, {
    execute: true,
    historical: true,
    from: "202001011000",
    to: "202001011010",
    pageNo: 2,
    numOfRows: 5,
    fixtureName: "bid-notice-2020",
  });
});

test("pagination summary detects cross-page duplicates, total-count drift, and a short final page", () => {
  const baseShape = inspectLiveShape({ response: { header: { resultCode: "00", resultMsg: "OK" }, body: { items: [{ bidNtceNo: "A", bidNtceOrd: "000" }], pageNo: 1, numOfRows: 2, totalCount: 3 } } });
  const finalShape = { ...baseShape, itemCount: 1 };
  const summary = summarizePagination([
    { requestedPageNo: 1, returnedPageNo: 1, returnedNumOfRows: 2, totalCount: 3, identities: ["A|000", "B|000"], shape: { ...baseShape, itemCount: 2 } },
    { requestedPageNo: 2, returnedPageNo: 2, returnedNumOfRows: 2, totalCount: 4, identities: ["B|000"], shape: finalShape },
  ]);
  assert.deepEqual(summary.pageItemCounts, [2, 1]);
  assert.deepEqual(summary.totalCounts, [3, 4]);
  assert.deepEqual(summary.duplicateIdentities, ["B|000"]);
  assert.equal(summary.totalCountDrift, true);
  assert.equal(summary.finalPageObserved, true);
});

test("Phase 3-E verification arguments require an explicit supported identity", () => {
  assert.deepEqual(parsePhase3eArguments(["--kind", "item", "--bid-no", "20260814001", "--bid-ord", "000"]), {
    kind: "item", bidNtceNo: "20260814001", bidNtceOrd: "000", execute: false,
  });
  assert.deepEqual(parsePhase3eArguments(["--kind", "basis", "--bid-no", "20260814001", "--execute"]), {
    kind: "basis", bidNtceNo: "20260814001", bidNtceOrd: undefined, execute: true,
  });
  assert.throws(() => parsePhase3eArguments(["--kind", "item", "--bid-no", "20260814001"]), /--bid-ord/u);
  assert.throws(() => parsePhase3eArguments(["--kind", "basis", "--bid-no", "bad&id"]), /safe identifier/u);
  assert.throws(() => parsePhase3eArguments(["--kind", "other", "--bid-no", "20260814001"]), /--kind/u);
});

test("Phase 3-E endpoints accept only their documented identity query mode", () => {
  assert.doesNotThrow(() => BID_ITEM_OPERATION.validate?.({ pageNo: 1, numOfRows: 5, type: "json", inqryDiv: "2", bidNtceNo: "A", bidNtceOrd: "000" }));
  assert.doesNotThrow(() => BID_BASIS_AMOUNT_OPERATION.validate?.({ pageNo: 1, numOfRows: 5, type: "json", inqryDiv: "2", bidNtceNo: "A" }));
  assert.throws(() => BID_ITEM_OPERATION.validate?.({ pageNo: 1, numOfRows: 5, type: "json", inqryDiv: "1" as "2", bidNtceNo: "A", bidNtceOrd: "000" }), /inqryDiv=2/u);
  assert.throws(() => BID_BASIS_AMOUNT_OPERATION.validate?.({ pageNo: 1, numOfRows: 5, type: "json", inqryDiv: "2", bidNtceNo: "A B" }), /identifier/u);
});

test("detailed product classification endpoint accepts documented search conditions", () => {
  assert.doesNotThrow(() => DETAILED_PRODUCT_CLASSIFICATION_SEARCH_OPERATION.validate?.({
    pageNo: 1,
    numOfRows: 5,
    dtilPrdctClsfcNoBgnNo: "1013160101",
    dtilPrdctClsfcNoEndNo: "1013160101",
  }));
  assert.doesNotThrow(() => DETAILED_PRODUCT_CLASSIFICATION_SEARCH_OPERATION.validate?.({
    pageNo: 1,
    numOfRows: 5,
    dtilPrdctClsfcNoNm: "애완동물사육장",
  }));
  assert.throws(() => DETAILED_PRODUCT_CLASSIFICATION_SEARCH_OPERATION.validate?.({
    pageNo: 1,
    numOfRows: 5,
    dtilPrdctClsfcNoBgnNo: "10131601",
  }), /10-digit/u);
  assert.throws(() => DETAILED_PRODUCT_CLASSIFICATION_SEARCH_OPERATION.validate?.({
    pageNo: 1,
    numOfRows: 5,
    dtilPrdctClsfcNoBgnNo: "1013160199",
    dtilPrdctClsfcNoEndNo: "1013160100",
  }), /must not exceed/u);
});
