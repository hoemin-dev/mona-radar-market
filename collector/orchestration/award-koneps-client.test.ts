import assert from "node:assert/strict";
import test from "node:test";
import { AwardKonepsClient } from "./award-koneps-client.js";
import { AWARD_SEARCH_OPERATION } from "../koneps/endpoints.js";
import type { KonepsFetch } from "../koneps/types.js";

test("award client retries the same request after an exhausted timeout", async () => {
  let calls = 0;
  const fetch: KonepsFetch = async (_input, init) => {
    calls += 1;
    if (calls === 1) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    return new Response(JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "OK" }, body: { items: [], pageNo: 1, numOfRows: 1, totalCount: 0 } } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new AwardKonepsClient({
    config: { serviceKey: "test-key", serviceKeyMode: "encode", timeoutMs: 1, maxRetries: 0, baseBackoffMs: 1 },
    fetch,
    sleep: async () => undefined,
    awardTimeoutRetryDelayMs: 0,
  });
  const response = await client.request(AWARD_SEARCH_OPERATION, { pageNo: 1, numOfRows: 1, type: "json", inqryDiv: "2", inqryBgnDt: "202305010000", inqryEndDt: "202305312359", dtilPrdctClsfcNo: "4015155301" });
  assert.equal(response.envelope.totalCount, 0);
  assert.equal(calls, 2);
});

test("award client does not retry non-timeout failures", async () => {
  let calls = 0;
  const client = new AwardKonepsClient({
    config: { serviceKey: "test-key", serviceKeyMode: "encode", timeoutMs: 10, maxRetries: 0, baseBackoffMs: 1 },
    fetch: async () => { calls += 1; return new Response("failure", { status: 400 }); },
    sleep: async () => undefined,
    awardTimeoutRetryDelayMs: 0,
  });
  await assert.rejects(client.request(AWARD_SEARCH_OPERATION, { pageNo: 1, numOfRows: 1, type: "json", inqryDiv: "2", inqryBgnDt: "202305010000", inqryEndDt: "202305312359", dtilPrdctClsfcNo: "4015155301" }));
  assert.equal(calls, 1);
});

test("award client stops after the bounded collector-level timeout retries", async () => {
  let calls = 0;
  const client = new AwardKonepsClient({
    config: { serviceKey: "test-key", serviceKeyMode: "encode", timeoutMs: 1, maxRetries: 0, baseBackoffMs: 1 },
    fetch: async (_input, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    },
    sleep: async () => undefined,
    awardTimeoutRetryDelayMs: 0,
    awardTimeoutRetries: 2,
  });
  await assert.rejects(
    client.request(AWARD_SEARCH_OPERATION, { pageNo: 1, numOfRows: 1, type: "json", inqryDiv: "2", inqryBgnDt: "202305010000", inqryEndDt: "202305312359", dtilPrdctClsfcNo: "4015155301" }),
    /KONEPS request timed out/u,
  );
  assert.equal(calls, 3);
});
