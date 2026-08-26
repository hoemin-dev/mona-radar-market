import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { extractLiveItems } from "../koneps/live-shape.js";
import { redactKonepsUrl, redactSecrets } from "../koneps/redaction.js";

export interface StartCollectorRunInput {
  readonly runId?: string;
  readonly mode: "period" | "incremental" | "verification";
  readonly requestedRangeStart?: string;
  readonly requestedRangeEnd?: string;
  readonly startedAt: string;
  readonly appVersion: string;
  readonly parserVersion: string;
}

export interface StartOperationRunInput {
  readonly operationRunId?: string;
  readonly runId: string;
  readonly service: string;
  readonly operation: string;
  readonly queryBasis: string;
  readonly effectiveRangeStart?: string;
  readonly effectiveRangeEnd?: string;
  readonly startedAt: string;
}

export interface PersistRawPageInput {
  readonly callId?: string;
  readonly operationRunId: string;
  readonly service: string;
  readonly operation: string;
  readonly requestedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly httpStatus: number;
  readonly resultCode: string;
  readonly resultMsg: string;
  readonly pageNo: number;
  readonly numOfRows: number;
  readonly totalCount: number;
  readonly requestMetadata: Readonly<Record<string, unknown>>;
  readonly requestUrl: string;
  readonly responseBytes: Uint8Array;
  readonly contentType?: string;
  readonly encoding?: string;
  readonly parsedJson: unknown;
  readonly parserVersion: string;
  readonly secrets?: readonly string[];
  readonly failAfterItemOrdinalForTest?: number;
}

export interface PersistRawPageResult {
  readonly callId: string;
  readonly responseSha256: string;
  readonly responseBlobId: number;
  readonly actualItemCount: number;
  readonly rawItemIds: readonly number[];
}

export interface PersistFailedCallInput {
  readonly callId?: string;
  readonly operationRunId: string;
  readonly service: string;
  readonly operation: string;
  readonly requestedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly httpStatus?: number;
  readonly resultCode?: string;
  readonly resultMsg?: string;
  readonly pageNo: number;
  readonly numOfRows: number;
  readonly totalCount?: number;
  readonly requestMetadata: Readonly<Record<string, unknown>>;
  readonly requestUrl: string;
  readonly errorCategory: string;
  readonly parseStatus: "failed" | "not_attempted";
  readonly responseBytes?: Uint8Array;
  readonly contentType?: string;
  readonly encoding?: string;
  readonly secrets?: readonly string[];
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
}

function storeResponseBlob(database: DatabaseSync, bytes: Uint8Array, contentType: string | undefined, encoding: string | undefined, storedAt: string): { id: number; sha256: string } {
  const hash = sha256(bytes);
  database.prepare(`INSERT INTO api_response_blob
    (response_sha256, response_body, byte_length, content_type, encoding, first_stored_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(response_sha256) DO NOTHING`)
    .run(hash, bytes, bytes.byteLength, contentType ?? null, encoding ?? null, storedAt);
  return { id: numericId(database.prepare("SELECT response_blob_id FROM api_response_blob WHERE response_sha256 = ?").get(hash), "response_blob_id"), sha256: hash };
}

function safeRequestMetadata(value: Readonly<Record<string, unknown>>, secrets: readonly string[]): string {
  return redactSecrets(stableStringify(value), secrets);
}

function numericId(row: unknown, name: string): number {
  const value = (row as Record<string, unknown> | undefined)?.[name];
  if (typeof value !== "number" && typeof value !== "bigint") throw new Error(`SQLite did not return ${name}`);
  return Number(value);
}

export function startCollectorRun(database: DatabaseSync, input: StartCollectorRunInput): string {
  const runId = input.runId ?? randomUUID();
  database.prepare(`INSERT INTO collector_run
    (run_id, mode, requested_range_start, requested_range_end, status, started_at, app_version, parser_version, schema_version)
    VALUES (?, ?, ?, ?, 'running', ?, ?, ?, CAST((SELECT user_version FROM pragma_user_version) AS INTEGER))`)
    .run(runId, input.mode, input.requestedRangeStart ?? null, input.requestedRangeEnd ?? null, input.startedAt, input.appVersion, input.parserVersion);
  return runId;
}

export function startOperationRun(database: DatabaseSync, input: StartOperationRunInput): string {
  const operationRunId = input.operationRunId ?? randomUUID();
  database.prepare(`INSERT INTO collector_operation_run
    (operation_run_id, run_id, service, operation, query_basis, effective_range_start, effective_range_end, status, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`)
    .run(operationRunId, input.runId, input.service, input.operation, input.queryBasis, input.effectiveRangeStart ?? null, input.effectiveRangeEnd ?? null, input.startedAt);
  return operationRunId;
}

