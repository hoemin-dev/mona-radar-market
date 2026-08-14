import type { DatabaseSync } from "node:sqlite";
import { BID_BASIS_AMOUNT_OPERATION, BID_ITEM_OPERATION, PHASE3E_SERVICE, normalizeBidBasisAmount, normalizeBidItem } from "./phase3e.js";

export type Phase3eWriteAction = "inserted" | "unchanged" | "updated" | "deferred";
export interface Phase3eWriteResult { readonly action: Phase3eWriteAction; readonly entityId: number | null; readonly semanticRowHash: string; readonly warningCount: number; }

const ITEM_COLUMNS = [
  ["bidNtceNo","bid_ntce_no"],["bidNtceOrd","bid_ntce_ord"],["bidClsfcNo","bid_clsfc_no"],["productSeq","product_seq"],
  ["demandInstitutionCode","demand_institution_code"],["demandInstitutionName","demand_institution_name"],
  ["productClassNo","product_class_no"],["productClassName","product_class_name"],["detailedProductClassNo","detailed_product_class_no"],
  ["detailedProductClassName","detailed_product_class_name"],["productSpecification","product_specification"],["quantity","quantity"],["unit","unit"],
  ["unitPrice","unit_price"],["deliveryDeadlineRaw","delivery_deadline_raw"],["deliveryDeadlineLocal","delivery_deadline_local"],
  ["deliveryDayCount","delivery_day_count"],["deliveryPlace","delivery_place"],["deliveryConditionName","delivery_condition_name"],
  ["noticePostedRaw","notice_posted_raw"],["noticePostedLocal","notice_posted_local"],
] as const;

const BASIS_COLUMNS = [
  ["bidNtceNo","bid_ntce_no"],["bidNtceOrd","bid_ntce_ord"],["bidClsfcNo","bid_clsfc_no"],["bidNtceName","bid_ntce_name"],
  ["basisAmount","basis_amount"],["basisAmountOpenRaw","basis_amount_open_raw"],["basisAmountOpenLocal","basis_amount_open_local"],
  ["reservePriceRangeBeginRate","reserve_price_range_begin_rate"],["reservePriceRangeEndRate","reserve_price_range_end_rate"],
  ["evaluationBasisAmount","evaluation_basis_amount"],["difficultyCoefficient","difficulty_coefficient"],
  ["otherGeneralExpenseBasisRate","other_general_expense_basis_rate"],["generalManagementCostBasisRate","general_management_cost_basis_rate"],
  ["profitBasisRate","profit_basis_rate"],["laborCostBasisRate","labor_cost_basis_rate"],
  ["industrialSafetyHealthManagementCost","industrial_safety_health_management_cost"],["retirementMutualAid","retirement_mutual_aid"],
  ["environmentalConservationCost","environmental_conservation_cost"],["subcontractPaymentGuaranteeFee","subcontract_payment_guarantee_fee"],
  ["healthInsurancePremium","health_insurance_premium"],["nationalPensionPremium","national_pension_premium"],
  ["remark1","remark1"],["remark2","remark2"],["usefulAmount","useful_amount"],["inputRaw","input_raw"],["inputLocal","input_local"],
] as const;

function raw(database: DatabaseSync, rawItemId: number, operation: string): Record<string, unknown> {
  const row = database.prepare("SELECT service,operation,canonical_json FROM api_raw_item WHERE raw_item_id=?").get(rawItemId) as { service:string; operation:string; canonical_json:string } | undefined;
  if (!row) throw new Error(`RAW item ${rawItemId} does not exist`);
  if (row.service !== PHASE3E_SERVICE || row.operation !== operation) throw new Error("RAW item is not from the supported Phase 3-E operation");
  return JSON.parse(row.canonical_json) as Record<string, unknown>;
}

function parent(database: DatabaseSync, no: string, ord: string): number | null {
  const row = database.prepare("SELECT bid_notice_id FROM bid_notice WHERE bid_ntce_no=? AND bid_ntce_ord=?").get(no, ord) as { bid_notice_id:number|bigint } | undefined;
  return row ? Number(row.bid_notice_id) : null;
}

