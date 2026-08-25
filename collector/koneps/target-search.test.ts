import assert from "node:assert/strict";
import test from "node:test";
import { mergeCollectorTargetCandidates, planCollectorTargetSearch } from "./target-search.js";

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

test("merges matching fixed targets for exact, parent, and name searches", () => {
  assert.deepEqual(mergeCollectorTargetCandidates("4015155300", []).map(target => target.dtilPrdctClsfcNo), ["4015155300"]);
  assert.deepEqual(mergeCollectorTargetCandidates("4015155301", []).map(target => target.dtilPrdctClsfcNo), ["4015155301"]);
  for (const query of ["40151553", "전진공동펌프"]) {
    assert.deepEqual(mergeCollectorTargetCandidates(query, []).map(target => target.dtilPrdctClsfcNo), ["4015155300", "4015155301"]);
  }
});

test("deduplicates API and fixed targets while retaining registry status", () => {
  const candidates = mergeCollectorTargetCandidates("전진공동펌프", [
    { dtilPrdctClsfcNo: "4015155301", dtilPrdctClsfcNoNm: "전진공동펌프", useYn: "Y" },
  ]);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.find(target => target.dtilPrdctClsfcNo === "4015155301"), {
    dtilPrdctClsfcNo: "4015155301", dtilPrdctClsfcNoNm: "전진공동펌프", useYn: "Y", status: "current",
  });
  assert.equal(candidates[0]?.status, "historical");
  assert.equal(candidates[0]?.useYn, "과거 코드");
});
