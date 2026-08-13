import type { KonepsEnvelope } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function findRecord(root: unknown, predicate: (record: Record<string, unknown>) => boolean): Record<string, unknown> | undefined {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  const visited = new Set<object>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    const record = asRecord(current.value);
    if (!record || visited.has(record)) continue;
    visited.add(record);
    if (predicate(record)) return record;
    if (current.depth >= 5) continue;
    for (const child of Object.values(record)) {
      if (child !== null && typeof child === "object") queue.push({ value: child, depth: current.depth + 1 });
    }
  }
  return undefined;
}

export function extractKonepsEnvelope(parsedJson: unknown): KonepsEnvelope | undefined {
  const header = findRecord(parsedJson, (record) => "resultCode" in record && "resultMsg" in record);
  if (!header) return undefined;
  const resultCode = stringValue(header.resultCode);
  const resultMsg = stringValue(header.resultMsg);
  if (resultCode === undefined || resultMsg === undefined) return undefined;
  const paging = findRecord(parsedJson, (record) =>
    "pageNo" in record || "numOfRows" in record || "totalCount" in record,
  );
  return {
    resultCode,
    resultMsg,
    pageNo: numberValue(paging?.pageNo),
    numOfRows: numberValue(paging?.numOfRows),
    totalCount: numberValue(paging?.totalCount),
  };
}
