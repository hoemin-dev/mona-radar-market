export type MonaRadarProductCategory = "product" | "part";

export interface CatalogItemClassification {
  readonly prdctIdntNo: string;
  readonly detailedProductClassNo: string;
  readonly category: MonaRadarProductCategory;
  readonly cmpntYn: "Y" | "N";
}

/** Classifies one exact catalog item. Class-level aggregation is intentionally forbidden. */
export function classifyCatalogItem(item: Readonly<Record<string, unknown>>): CatalogItemClassification | null {
  if (typeof item.prdctIdntNo !== "string" || !/^\d{8}$/u.test(item.prdctIdntNo)) return null;
  if (typeof item.dtilPrdctClsfcNo !== "string" || !/^\d{10}$/u.test(item.dtilPrdctClsfcNo)) return null;
  if (item.cmpntYn !== "Y" && item.cmpntYn !== "N") return null;
  return { prdctIdntNo: item.prdctIdntNo, detailedProductClassNo: item.dtilPrdctClsfcNo,
    category: item.cmpntYn === "Y" ? "part" : "product", cmpntYn: item.cmpntYn };
}
