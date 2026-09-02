import { KonepsError } from "../koneps/errors.js";
import type { KonepsOperation, KonepsRequestParams, KonepsResponse } from "../koneps/types.js";
import type { ContractClient } from "./contract-collector.js";

export const CONTRACT_RECOVERY_MAX_CYCLES = 3;
export const CONTRACT_RECOVERY_COOLDOWN_MS = 30_000;

export class ContractRecoveryCancelled extends Error {
  constructor() { super("Contract month recovery cancelled"); this.name = "ContractRecoveryCancelled"; }
}

export function contractTransientReason(error: unknown): "timeout" | "network" | "server" | undefined {
  if (!(error instanceof KonepsError)) return undefined;
  if (error.category === "timeout" || error.category === "network") return error.category;
  if (error.category === "http" && error.metadata?.httpStatus !== undefined && error.metadata.httpStatus >= 500) return "server";
  return undefined;
}

export async function interruptibleContractCooldown(milliseconds: number, isCancelled: () => boolean): Promise<void> {
  const deadline = Date.now() + milliseconds;
  while (!isCancelled()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    await new Promise<void>(resolve => setTimeout(resolve, Math.min(100, remaining)));
  }
  throw new ContractRecoveryCancelled();
}

export function contractRecoveryClient(options: {
  client: ContractClient;
  month: string;
  isCancelled: () => boolean;
  cooldown?: (milliseconds: number, isCancelled: () => boolean) => Promise<void>;
  log?: (event: Readonly<Record<string, unknown>>) => void;
}): ContractClient {
  const cooldown = options.cooldown ?? interruptibleContractCooldown;
  const log = options.log ?? (event => console.log(JSON.stringify(event)));
  return {
    async request<T extends KonepsRequestParams>(operation: KonepsOperation<T>, params: T): Promise<KonepsResponse> {
      for (let cycle = 0; ; cycle++) {
        if (options.isCancelled()) throw new ContractRecoveryCancelled();
        try { return await options.client.request(operation, params); }
        catch (error) {
          const reason = contractTransientReason(error);
          if (!reason) throw error;
          if (cycle === CONTRACT_RECOVERY_MAX_CYCLES) {
            log({ type: "CONTRACT_MONTH_RECOVERY_EXHAUSTED", month: options.month, cycles: CONTRACT_RECOVERY_MAX_CYCLES });
            throw error;
          }
          const recoveryCycle = cycle + 1;
          log({ type: "CONTRACT_MONTH_RECOVERY", month: options.month, cycle: recoveryCycle, maxCycles: CONTRACT_RECOVERY_MAX_CYCLES, cooldownMs: CONTRACT_RECOVERY_COOLDOWN_MS, reason });
          await cooldown(CONTRACT_RECOVERY_COOLDOWN_MS, options.isCancelled);
        }
      }
    },
  };
}
