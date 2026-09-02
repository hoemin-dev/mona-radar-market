import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectLink } from './contract-bid-evidence-preview.mjs';

const header = { ntceNo: '2013010460500', dminsttList: '[1^A001^기관^^]',
  untyCntrctNo: 'U1', dcsnCntrctNo: 'D1', cntrctDtlInfoUrl: 'https://example.test/?ctrtChgOrd=00' };
const detail = { untyCntrctNo: 'U1', dcsnCntrctNo: 'D1', prdctClsfcNo: '40151553', prdctQty: '2' };
const bid = { bidNtceNo: '20130104605', bidNtceOrd: '000', prdctClsfcNo: '40151553',
  dminsttCd: 'A001', qty: '2.00', dtilPrdctClsfcNo: '4015155300', bidItemId: 1, rawItemId: 2 };

for (const code of ['4015155300', '4015155301']) {
  test(`explicit unique official link ${code}`, () => {
    assert.equal(inspectLink(header, detail, [{ ...bid, dtilPrdctClsfcNo: code }]).code, code);
  });
}
for (const [name, bids, reason] of [
  ['absent', [], 'NO_MATCH'],
  ['duplicate', [bid, { ...bid, bidItemId: 3 }], 'MULTIPLE_CANDIDATES'],
  ['institution mismatch', [{ ...bid, dminsttCd: 'OTHER' }], 'NO_MATCH'],
  ['quantity mismatch', [{ ...bid, qty: '3' }], 'NO_MATCH'],
  ['invalid code', [{ ...bid, dtilPrdctClsfcNo: '40151553' }], 'INVALID_OR_NON_TARGET_CODE'],
  ['non-target', [{ ...bid, dtilPrdctClsfcNo: '4015156600' }], 'INVALID_OR_NON_TARGET_CODE'],
]) test(name, () => assert.equal(inspectLink(header, detail, bids).reason, reason));

test('one stored order cannot establish missing contract notice order', () => {
  assert.equal(inspectLink({ ...header, ntceNo: '20130104605' }, detail, [bid]).reason, 'AMBIGUOUS_NOTICE_ORDER');
});
test('explicit order 01 selects 001, not original 000', () => {
  const result = inspectLink({ ...header, ntceNo: '2013010460501' }, detail,
    [bid, { ...bid, bidNtceOrd: '001', bidItemId: 3 }]);
  assert.equal(result.candidates[0].bidItemId, 3);
  assert.equal(result.code, '4015155300');
});
test('catalog conflict blocks link', () => {
  assert.equal(inspectLink(header, detail, [bid], '4015155301').reason, 'CATALOG_CONFLICT');
});
test('changed contract requires relationship evidence', () => {
  assert.equal(inspectLink({ ...header, cntrctDtlInfoUrl: 'https://example.test/?ctrtChgOrd=01' },
    detail, [bid]).reason, 'UNVERIFIED_CONTRACT_CHANGE_RELATION');
});
test('mixed booster and progressive cavity items are evaluated separately', () => {
  const bids = [bid, { ...bid, prdctClsfcNo: '40151566', dtilPrdctClsfcNo: '4015156600' }];
  assert.equal(inspectLink({ ...header, cntrctNm: '부스터펌프 + 전진공동펌프' }, detail, bids).code, '4015155300');
  assert.equal(inspectLink(header, { ...detail, prdctClsfcNo: '40151566' }, bids).code, undefined);
});
test('conflicting explicit order fields are rejected', () => {
  assert.equal(inspectLink({ ...header, ntceOrd: '001' }, detail, [bid]).reason, 'CONFLICTING_NOTICE_ORDER');
});
