import assert from "node:assert/strict";
import test from "node:test";
import { nextAwardEmptyPageCount } from "./award-collector.js";

test("award pagination fails after two empty pages while totalCount remains", () => {
  const first = nextAwardEmptyPageCount(0, 0, 100, 150);
  assert.equal(first, 1);
  assert.throws(() => nextAwardEmptyPageCount(first, 0, 100, 150), /AWARD_PAGINATION_STALLED/u);
});

test("award pagination resets the empty-page guard when progress resumes", () => {
  assert.equal(nextAwardEmptyPageCount(1, 25, 125, 150), 0);
});
