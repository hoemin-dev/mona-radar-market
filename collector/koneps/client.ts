import { createHash } from "node:crypto";
import { KONEPS_SERVICE_ENDPOINTS } from "./endpoints.js";
import { KonepsError } from "./errors.js";
import { extractKonepsEnvelope } from "./envelope.js";
import { REDACTED, redactKonepsUrl, redactSecrets } from "./redaction.js";
import type {
  KonepsCallMetadata,
  KonepsFetch,
  KonepsOperation,
  KonepsRequestParams,
  KonepsResponse,
} from "./types.js";
import type { KonepsClientConfig } from "./config.js";

function diagnosticTarget(params: KonepsRequestParams): string | undefined {
  const values = params as unknown as Record<string, unknown>;
  return [values.dtilPrdctClsfcNo, values.prdctClsfcNoNm, values.bidNtceNo]
    .find((value): value is string => typeof value === "string" && value.length > 0);
}

function diagnosticMonth(params: KonepsRequestParams): string | undefined {
  const values = params as unknown as Record<string, unknown>;
  const value = [values.inqryBgnDate, values.inqryBgnDt]
    .find((candidate): candidate is string => typeof candidate === "string" && /^\d{6}/u.test(candidate));
  return value ? `${value.slice(0, 4)}-${value.slice(4, 6)}` : undefined;
}

function diagnosticLog(event: Readonly<Record<string, unknown>>): void {
  if (process.env.MARKET_COLLECTOR_DIAGNOSTICS === "1") console.log(JSON.stringify(event));
}

export interface KonepsClientOptions {
  readonly config: KonepsClientConfig;
  readonly fetch?: KonepsFetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
  readonly now?: () => Date;
  readonly pacer?: { beforeAttempt(): Promise<void>; imposeCooldown?(milliseconds: number): void };
  readonly rateLimitRetryDelaysMs?: readonly number[];
  readonly onRateLimitRetry?: (event: { attempt: number; waitSeconds: number; operation: string }) => void;
}

export interface KonepsClientCounters {
  readonly requestCount: number;
  readonly retryCount: number;
}

