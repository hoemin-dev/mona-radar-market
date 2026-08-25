export type FixedTargetStatus = "historical" | "current";

export interface FixedTarget {
  readonly dtilPrdctClsfcNo: string;
  readonly dtilPrdctClsfcNoNm: string;
  readonly status: FixedTargetStatus;
}

export const FIXED_TARGETS: readonly FixedTarget[] = [
  { dtilPrdctClsfcNo: "4015155300", dtilPrdctClsfcNoNm: "전진공동펌프", status: "historical" },
  { dtilPrdctClsfcNo: "4015155301", dtilPrdctClsfcNoNm: "전진공동펌프", status: "current" },
];

export const FIXED_TARGET_CODES = new Set(FIXED_TARGETS.map(target => target.dtilPrdctClsfcNo));

export function matchingFixedTargets(query: string): readonly FixedTarget[] {
  const value = query.trim();
  return FIXED_TARGETS.filter(target =>
    target.dtilPrdctClsfcNo.includes(value) || target.dtilPrdctClsfcNoNm.includes(value),
  );
}
