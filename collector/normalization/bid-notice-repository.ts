import type { DatabaseSync } from "node:sqlite";
import { BID_NOTICE_OPERATION, BID_NOTICE_SERVICE, normalizeBidNotice, type NormalizedBidNotice } from "./bid-notice.js";

export type BidNoticeWriteAction = "inserted" | "unchanged" | "updated";

export interface BidNoticeWriteResult {
  readonly action: BidNoticeWriteAction;
  readonly bidNoticeId: number;
  readonly semanticRowHash: string;
  readonly warningCount: number;
}

const FIELD_COLUMNS: readonly [keyof NormalizedBidNotice, string][] = [
  ["bidNtceNo", "bid_ntce_no"], ["bidNtceOrd", "bid_ntce_ord"], ["bidNtceName", "bid_ntce_name"],
  ["noticeKindName", "notice_kind_name"], ["registrationTypeName", "registration_type_name"], ["referenceNo", "reference_no"],
  ["noticeInstitutionCode", "notice_institution_code"], ["noticeInstitutionName", "notice_institution_name"],
  ["demandInstitutionCode", "demand_institution_code"], ["demandInstitutionName", "demand_institution_name"],
  ["contractMethodName", "contract_method_name"], ["bidMethodName", "bid_method_name"],
  ["awardMethodCode", "award_method_code"], ["awardMethodName", "award_method_name"],
  ["noticePostedRaw", "notice_posted_raw"], ["noticePostedLocal", "notice_posted_local"],
  ["bidBeginRaw", "bid_begin_raw"], ["bidBeginLocal", "bid_begin_local"], ["bidCloseRaw", "bid_close_raw"],
  ["bidCloseLocal", "bid_close_local"], ["openingRaw", "opening_raw"], ["openingLocal", "opening_local"],
  ["registeredRaw", "registered_raw"], ["registeredLocal", "registered_local"], ["changedRaw", "changed_raw"],
  ["changedLocal", "changed_local"], ["detailedProductClassNo", "detailed_product_class_no"],
  ["detailedProductClassName", "detailed_product_class_name"], ["productQuantity", "product_quantity"],
  ["productUnit", "product_unit"], ["productUnitPrice", "product_unit_price"],
  ["productSpecification", "product_specification"], ["purchaseProductListRaw", "purchase_product_list_raw"],
  ["allocatedBudgetAmount", "allocated_budget_amount"], ["estimatedPrice", "estimated_price"],
  ["vatAmount", "vat_amount"], ["industryVatAmount", "industry_vat_amount"],
  ["internationalBidYn", "international_bid_yn"], ["reNoticeYn", "re_notice_yn"],
  ["rebidPermittedYn", "rebid_permitted_yn"], ["manufactureYn", "manufacture_yn"],
  ["designatedCompetitionYn", "designated_competition_yn"], ["productClassLimitYn", "product_class_limit_yn"],
  ["noticeUrl", "notice_url"], ["noticeDetailUrl", "notice_detail_url"],
  ["standardNoticeDocumentUrl", "standard_notice_document_url"],
];

function numberId(value: unknown, name: string): number {
  if (typeof value !== "number" && typeof value !== "bigint") throw new Error(`Missing ${name}`);
  return Number(value);
}

export function normalizeBidNoticeRawItem(database: DatabaseSync, rawItemId: number, normalizedAt: string): BidNoticeWriteResult {
  const rawRow = database.prepare("SELECT service, operation, canonical_json FROM api_raw_item WHERE raw_item_id = ?").get(rawItemId) as { service: string; operation: string; canonical_json: string } | undefined;
  if (!rawRow) throw new Error(`RAW item ${rawItemId} does not exist`);
  if (rawRow.service !== BID_NOTICE_SERVICE || rawRow.operation !== BID_NOTICE_OPERATION) {
    throw new Error("RAW item is not from the supported bid-notice operation");
  }
  const raw = JSON.parse(rawRow.canonical_json) as Record<string, unknown>;
  const normalized = normalizeBidNotice(raw);
  const warningsJson = JSON.stringify(normalized.warnings);
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = database.prepare(`SELECT bid_notice_id, semantic_row_hash, semantic_state_json, source_raw_item_id
      FROM bid_notice WHERE bid_ntce_no = ? AND bid_ntce_ord = ?`)
      .get(normalized.candidate.bidNtceNo, normalized.candidate.bidNtceOrd) as {
        bid_notice_id: number | bigint; semantic_row_hash: string; semantic_state_json: string; source_raw_item_id: number | bigint;
      } | undefined;
    if (!existing) {
      const columns = FIELD_COLUMNS.map(([, column]) => column);
      const values = FIELD_COLUMNS.map(([field]) => normalized.candidate[field]);
      const result = database.prepare(`INSERT INTO bid_notice
        (${columns.join(",")}, source_raw_item_id, source_operation, semantic_row_hash, semantic_state_json,
         parse_warnings_json, first_normalized_at, last_normalized_at)
        VALUES (${columns.map(() => "?").join(",")}, ?, ?, ?, ?, ?, ?, ?)`)
        .run(...values, rawItemId, BID_NOTICE_OPERATION, normalized.semanticRowHash, normalized.semanticStateJson,
          warningsJson, normalizedAt, normalizedAt);
      database.exec("COMMIT");
      return { action: "inserted", bidNoticeId: numberId(result.lastInsertRowid, "bid_notice_id"), semanticRowHash: normalized.semanticRowHash, warningCount: normalized.warnings.length };
    }

    const bidNoticeId = numberId(existing.bid_notice_id, "bid_notice_id");
    if (existing.semantic_row_hash === normalized.semanticRowHash) {
      database.prepare(`UPDATE bid_notice SET source_raw_item_id = ?, source_operation = ?,
        parse_warnings_json = ?, last_normalized_at = ? WHERE bid_notice_id = ?`)
        .run(rawItemId, BID_NOTICE_OPERATION, warningsJson, normalizedAt, bidNoticeId);
      database.exec("COMMIT");
      return { action: "unchanged", bidNoticeId, semanticRowHash: normalized.semanticRowHash, warningCount: normalized.warnings.length };
    }

    database.prepare(`INSERT INTO bid_notice_revision
      (bid_notice_id, changed_at, previous_row_hash, new_row_hash, previous_source_raw_item_id,
       new_source_raw_item_id, previous_state_json, new_state_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(bidNoticeId, normalizedAt, existing.semantic_row_hash, normalized.semanticRowHash,
        existing.source_raw_item_id, rawItemId, existing.semantic_state_json, normalized.semanticStateJson);
    const assignments = FIELD_COLUMNS.map(([, column]) => `${column} = ?`);
    const values = FIELD_COLUMNS.map(([field]) => normalized.candidate[field]);
    database.prepare(`UPDATE bid_notice SET ${assignments.join(",")}, source_raw_item_id = ?, source_operation = ?,
      semantic_row_hash = ?, semantic_state_json = ?, parse_warnings_json = ?, last_normalized_at = ?
      WHERE bid_notice_id = ?`)
      .run(...values, rawItemId, BID_NOTICE_OPERATION, normalized.semanticRowHash, normalized.semanticStateJson,
        warningsJson, normalizedAt, bidNoticeId);
    database.exec("COMMIT");
    return { action: "updated", bidNoticeId, semanticRowHash: normalized.semanticRowHash, warningCount: normalized.warnings.length };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
