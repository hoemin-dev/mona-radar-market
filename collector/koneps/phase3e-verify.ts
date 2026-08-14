import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { KonepsClient } from "./client.js";
import { loadKonepsConfig } from "./config.js";
import { BID_BASIS_AMOUNT_OPERATION, BID_ITEM_OPERATION, KONEPS_SERVICE_ENDPOINTS } from "./endpoints.js";
import { KonepsError } from "./errors.js";
import { inspectLiveShape, sanitizeLiveFixture } from "./live-shape.js";
import type { BidBasisAmountIdentityParams, BidItemIdentityParams } from "./types.js";

type VerificationKind = "basis" | "item";

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  if (index >= 0 && (!value || value.startsWith("--"))) throw new Error(`${name} requires a value`);
  return value;
}

export function parsePhase3eArguments(argv: readonly string[]): { kind: VerificationKind; bidNtceNo: string; bidNtceOrd?: string; execute: boolean } {
  const kind = option(argv, "--kind");
  if (kind !== "item" && kind !== "basis") throw new Error("--kind must be item or basis");
  const bidNtceNo = option(argv, "--bid-no");
  if (!bidNtceNo || /[&#?\s]/u.test(bidNtceNo)) throw new Error("--bid-no is required and must be a safe identifier");
  const bidNtceOrd = option(argv, "--bid-ord");
  if (kind === "item" && (!bidNtceOrd || /[&#?\s]/u.test(bidNtceOrd))) throw new Error("--bid-ord is required for item verification");
  return { kind, bidNtceNo, bidNtceOrd, execute: argv.includes("--execute") };
}

async function main(): Promise<void> {
  const args = parsePhase3eArguments(process.argv.slice(2));
  const operation = args.kind === "item" ? BID_ITEM_OPERATION : BID_BASIS_AMOUNT_OPERATION;
  const baseParams = { pageNo: 1, numOfRows: 5, type: "json" as const, inqryDiv: "2" as const, bidNtceNo: args.bidNtceNo };
  const params: BidItemIdentityParams | BidBasisAmountIdentityParams = args.kind === "item"
    ? { ...baseParams, bidNtceOrd: args.bidNtceOrd! }
    : baseParams;
  const preview = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  preview.set("ServiceKey", "[REDACTED]");
  console.log(JSON.stringify({ dryRun: true, service: operation.service, operation: operation.path, pageNo: 1, numOfRows: 5,
    keyMode: process.env.KONEPS_SERVICE_KEY_MODE ?? "preserve",
    redactedRequest: `${KONEPS_SERVICE_ENDPOINTS.BidPublicInfoService}/${operation.path}?${preview.toString()}`.replace("%5BREDACTED%5D", "[REDACTED]"),
  }, null, 2));
  if (!args.execute) return;

  const config = { ...loadKonepsConfig(), maxRetries: 0 };
  const client = new KonepsClient({ config });
  const response = args.kind === "item"
    ? await client.request(BID_ITEM_OPERATION, params as BidItemIdentityParams)
    : await client.request(BID_BASIS_AMOUNT_OPERATION, params as BidBasisAmountIdentityParams);
  const shape = inspectLiveShape(response.parsedJson);
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const privateDir = resolve("runtime", "koneps-live", stamp);
  const fixturePath = resolve("collector", "koneps", "fixtures", "live-sanitized", args.kind === "item" ? "bid-item.json" : "bid-basis-amount.json");
  await mkdir(privateDir, { recursive: true });
  await writeFile(resolve(privateDir, "response.json"), response.bodyBytes);
  await writeFile(resolve(privateDir, "verification-report.json"), `${JSON.stringify({
    request: { service: operation.service, operation: operation.path, pageNo: 1, numOfRows: 5, keyMode: config.serviceKeyMode },
    response: { httpStatus: response.status, contentType: response.headers["content-type"], responseBytes: response.bodyBytes.byteLength,
      durationMs: response.durationMs, resultCode: response.envelope.resultCode, resultMsg: response.envelope.resultMsg,
      pageNo: response.envelope.pageNo, numOfRows: response.envelope.numOfRows, totalCount: response.envelope.totalCount,
      actualItemCount: shape.itemCount }, shape,
  }, null, 2)}\n`, "utf8");
  await writeFile(fixturePath, `${JSON.stringify(sanitizeLiveFixture(response.parsedJson, config.serviceKey), null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ liveApiCalls: client.counters.requestCount, httpStatus: response.status, resultCode: response.envelope.resultCode,
    totalCount: response.envelope.totalCount, actualItemCount: shape.itemCount, itemKind: shape.itemKind,
    fieldCount: Object.keys(shape.itemFields).length, exactPrivateEvidence: privateDir, sanitizedFixture: fixturePath,
  }, null, 2));
}

if (process.argv[1]?.endsWith("phase3e-verify.js")) {
  main().catch((error: unknown) => {
    if (error instanceof KonepsError) console.error(JSON.stringify({ category: error.category, message: error.message, metadata: error.metadata }, null, 2));
    else console.error(error instanceof Error ? error.message : "Unknown Phase 3-E verification error");
    process.exitCode = 1;
  });
}