export function persistRawPage(database: DatabaseSync, input: PersistRawPageInput): PersistRawPageResult {
  const callId = input.callId ?? randomUUID();
  const responseSha256 = sha256(input.responseBytes);
  const items = extractLiveItems(input.parsedJson);
  const redactedUrl = redactSecrets(redactKonepsUrl(input.requestUrl), input.secrets ?? []);
  const metadataJson = safeRequestMetadata(input.requestMetadata, input.secrets ?? []);
  if (/servicekey=(?!\[REDACTED\])/iu.test(redactedUrl)) throw new Error("request URL was not safely redacted");

  database.exec("BEGIN IMMEDIATE");
  try {
    const responseBlobId = storeResponseBlob(database, input.responseBytes, input.contentType, input.encoding, input.completedAt).id;
    database.prepare(`INSERT INTO api_call
      (call_id, operation_run_id, service, operation, requested_at, completed_at, duration_ms, http_status,
       result_code, result_msg, page_no, num_of_rows, total_count, actual_item_count, request_metadata_json,
       redacted_url, response_blob_id, status, parse_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', 'succeeded')`)
      .run(callId, input.operationRunId, input.service, input.operation, input.requestedAt, input.completedAt,
        input.durationMs, input.httpStatus, input.resultCode, redactSecrets(input.resultMsg, input.secrets ?? []),
        input.pageNo, input.numOfRows, input.totalCount, items.length, metadataJson, redactedUrl, responseBlobId);

    const rawItemIds: number[] = [];
    for (const [ordinal, item] of items.entries()) {
      const canonicalJson = stableStringify(item);
      const itemSha256 = sha256(canonicalJson);
      const identity = "bidNtceNo" in item && "bidNtceOrd" in item
        ? stableStringify({ bidNtceNo: item.bidNtceNo, bidNtceOrd: item.bidNtceOrd,
          ...(item.bidClsfcNo !== undefined ? { bidClsfcNo: item.bidClsfcNo } : {}),
          ...(item.rbidNo !== undefined ? { rbidNo: item.rbidNo } : {}) })
        : null;
      database.prepare(`INSERT INTO api_raw_item
        (service, operation, item_sha256, canonical_json, source_identity_json, parser_version, first_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(service, operation, item_sha256) DO NOTHING`)
        .run(input.service, input.operation, itemSha256, canonicalJson, identity, input.parserVersion, input.completedAt);
      const rawItemId = numericId(database.prepare("SELECT raw_item_id FROM api_raw_item WHERE service = ? AND operation = ? AND item_sha256 = ?").get(input.service, input.operation, itemSha256), "raw_item_id");
      rawItemIds.push(rawItemId);
      database.prepare(`INSERT INTO raw_item_observation
        (call_id, raw_item_id, page_no, item_ordinal, observed_at) VALUES (?, ?, ?, ?, ?)`)
        .run(callId, rawItemId, input.pageNo, ordinal, input.completedAt);
      if (input.failAfterItemOrdinalForTest === ordinal) throw new Error("intentional transaction failure");
    }
    database.prepare(`UPDATE collector_operation_run SET
      page_count = page_count + 1, call_count = call_count + 1, item_count = item_count + ?
      WHERE operation_run_id = ?`).run(items.length, input.operationRunId);
    database.prepare(`UPDATE collector_run SET
      total_calls = total_calls + 1, total_items = total_items + ?
      WHERE run_id = (SELECT run_id FROM collector_operation_run WHERE operation_run_id = ?)`)
      .run(items.length, input.operationRunId);
    database.exec("COMMIT");
    return { callId, responseSha256, responseBlobId, actualItemCount: items.length, rawItemIds };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function persistFailedCall(database: DatabaseSync, input: PersistFailedCallInput): string {
  const callId = input.callId ?? randomUUID();
  const secrets = input.secrets ?? [];
  const redactedUrl = redactSecrets(redactKonepsUrl(input.requestUrl), secrets);
  const metadataJson = safeRequestMetadata(input.requestMetadata, secrets);
  database.exec("BEGIN IMMEDIATE");
  try {
    const responseBlobId = input.responseBytes
      ? storeResponseBlob(database, input.responseBytes, input.contentType, input.encoding, input.completedAt ?? input.requestedAt).id
      : null;
    database.prepare(`INSERT INTO api_call
      (call_id, operation_run_id, service, operation, requested_at, completed_at, duration_ms, http_status,
       result_code, result_msg, page_no, num_of_rows, total_count, actual_item_count, request_metadata_json,
       redacted_url, response_blob_id, status, error_category, parse_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'failed', ?, ?)`)
      .run(callId, input.operationRunId, input.service, input.operation, input.requestedAt, input.completedAt ?? null,
        input.durationMs ?? null, input.httpStatus ?? null, input.resultCode ?? null,
        input.resultMsg ? redactSecrets(input.resultMsg, secrets) : null, input.pageNo, input.numOfRows,
        input.totalCount ?? null, metadataJson, redactedUrl, responseBlobId, input.errorCategory, input.parseStatus);
    database.prepare("UPDATE collector_operation_run SET call_count = call_count + 1, failed_call_count = failed_call_count + 1 WHERE operation_run_id = ?").run(input.operationRunId);
    database.prepare(`UPDATE collector_run SET total_calls = total_calls + 1, failed_calls = failed_calls + 1
      WHERE run_id = (SELECT run_id FROM collector_operation_run WHERE operation_run_id = ?)`)
      .run(input.operationRunId);
    database.exec("COMMIT");
    return callId;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
