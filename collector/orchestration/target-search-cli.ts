import { KonepsError } from "../koneps/errors.js";
import { searchCollectorTargets } from "../koneps/target-search.js";

async function main(): Promise<void> {
  const query = process.argv[2] ?? "";
  try {
    console.log(JSON.stringify({ ok: true, ...(await searchCollectorTargets(query)) }));
  } catch (error) {
    const koneps = error instanceof KonepsError ? error : undefined;
    console.log(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Target search failed",
      resultCode: koneps?.metadata?.resultCode,
      resultMsg: koneps?.metadata?.resultMsg,
    }));
  }
}

void main();
