import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { KonepsClient } from "./client.js";
import { loadKonepsConfig, type KonepsClientConfig } from "./config.js";
import { BID_NOTICE_SEARCH_OPERATION } from "./endpoints.js";
import { KonepsError } from "./errors.js";
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