function write(database: DatabaseSync, spec: {
  table:string; idColumn:string; revisionTable:string; revisionFk:string; operation:string; rawItemId:number; normalizedAt:string;
  candidate:Record<string, string | bigint | null>; columns:readonly (readonly [string,string])[]; keyColumns:readonly string[];
  semanticRowHash:string; semanticStateJson:string; warnings:readonly unknown[];
}): Phase3eWriteResult {
  const noticeId = parent(database, String(spec.candidate.bidNtceNo), String(spec.candidate.bidNtceOrd));
  if (noticeId === null) return { action:"deferred", entityId:null, semanticRowHash:spec.semanticRowHash, warningCount:spec.warnings.length };
  const values = spec.columns.map(([field]) => spec.candidate[field] ?? null);
  const keyValues = spec.keyColumns.map((field) => spec.candidate[field] ?? null);
  const where = spec.keyColumns.map((_,i) => `${spec.columns.find(([f]) => f===spec.keyColumns[i])![1]}=?`).join(" AND ");
  const warningsJson = JSON.stringify(spec.warnings);
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = database.prepare(`SELECT ${spec.idColumn} AS id,semantic_row_hash,semantic_state_json,source_raw_item_id FROM ${spec.table} WHERE ${where}`).get(...keyValues) as { id:number|bigint; semantic_row_hash:string; semantic_state_json:string; source_raw_item_id:number|bigint } | undefined;
    if (!existing) {
      const dbColumns = spec.columns.map(([,column]) => column);
      const result = database.prepare(`INSERT INTO ${spec.table} (bid_notice_id,${dbColumns.join(",")},source_raw_item_id,source_operation,semantic_row_hash,semantic_state_json,parse_warnings_json,first_normalized_at,last_normalized_at) VALUES (?,${dbColumns.map(()=>"?").join(",")},?,?,?,?,?,?,?)`)
        .run(noticeId,...values,spec.rawItemId,spec.operation,spec.semanticRowHash,spec.semanticStateJson,warningsJson,spec.normalizedAt,spec.normalizedAt);
      database.exec("COMMIT");
      return { action:"inserted", entityId:Number(result.lastInsertRowid), semanticRowHash:spec.semanticRowHash, warningCount:spec.warnings.length };
    }
    const entityId = Number(existing.id);
    if (existing.semantic_row_hash === spec.semanticRowHash) {
      database.prepare(`UPDATE ${spec.table} SET source_raw_item_id=?,source_operation=?,parse_warnings_json=?,last_normalized_at=? WHERE ${spec.idColumn}=?`)
        .run(spec.rawItemId,spec.operation,warningsJson,spec.normalizedAt,entityId);
      database.exec("COMMIT");
      return { action:"unchanged", entityId, semanticRowHash:spec.semanticRowHash, warningCount:spec.warnings.length };
    }
    database.prepare(`INSERT INTO ${spec.revisionTable} (${spec.revisionFk},changed_at,previous_row_hash,new_row_hash,previous_source_raw_item_id,new_source_raw_item_id,previous_state_json,new_state_json) VALUES (?,?,?,?,?,?,?,?)`)
      .run(entityId,spec.normalizedAt,existing.semantic_row_hash,spec.semanticRowHash,existing.source_raw_item_id,spec.rawItemId,existing.semantic_state_json,spec.semanticStateJson);
    database.prepare(`UPDATE ${spec.table} SET ${spec.columns.map(([,c])=>`${c}=?`).join(",")},source_raw_item_id=?,source_operation=?,semantic_row_hash=?,semantic_state_json=?,parse_warnings_json=?,last_normalized_at=? WHERE ${spec.idColumn}=?`)
      .run(...values,spec.rawItemId,spec.operation,spec.semanticRowHash,spec.semanticStateJson,warningsJson,spec.normalizedAt,entityId);
    database.exec("COMMIT");
    return { action:"updated", entityId, semanticRowHash:spec.semanticRowHash, warningCount:spec.warnings.length };
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

export function normalizeBidItemRawItem(database: DatabaseSync, rawItemId: number, normalizedAt: string): Phase3eWriteResult {
  const n = normalizeBidItem(raw(database,rawItemId,BID_ITEM_OPERATION));
  return write(database,{ table:"bid_item",idColumn:"bid_item_id",revisionTable:"bid_item_revision",revisionFk:"bid_item_id",operation:BID_ITEM_OPERATION,rawItemId,normalizedAt,candidate:n.candidate,columns:ITEM_COLUMNS,keyColumns:["bidNtceNo","bidNtceOrd","bidClsfcNo","productSeq"],semanticRowHash:n.semanticRowHash,semanticStateJson:n.semanticStateJson,warnings:n.warnings });
}

export function normalizeBidBasisAmountRawItem(database: DatabaseSync, rawItemId: number, normalizedAt: string): Phase3eWriteResult {
  const n = normalizeBidBasisAmount(raw(database,rawItemId,BID_BASIS_AMOUNT_OPERATION));
  return write(database,{ table:"bid_basis_amount",idColumn:"bid_basis_amount_id",revisionTable:"bid_basis_amount_revision",revisionFk:"bid_basis_amount_id",operation:BID_BASIS_AMOUNT_OPERATION,rawItemId,normalizedAt,candidate:n.candidate,columns:BASIS_COLUMNS,keyColumns:["bidNtceNo","bidNtceOrd","bidClsfcNo"],semanticRowHash:n.semanticRowHash,semanticStateJson:n.semanticStateJson,warnings:n.warnings });
}
