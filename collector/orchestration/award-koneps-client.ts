import { KonepsClient as BaseKonepsClient, type KonepsClientOptions } from "../koneps/client.js";
import { KonepsError } from "../koneps/errors.js";
import type { KonepsOperation, KonepsRequestParams, KonepsResponse } from "../koneps/types.js";

export class AwardKonepsClient extends BaseKonepsClient {
  readonly #timeoutRetryDelayMs: number;
  readonly #timeoutRetries: number;
  readonly #sleepAfterTimeout: (milliseconds: number) => Promise<void>;

  constructor(options: KonepsClientOptions & { awardTimeoutRetryDelayMs?: number; awardTimeoutRetries?: number }) {
    super(options);
    this.#timeoutRetryDelayMs = options.awardTimeoutRetryDelayMs ?? 5_000;
    this.#timeoutRetries = options.awardTimeoutRetries ?? 3;
    this.#sleepAfterTimeout = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  override async request<TParams extends KonepsRequestParams>(
    operation: KonepsOperation<TParams>,
    params: TParams,
  ): Promise<KonepsResponse> {
    let timeoutRetries = 0;
    while (true) {
      try {
        return await super.request(operation, params);
      } catch (error) {
        if (!(error instanceof KonepsError) || error.category !== "timeout" || timeoutRetries >= this.#timeoutRetries) throw error;
        timeoutRetries += 1;
        console.log(JSON.stringify({ type: "AWARD_TIMEOUT_RETRY", operation: operation.path, attempt: timeoutRetries, maxRetries: this.#timeoutRetries }));
        await this.#sleepAfterTimeout(this.#timeoutRetryDelayMs);
      }
    }
  }
}
