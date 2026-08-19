import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const KONEPS_ENV_NAMES = new Set(["KONEPS_SERVICE_KEY", "KONEPS_SERVICE_KEY_MODE"]);

function projectRoot(start: string): string | undefined {
  let current = start;
  for (let depth = 0; depth < 4; depth += 1) {
    const packagePath = join(current, "package.json");
    if (existsSync(packagePath)) {
      try {
        const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown };
        if (parsed.name === "mona-radar-market") return current;
      } catch {
        return undefined;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  return trimmed.length >= 2 && (first === '"' || first === "'") && trimmed.at(-1) === first
    ? trimmed.slice(1, -1)
    : trimmed;
}

/** Development-only credential source. Production credentials remain process environment based. */
export function loadDevelopmentKonepsEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): void {
  const root = env.MARKET_PROJECT_ROOT
    ? projectRoot(env.MARKET_PROJECT_ROOT)
    : projectRoot(cwd);
  if (!root) return;
  const path = join(root, ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/u.exec(line);
    if (!match || !KONEPS_ENV_NAMES.has(match[1]!)) continue;
    const name = match[1]!;
    if (env[name] !== undefined) continue;
    const value = unquote(match[2]!);
    if (value) env[name] = value;
  }
}
