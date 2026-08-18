import assert from "node:assert/strict";
import test from "node:test";
import { planCollectorTargetSearch } from "./target-search.js";

test("plans a Korean detailed-name Like search", () => {
  assert.deepEqual(planCollectorTargetSearch(" 전진공동펌프 "), {
    kind: "name",
    params: { pageNo: 1, numOfRows: 30, dtilPrdctClsfcNoNm: "전진공동펌프" },
  });
});

test("plans an exact 10-digit search", () => {
  assert.deepEqual(planCollectorTargetSearch("4015155301"), {
    kind: "exact",
    params: { pageNo: 1, numOfRows: 10, dtilPrdctClsfcNoBgnNo: "4015155301", dtilPrdctClsfcNoEndNo: "4015155301" },
  });
});

test("expands an 8-digit parent to its 10-digit range", () => {
  assert.deepEqual(planCollectorTargetSearch("40151553"), {
    kind: "range",
    params: { pageNo: 1, numOfRows: 100, dtilPrdctClsfcNoBgnNo: "4015155300", dtilPrdctClsfcNoEndNo: "4015155399" },
  });
});

test("rejects other numeric lengths", () => {
  assert.throws(() => planCollectorTargetSearch("401515530"), /8자리 또는 10자리/u);
});
