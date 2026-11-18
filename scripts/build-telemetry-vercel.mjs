// Assemble telemetry/vercel/lib from the shared sources (run before deploying).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lib = path.join(root, "telemetry/vercel/lib");
await mkdir(lib, { recursive: true });
const copies = [
  ["src/telemetry.js", "telemetry.js"],
  ["src/config.js", "config.js"],
  ["telemetry/stats.mjs", "stats.mjs"],
  ["telemetry/core.mjs", "core.mjs"],
  ["telemetry/blob-handlers.mjs", "blob-handlers.mjs"],
];
for (const [from, to] of copies) {
  let s = await readFile(path.join(root, from), "utf8");
  s = s.replace('from "../src/telemetry.js"', 'from "./telemetry.js"');
  await writeFile(path.join(lib, to), `// GENERATED from ${from} by scripts/build-telemetry-vercel.mjs. Do not edit.\n${s}`);
}
console.log("telemetry/vercel/lib ready");
