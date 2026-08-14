export type JsonKind = "array" | "boolean" | "null" | "number" | "object" | "string";

export interface LocatedValue {
  readonly path: string;
  readonly value: unknown;
}

export interface LiveShapeReport {
  readonly rootKind: JsonKind;
  readonly rootKeys: readonly string[];
  readonly responsePath?: string;
  readonly headerPath?: string;
  readonly bodyPath?: string;
  readonly itemsPath?: string;
  readonly itemPath?: string;
  readonly itemKind: JsonKind | "missing";
  readonly itemCount: number;
  readonly pagingPath?: string;
  readonly pagingTypes: Readonly<Record<string, JsonKind | "missing">>;
  readonly headerTypes: Readonly<Record<string, JsonKind | "missing">>;
  readonly itemFields: Readonly<Record<string, readonly JsonKind[]>>;
  readonly itemValueStates: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function jsonKind(value: unknown): JsonKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as Exclude<JsonKind, "array" | "null">;
}

export function extractLiveItems(root: unknown): readonly Record<string, unknown>[] {
  const rootRecord = record(root);
  const response = record(rootRecord?.response);
  const body = record(response?.body);
  const items = body?.items;
  if (Array.isArray(items)) return items.map(record).filter((value): value is Record<string, unknown> => value !== undefined);
  const itemsRecord = record(items);
  const nested = itemsRecord?.item;
  if (Array.isArray(nested)) return nested.map(record).filter((value): value is Record<string, unknown> => value !== undefined);
  const single = record(nested);
  return single ? [single] : [];
}

function walk(root: unknown): LocatedValue[] {
  const found: LocatedValue[] = [{ path: "$", value: root }];
  const queue: LocatedValue[] = [...found];
  const visited = new Set<object>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.value === null || typeof current.value !== "object" || visited.has(current.value)) continue;
    visited.add(current.value);
    const entries = Array.isArray(current.value)
      ? current.value.map((value, index) => [String(index), value] as const)
      : Object.entries(current.value);
    for (const [key, value] of entries) {
      const child = { path: `${current.path}.${key}`, value };
      found.push(child);
      if (value !== null && typeof value === "object") queue.push(child);
    }
  }
  return found;
}

function locate(nodes: readonly LocatedValue[], predicate: (value: Record<string, unknown>) => boolean): LocatedValue | undefined {
  return nodes.find((node) => {
    const value = record(node.value);
    return value !== undefined && predicate(value);
  });
}

function state(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (value === "") return "empty";
  if (value === " ") return "single-space";
  if (value === 0) return "zero";
  return "value";
}

export function inspectLiveShape(root: unknown): LiveShapeReport {
  const nodes = walk(root);
  const response = nodes.find((node) => node.path.endsWith(".response") && record(node.value));
  const header = locate(nodes, (value) => "resultCode" in value && "resultMsg" in value);
  const paging = locate(nodes, (value) => "pageNo" in value || "numOfRows" in value || "totalCount" in value);
  const body = nodes.find((node) => node.path.endsWith(".body") && record(node.value));
  const items = nodes.find((node) => node.path.endsWith(".items"));
  const nestedItem = nodes.find((node) => node.path.endsWith(".item"));
  // KONEPS JSON may flatten the XML `items/item` wrapper to an `items` array.
  // Prefer an explicit `item` member when present, otherwise inspect the array
  // (or null empty marker) at `items` itself.
  const item = nestedItem ?? (items && (Array.isArray(items.value) || items.value === null) ? items : undefined);
  const itemValues = item === undefined || item.value === null
    ? []
    : Array.isArray(item.value) ? item.value : [item.value];
  const itemRecords = itemValues.map(record).filter((value): value is Record<string, unknown> => value !== undefined);
  const fields = [...new Set(itemRecords.flatMap((value) => Object.keys(value)))].sort();
  const itemFields: Record<string, JsonKind[]> = {};
  const itemValueStates: Record<string, Record<string, number>> = {};
  for (const field of fields) {
    itemFields[field] = [...new Set(itemRecords.filter((row) => field in row).map((row) => jsonKind(row[field])))].sort();
    const counts: Record<string, number> = {};
    for (const row of itemRecords) {
      const name = state(row[field]);
      counts[name] = (counts[name] ?? 0) + 1;
    }
    itemValueStates[field] = counts;
  }
  const rootRecord = record(root);
  const headerRecord = record(header?.value);
  const pagingRecord = record(paging?.value);
  return {
    rootKind: jsonKind(root),
    rootKeys: Object.keys(rootRecord ?? {}).sort(),
    responsePath: response?.path,
    headerPath: header?.path,
    bodyPath: body?.path,
    itemsPath: items?.path,
    itemPath: item?.path,
    itemKind: item ? jsonKind(item.value) : "missing",
    itemCount: itemRecords.length,
    pagingPath: paging?.path,
    pagingTypes: Object.fromEntries(["pageNo", "numOfRows", "totalCount"].map((key) => [key, key in (pagingRecord ?? {}) ? jsonKind(pagingRecord?.[key]) : "missing"])),
    headerTypes: Object.fromEntries(["resultCode", "resultMsg"].map((key) => [key, key in (headerRecord ?? {}) ? jsonKind(headerRecord?.[key]) : "missing"])),
    itemFields,
    itemValueStates,
  };
}

const SENSITIVE_FIELD = /(addr|adrs|email|eml|fax|ofcl|officer|phone|tel|담당|전화|주소|메일)/iu;

export function sanitizeLiveFixture(value: unknown, serviceKey: string): unknown {
  const sanitize = (current: unknown, key = ""): unknown => {
    if (Array.isArray(current)) return current.map((entry) => sanitize(entry, key));
    const currentRecord = record(current);
    if (currentRecord) return Object.fromEntries(Object.entries(currentRecord).map(([name, entry]) => [name, sanitize(entry, name)]));
    if (typeof current !== "string" || current === "") return current;
    if (serviceKey && current.includes(serviceKey)) return current.replaceAll(serviceKey, "[REDACTED]");
    if (/email|eml/iu.test(key)) return "redacted@example.invalid";
    if (/phone|tel|fax/iu.test(key)) return "000-0000-0000";
    if (/addr|adrs|주소/iu.test(key)) return "TEST_ADDRESS";
    if (SENSITIVE_FIELD.test(key)) return "TEST_CONTACT";
    return current;
  };
  return sanitize(value);
}
