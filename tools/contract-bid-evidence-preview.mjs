import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { FIXED_TARGET_CODES } from '../collector/koneps/target-registry.ts';

const text = value => typeof value === 'string' ? value.trim() : '';
// Exact decimal comparison, without floating point rounding or locale guessing.
const quantity = value => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text(value));
  return match ? `${BigInt(match[1])}.${(match[2] ?? '').replace(/0+$/, '')}` : null;
};

export function inspectLink(header, detail, bids, catalogCode = null) {
  const notice = /^(\d{11})(\d{2,3})?$/.exec(text(header.ntceNo));
  if (!notice) return { reason: 'MISSING_OR_INVALID_NOTICE', candidates: [] };
  const explicitOrders = [notice[2], header.ntceOrd, header.bidNtceOrd]
    .filter(value => value !== undefined && text(value) !== '');
  if (explicitOrders.some(value => !/^\d{1,3}$/.test(text(value))))
    return { reason: 'INVALID_NOTICE_ORDER', candidates: [] };
  const orders = new Set(explicitOrders.map(value => text(value).padStart(3, '0')));
  if (orders.size > 1) return { reason: 'CONFLICTING_NOTICE_ORDER', candidates: [] };
  const order = [...orders][0];
  const institutions = [...text(header.dminsttList).matchAll(/\[([^\]]+)\]/g)]
    .map(match => match[1].split('^')[1]);
  if (institutions.length !== 1 || !institutions[0])
    return { reason: 'AMBIGUOUS_DEMAND_INSTITUTION', candidates: [] };
  if (!/^\d{8}$/.test(text(detail.prdctClsfcNo)) || quantity(detail.prdctQty) === null)
    return { reason: 'INVALID_ITEM_FIELDS', candidates: [] };
  const candidates = bids.filter(bid => text(bid.bidNtceNo) === notice[1]
    && (!order || text(bid.bidNtceOrd) === order)
    && text(bid.prdctClsfcNo) === text(detail.prdctClsfcNo)
    && text(bid.dminsttCd) === institutions[0]
    && quantity(bid.qty) !== null && quantity(bid.qty) === quantity(detail.prdctQty));
  const base = { candidates: candidates.map(bid => ({ bidItemId: bid.bidItemId,
    rawItemId: bid.rawItemId, order: bid.bidNtceOrd, code: bid.dtilPrdctClsfcNo })) };
  if (!candidates.length) return { ...base, reason: 'NO_MATCH' };
  // A single stored order is NOT evidence that the contract used that order.
  if (!order) return { ...base, reason: 'AMBIGUOUS_NOTICE_ORDER' };
  if (candidates.length !== 1) return { ...base, reason: 'MULTIPLE_CANDIDATES' };
  const code = text(candidates[0].dtilPrdctClsfcNo);
  if (!/^\d{10}$/.test(code) || !FIXED_TARGET_CODES.has(code))
    return { ...base, reason: 'INVALID_OR_NON_TARGET_CODE' };
  if (catalogCode && catalogCode !== code) return { ...base, reason: 'CATALOG_CONFLICT' };
  const directCode = text(detail.dtilPrdctClsfcNo);
  if (/^\d{10}$/.test(directCode) && directCode !== code)
    return { ...base, reason: 'CONTRACT_RAW_CONFLICT' };
  let changeOrder;
  try { changeOrder = new URL(header.cntrctDtlInfoUrl).searchParams.get('ctrtChgOrd'); } catch { /* no proof */ }
  if (changeOrder !== '00') return { ...base, reason: 'UNVERIFIED_CONTRACT_CHANGE_RELATION' };
  if (!detail.untyCntrctNo || detail.untyCntrctNo !== header.untyCntrctNo
    || detail.dcsnCntrctNo !== header.dcsnCntrctNo)
    return { ...base, reason: 'CONTRACT_IDENTITY_MISMATCH' };
  return { ...base, reason: 'EXPLICIT_ITEM_LINK', code };
}

