import { KonepsError } from "./errors.js";

export type ServiceKeyMode = "preserve" | "encode";

export interface KonepsClientConfig {
  readonly serviceKey: string;
  readonly serviceKeyMode: ServiceKeyMode;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly baseBackoffMs: number;
}

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_BASE_BACKOFF_MS = 250;

export function loadKonepsConfig(env: NodeJS.ProcessEnv = process.env): KonepsClientConfig {
  const serviceKey = env.KONEPS_SERVICE_KEY?.trim();
  if (!serviceKey) {
    throw new KonepsError("configuration", "KONEPS_SERVICE_KEY is not configured");
  }
  const mode = env.KONEPS_SERVICE_KEY_MODE ?? "preserve";
  if (mode !== "preserve" && mode !== "encode") {
    throw new KonepsError("configuration", "KONEPS_SERVICE_KEY_MODE must be preserve or encode");
  }
  return {
    serviceKey,
    serviceKeyMode: mode,
    // 20 seconds is deliberately much higher than the documented 500 ms average.
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    baseBackoffMs: DEFAULT_BASE_BACKOFF_MS,
  };
}
