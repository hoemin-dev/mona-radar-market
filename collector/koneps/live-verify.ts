import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { KonepsClient } from "./client.js";
import { loadKonepsConfig, type ServiceKeyMode } from "./config.js";
import { BID_NOTICE_SEARCH_OPERATION, KONEPS_SERVICE_ENDPOINTS } from "./endpoints.js";
import { KonepsError } from "./errors.js";
import { extractLiveItems, inspectLiveShape, sanitizeLiveFixture } from "./live-shape.js";
import type { BidNoticeSearchParams } from "./types.js";
import { parseVerificationArguments } from "./verification.js";

async function main(): Promise<void> {
  const now = new Date();
  const args = parseVerificationArguments(process.argv.slice(2), now);
  const { from, to, pageNo, numOfRows } = args;

  const mode = (process.env.KONEPS_SERVICE_KEY_MODE ?? "preserve") as ServiceKeyMode;
  if (mode !== "preserve" && mode !== "encode") throw new Error("KONEPS_SERVICE_KEY_MODE must be preserve or encode");
  const params: BidNoticeSearchParams = { pageNo, numOfRows, type: "json", inqryDiv: "1", inqryBgnDt: from, inqryEndDt: to };
  const previewQuery = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  previewQuery.set("ServiceKey", "[REDACTED]");
  const redactedRequest = `${KONEPS_SERVICE_ENDPOINTS.BidPublicInfoService}/${BID_NOTICE_SEARCH_OPERATION.path}?${previewQuery.toString()}`.replace("%5BREDACTED%5D", "[REDACTED]");
  console.log(JSON.stringify({
    dryRun: true,
    service: BID_NOTICE_SEARCH_OPERATION.service,
    operation: BID_NOTICE_SEARCH_OPERATION.path,
    pageNo,
    numOfRows,
    inqryBgnDt: from,
    inqryEndDt: to,
    keyMode: mode,
    redactedRequest,
  }, null, 2));

  if (!args.execute) {
    console.log("Dry run only. Add --execute to make exactly one request attempt.");
    return;
  }

  const config = { ...loadKonepsConfig(), maxRetries: 0 };
  const client = new KonepsClient({ config });
  const response = await client.request(BID_NOTICE_SEARCH_OPERATION, params);
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const privateDir = resolve("runtime", "koneps-live", stamp);
  const fixtureDir = resolve("collector", "koneps", "fixtures", "live-sanitized");
  await mkdir(privateDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(resolve(privateDir, "response.json"), response.bodyBytes);
  const shape = inspectLiveShape(response.parsedJson);
  await writeFile(resolve(privateDir, "shape-report.json"), `${JSON.stringify(shape, null, 2)}\n`, "utf8");
  const identities = extractLiveItems(response.parsedJson).map((item) => `${String(item.bidNtceNo ?? "")}|${String(item.bidNtceOrd ?? "")}`);
  await writeFile(resolve(privateDir, "verification-report.json"), `${JSON.stringify({
    request: { service: BID_NOTICE_SEARCH_OPERATION.service, operation: BID_NOTICE_SEARCH_OPERATION.path, pageNo, numOfRows, inqryBgnDt: from, inqryEndDt: to, keyMode: config.serviceKeyMode },
    response: { httpStatus: response.status, contentType: response.headers["content-type"] ?? "missing", responseBytes: response.bodyBytes.byteLength, durationMs: response.durationMs, resultCode: response.envelope.resultCode, resultMsg: response.envelope.resultMsg, pageNo: response.envelope.pageNo, numOfRows: response.envelope.numOfRows, totalCount: response.envelope.totalCount, actualItemCount: shape.itemCount },
    identities,
    shape,
  }, null, 2)}\n`, "utf8");
  const sanitized = sanitizeLiveFixture(response.parsedJson, config.serviceKey);
  const fixturePath = resolve(fixtureDir, `${args.fixtureName}.json`);
  await writeFile(fixturePath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  const contentType = response.headers["content-type"] ?? "missing";
  const encoding = /charset=([^;]+)/iu.exec(contentType)?.[1] ?? "utf-8 (client decoder)";
  console.log(JSON.stringify({
    liveApiCalls: client.counters.requestCount,
    httpStatus: response.status,
    contentType,
    encoding,
    responseBytes: response.bodyBytes.byteLength,
    durationMs: response.durationMs,
    resultCode: response.envelope.resultCode,
    resultMsg: response.envelope.resultMsg,
    returnedPageNo: response.envelope.pageNo,
    returnedNumOfRows: response.envelope.numOfRows,
    totalCount: response.envelope.totalCount,
    actualItemCount: shape.itemCount,
    shape,
    exactPrivateEvidence: privateDir,
    sanitizedFixture: fixturePath,
  }, null, 2));
}

main().catch((error: unknown) => {
  if (error instanceof KonepsError) {
    console.error(JSON.stringify({ category: error.category, message: error.message, metadata: error.metadata }, null, 2));
  } else {
    console.error(error instanceof Error ? error.message : "Unknown live verification error");
  }
  process.exitCode = 1;
});