export function preview(db) {
  const items = db.prepare(`SELECT i.contract_item_id id,i.contract_header_id headerId,
    i.source_raw_item_id detailRawId,h.source_raw_item_id headerRawId,
    i.raw_json detail,h.raw_json header,c.lookup_status catalogStatus,
    c.detailed_product_class_no catalogCode
    FROM contract_item i JOIN contract_header h USING(contract_header_id)
    LEFT JOIN contract_catalog_cache c ON c.product_identification_no=i.product_identification_no
    WHERE i.product_identification_no IN ('20945558','20945559')
      AND i.resolution_status='UNRESOLVED' AND i.resolution_reason='CATALOG_NOT_FOUND'
      AND substr(json_extract(h.raw_json,'$.cntrctCnclsDate'),1,4) IN ('2008','2013','2014')
    ORDER BY i.contract_item_id`).all();
  const bidQuery = db.prepare(`SELECT b.bid_item_id,b.source_raw_item_id,r.canonical_json
    FROM bid_item b JOIN api_raw_item r ON r.raw_item_id=b.source_raw_item_id
    WHERE b.bid_ntce_no=? AND r.service='BidPublicInfoService'
      AND r.operation='getBidPblancListInfoThngPurchsObjPrdct'`);
  const rows = items.map(item => {
    const header = JSON.parse(item.header), detail = JSON.parse(item.detail);
    const bids = bidQuery.all(text(header.ntceNo).slice(0, 11)).map(bid => ({
      ...JSON.parse(bid.canonical_json), bidItemId: bid.bid_item_id, rawItemId: bid.source_raw_item_id,
    }));
    return { itemId: item.id, headerId: item.headerId, headerRawId: item.headerRawId,
      detailRawId: item.detailRawId, untyContractNo: header.untyCntrctNo,
      decisionContractNo: header.dcsnCntrctNo, ntceNo: header.ntceNo,
      ...inspectLink(header, detail, bids, item.catalogStatus === 'FOUND' ? item.catalogCode : null) };
  });
  // Also reject many contract items claiming the same bid item in one header.
  for (const row of rows.filter(row => row.code)) {
    if (rows.filter(other => other.headerId === row.headerId
      && other.candidates.some(candidate => candidate.bidItemId === row.candidates[0].bidItemId)).length > 1) {
      row.reason = 'AMBIGUOUS_BUNDLE'; delete row.code;
    }
  }
  const countCodes = values => Object.fromEntries([...FIXED_TARGET_CODES].map(code =>
    [code, values.filter(value => value === code).length]));
  const linked = rows.filter(row => row.code);
  return { mode: 'READ_ONLY_PREFLIGHT', applyImplemented: false,
    scope: 'contract header cntrctCnclsDate year 2008/2013/2014; product IDs 20945558/20945559',
    expected: { total: 36, linked: 21, byCode: { '4015155300': 6, '4015155301': 15 }, held: 15 },
    actual: { total: rows.length, linked: linked.length, byCode: countCodes(linked.map(row => row.code)),
      held: rows.length - linked.length },
    // Diagnostic only; these counts deliberately omit the mandatory order/change gates.
    relaxedDiagnostic: countCodes(rows.filter(row => row.candidates.length === 1)
      .map(row => row.candidates[0].code)),
    reasons: Object.fromEntries([...new Set(rows.map(row => row.reason))].map(reason =>
      [reason, rows.filter(row => row.reason === reason).length])),
    rows,
    sharedDecisionHeaders: db.prepare(`SELECT contract_header_id,unty_cntrct_no,source_raw_item_id
      FROM contract_header WHERE decision_contract_no='2014111953700' ORDER BY contract_header_id`).all(),
    databaseModified: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2].startsWith('--'))
    throw new Error('Usage: node tools/contract-bid-evidence-preview.mjs <database-path> (read-only only)');
  const db = new DatabaseSync(process.argv[2], { readOnly: true });
  try {
    db.exec('BEGIN');
    console.log(JSON.stringify(preview(db), null, 2));
  } finally { db.close(); }
}