function encodeServiceKey(key: string, mode: KonepsClientConfig["serviceKeyMode"]): string {
  if (/[&#?\s]/u.test(key)) {
    throw new KonepsError("configuration", "KONEPS_SERVICE_KEY contains unsafe query separators");
  }
  return mode === "encode" ? encodeURIComponent(key) : key;
}

function buildRequestUrl<TParams extends KonepsRequestParams>(
  operation: KonepsOperation<TParams>,
  params: TParams,
  config: KonepsClientConfig,
): string {
  if (!Number.isInteger(params.pageNo) || params.pageNo < 1) {
    throw new KonepsError("configuration", "pageNo must be a positive integer");
  }
  if (!Number.isInteger(params.numOfRows) || params.numOfRows < 1) {
    throw new KonepsError("configuration", "numOfRows must be a positive integer");
  }
  try {
    operation.validate?.(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid operation parameters";
    throw new KonepsError("configuration", redactSecrets(message, [config.serviceKey]));
  }

  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (name === "ServiceKey" || value === undefined) continue;
    query.set(name, String(value));
  }
  if (!query.has("type") && operation.defaultResponseType) {
    query.set("type", operation.defaultResponseType);
  }
  const endpoint = KONEPS_SERVICE_ENDPOINTS[operation.service];
  const path = operation.path.replace(/^\/+|\/+$/gu, "");
  const encodedKey = encodeServiceKey(config.serviceKey, config.serviceKeyMode);
  return `${endpoint}/${path}?${query.toString()}&ServiceKey=${encodedKey}`;
}

function safeHeaders(headers: Headers): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(headers.entries()));
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class KonepsClient {
  readonly #config: KonepsClientConfig;
  readonly #fetch: KonepsFetch;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #random: () => number;
  readonly #now: () => Date;
  readonly #pacer?: { beforeAttempt(): Promise<void>; imposeCooldown?(milliseconds: number): void };
  readonly #rateLimitRetryDelaysMs?: readonly number[];
  readonly #onRateLimitRetry?: KonepsClientOptions["onRateLimitRetry"];
  #requestCount = 0;
  #retryCount = 0;

  constructor(options: KonepsClientOptions) {
    this.#config = options.config;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
    this.#now = options.now ?? (() => new Date());
    this.#pacer = options.pacer;
    this.#rateLimitRetryDelaysMs = options.rateLimitRetryDelaysMs;
    this.#onRateLimitRetry = options.onRateLimitRetry;
  }

  get counters(): KonepsClientCounters {
    return { requestCount: this.#requestCount, retryCount: this.#retryCount };
  }

  async request<TParams extends KonepsRequestParams>(
    operation: KonepsOperation<TParams>,
    params: TParams,
  ): Promise<KonepsResponse> {
    const url = buildRequestUrl(operation, params, this.#config);
    const redactedUrl = redactKonepsUrl(url);
    const started = this.#now();
    let attemptCount = 0;

    const metadata = (finished: Date, values: Partial<KonepsCallMetadata> = {}): KonepsCallMetadata => ({
      service: operation.service,
      operation: operation.path,
      redactedUrl,
      pageNo: params.pageNo,
      numOfRows: params.numOfRows,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - started.getTime()),
      attemptCount,
      retryCount: Math.max(0, attemptCount - 1),
      ...values,
    });

    while (true) {
      await this.#pacer?.beforeAttempt();
      attemptCount += 1;
      this.#requestCount += 1;
      const attemptStarted = this.#now();
      diagnosticLog({
        type: "KONEPS_REQUEST_START",
        collector: process.env.MARKET_COLLECTOR_KIND ?? "probe",
        phase: "request",
        endpoint: `${KONEPS_SERVICE_ENDPOINTS[operation.service]}/${operation.path}`,
        month: diagnosticMonth(params),
        target: diagnosticTarget(params),
        databasePath: process.env.MARKET_DB_PATH,
        cwd: process.cwd(),
        timeoutMs: this.#config.timeoutMs,
        attempt: attemptCount,
        serviceKeyPresent: this.#config.serviceKey.length > 0,
        serviceKeyLength: this.#config.serviceKey.length,
        serviceKeyHashPrefix: createHash("sha256").update(this.#config.serviceKey).digest("hex").slice(0, 8),
      });
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.#config.timeoutMs);

      try {
        const response = await this.#fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          if (response.status === 429 && this.#rateLimitRetryDelaysMs) {
            const retryIndex = attemptCount - 1;
            const waitMs = this.#rateLimitRetryDelaysMs[retryIndex];
            if (waitMs !== undefined) {
              this.#retryCount += 1;
              this.#onRateLimitRetry?.({ attempt: retryIndex + 1, waitSeconds: waitMs / 1000, operation: operation.path });
              if(this.#pacer?.imposeCooldown){this.#pacer.imposeCooldown(waitMs);}else{await this.#sleep(waitMs);}
              continue;
            }
          }
          if (shouldRetryStatus(response.status) && attemptCount <= this.#config.maxRetries) {
            await this.#backoff(attemptCount);
            continue;
          }
          const finished = this.#now();
          throw new KonepsError(
            "http",
            `KONEPS HTTP request failed with status ${response.status}`,
            metadata(finished, { httpStatus: response.status }),
          );
        }

        const buffer = await response.arrayBuffer();
        const bodyBytes = new Uint8Array(buffer);
        const bodyText = new TextDecoder("utf-8").decode(bodyBytes);
        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(bodyText) as unknown;
        } catch {
          const finished = this.#now();
          throw new KonepsError(
            "parse",
            "KONEPS response was not valid JSON",
            metadata(finished, { httpStatus: response.status }),
          );
        }

        const envelope = extractKonepsEnvelope(parsedJson);
        if (!envelope) {
          const finished = this.#now();
          throw new KonepsError(
            "structure",
            "KONEPS response did not contain the documented common envelope",
            metadata(finished, { httpStatus: response.status }),
          );
        }
        const finished = this.#now();
        const callMetadata = metadata(finished, {
          httpStatus: response.status,
          resultCode: envelope.resultCode,
          resultMsg: redactSecrets(envelope.resultMsg, [this.#config.serviceKey]),
        });
        if (envelope.resultCode !== "00") {
          throw new KonepsError(
            "api",
            `KONEPS API returned resultCode ${envelope.resultCode}`,
            callMetadata,
          );
        }
        return {
          status: response.status,
          headers: safeHeaders(response.headers),
          bodyBytes,
          bodyText,
          parsedJson,
          envelope,
          receivedAt: finished.toISOString(),
          durationMs: callMetadata.durationMs,
          metadata: callMetadata,
        };
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof KonepsError) throw error;
        const category = timedOut || (error instanceof DOMException && error.name === "AbortError")
          ? "timeout"
          : "network";
        diagnosticLog({
          type: "KONEPS_REQUEST_FAILURE",
          collector: process.env.MARKET_COLLECTOR_KIND ?? "probe",
          phase: category,
          endpoint: `${KONEPS_SERVICE_ENDPOINTS[operation.service]}/${operation.path}`,
          month: diagnosticMonth(params),
          target: diagnosticTarget(params),
          attempt: attemptCount,
          elapsedMs: Math.max(0, this.#now().getTime() - attemptStarted.getTime()),
        });
        if (attemptCount <= this.#config.maxRetries) {
          await this.#backoff(attemptCount);
          continue;
        }
        const finished = this.#now();
        throw new KonepsError(
          category,
          category === "timeout" ? "KONEPS request timed out" : "KONEPS network request failed",
          metadata(finished),
        );
      }
    }
    throw new KonepsError("network", `Unreachable KONEPS client state ${REDACTED}`);
  }

  async #backoff(failedAttempt: number): Promise<void> {
    this.#retryCount += 1;
    const exponential = this.#config.baseBackoffMs * (2 ** (failedAttempt - 1));
    const jitter = Math.floor(exponential * 0.25 * this.#random());
    await this.#sleep(exponential + jitter);
  }
}
