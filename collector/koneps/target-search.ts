import { KonepsClient } from "./client.js";
import { loadKonepsConfig } from "./config.js";
import { DETAILED_PRODUCT_CLASSIFICATION_SEARCH_OPERATION } from "./endpoints.js";
import type { DetailedProductClassificationSearchParams } from "./types.js";

export interface CollectorTargetCandidate {
  readonly dtilPrdctClsfcNo: string;
  readonly dtilPrdctClsfcNoNm: string;
  readonly useYn: string;
}

type SearchKind = "name" | "exact" | "range";

export function planCollectorTargetSearch(query: string): { kind: SearchKind; params: DetailedProductClassificationSearchParams } {
  const value = query.trim();
  if (!value) throw new Error("세부품명 또는 8/10자리 번호를 입력하세요.");
  if (/^\d{10}$/u.test(value)) return { kind: "exact", params: { pageNo: 1, numOfRows: 10, dtilPrdctClsfcNoBgnNo: value, dtilPrdctClsfcNoEndNo: value } };
  if (/^\d{8}$/u.test(value)) return { kind: "range", params: { pageNo: 1, numOfRows: 100, dtilPrdctClsfcNoBgnNo: `${value}00`, dtilPrdctClsfcNoEndNo: `${value}99` } };
  if (/^\d+$/u.test(value)) throw new Error("번호 검색은 8자리 또는 10자리여야 합니다.");
  return { kind: "name", params: { pageNo: 1, numOfRows: 30, dtilPrdctClsfcNoNm: value } };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export async function searchCollectorTargets(query: string): Promise<{ kind: SearchKind; totalCount: number; candidates: CollectorTargetCandidate[] }> {
  const request = planCollectorTargetSearch(query);
  const response = await new KonepsClient({ config: loadKonepsConfig() }).request(
    DETAILED_PRODUCT_CLASSIFICATION_SEARCH_OPERATION,
    request.params,
  );
  const root = record(response.parsedJson);
  const body = record(record(root?.response)?.body);
  const itemsContainer = record(body?.items);
  const raw = itemsContainer?.item ?? body?.items;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const candidates = items.flatMap((item): CollectorTargetCandidate[] => {
    const value = record(item);
    const number = String(value?.dtilPrdctClsfcNo ?? "");
    if (!/^\d{10}$/u.test(number)) return [];
    return [{
      dtilPrdctClsfcNo: number,
      dtilPrdctClsfcNoNm: String(value?.dtilPrdctClsfcNoNm ?? ""),
      useYn: String(value?.useYn ?? ""),
    }];
  });
  return { kind: request.kind, totalCount: response.envelope.totalCount ?? candidates.length, candidates };
}
