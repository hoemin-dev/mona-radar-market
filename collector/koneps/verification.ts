import type { LiveShapeReport } from "./live-shape.js";

export const MAX_VERIFICATION_WINDOW_MINUTES = 6 * 60;
export const MAX_VERIFICATION_ROWS = 10;
export const MAX_VERIFICATION_PAGE = 10;
export const HISTORICAL_THRESHOLD_DAYS = 7;

export interface VerificationArguments {
  readonly execute: boolean;
  readonly historical: boolean;
  readonly from: string;
  readonly to: string;
  readonly pageNo: number;
  readonly numOfRows: number;
  readonly fixtureName: string;
}

export interface VerificationPage {
  readonly requestedPageNo: number;
  readonly returnedPageNo?: number;
  readonly returnedNumOfRows?: number;
  readonly totalCount?: number;
  readonly identities: readonly string[];
  readonly shape: LiveShapeReport;
}

export interface PaginationSummary {
  readonly pageItemCounts: readonly number[];
  readonly totalCounts: readonly (number | undefined)[];
  readonly duplicateIdentities: readonly string[];
  readonly totalCountDrift: boolean;
  readonly finalPageObserved: boolean;
}

function formatKstMinute(date: Date): string {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16).replace(/[-T:]/gu, "");
}

export function parseKstMinute(value: string): number {
  if (!/^\d{12}$/u.test(value)) throw new Error("date arguments must use YYYYMMDDHHMM");
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  const timestamp = Date.UTC(year, month - 1, day, hour - 9, minute);
  if (formatKstMinute(new Date(timestamp)) !== value) throw new Error("date arguments contain an invalid calendar value");
  return timestamp;
}

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, name: string, maximum: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

export function parseVerificationArguments(argv: readonly string[], now = new Date()): VerificationArguments {
  const from = option(argv, "--from") ?? formatKstMinute(new Date(now.getTime() - 30 * 60_000));
  const to = option(argv, "--to") ?? formatKstMinute(new Date(now.getTime() - 20 * 60_000));
  const pageNo = positiveInteger(option(argv, "--page"), 1, "--page", MAX_VERIFICATION_PAGE);
  const numOfRows = positiveInteger(option(argv, "--rows"), 5, "--rows", MAX_VERIFICATION_ROWS);
  const fixtureName = option(argv, "--fixture-name") ?? "bid-notice";
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(fixtureName)) {
    throw new Error("--fixture-name must contain only lowercase letters, digits, and hyphens");
  }
  const fromMs = parseKstMinute(from);
  const toMs = parseKstMinute(to);
  if (fromMs > toMs) throw new Error("--from must not be later than --to");
  if (toMs > now.getTime()) throw new Error("--to must not be in the future");
  if ((toMs - fromMs) / 60_000 > MAX_VERIFICATION_WINDOW_MINUTES) {
    throw new Error(`verification windows are limited to ${MAX_VERIFICATION_WINDOW_MINUTES} minutes`);
  }
  const historical = argv.includes("--historical");
  if (fromMs < now.getTime() - HISTORICAL_THRESHOLD_DAYS * 24 * 60 * 60_000 && !historical) {
    throw new Error("dates older than 7 days require the explicit --historical flag");
  }
  return { execute: argv.includes("--execute"), historical, from, to, pageNo, numOfRows, fixtureName };
}

export function summarizePagination(pages: readonly VerificationPage[]): PaginationSummary {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const page of pages) {
    for (const identity of page.identities) {
      if (seen.has(identity)) duplicates.add(identity);
      seen.add(identity);
    }
  }
  const definedCounts = pages.map((page) => page.totalCount).filter((value): value is number => value !== undefined);
  return {
    pageItemCounts: pages.map((page) => page.shape.itemCount),
    totalCounts: pages.map((page) => page.totalCount),
    duplicateIdentities: [...duplicates].sort(),
    totalCountDrift: new Set(definedCounts).size > 1,
    finalPageObserved: pages.some((page) =>
      page.returnedNumOfRows !== undefined && page.shape.itemCount < page.returnedNumOfRows,
    ),
  };
}
