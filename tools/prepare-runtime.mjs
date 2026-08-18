import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const runtime = join(root, "runtime");
const collector = join(runtime, "collector");
mkdirSync(runtime, { recursive: true });
copyFileSync(process.execPath, join(runtime, "node.exe"));
rmSync(collector, { recursive: true, force: true });
cpSync(join(root, "dist-collector"), collector, { recursive: true });
if (!existsSync(join(collector, "orchestration", "cli.js"))) throw new Error("collector build output was not created");
console.log("Prepared self-contained Market collector runtime.");
