// Build the Rust engine to WebAssembly: engine/pkg/ (committed, so `npm run
// build` works without a Rust toolchain). Needs rustup's wasm32-unknown-unknown
// target and wasm-bindgen-cli 0.2.100 (same version as the crate).
//   npm run engine          (build)
//   npm run engine:test     (cargo test)
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, PATH: `${path.join(os.homedir(), ".cargo/bin")}:${process.env.PATH}` };
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, env, stdio: "inherit" });

if (process.argv.includes("--test")) { run("cargo", ["test"], path.join(root, "engine")); process.exit(0); }
run("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown", "-p", "applique-core"], path.join(root, "engine"));
run("wasm-bindgen", [
  "engine/target/wasm32-unknown-unknown/release/applique_core.wasm",
  "--target", "web", "--out-dir", "engine/pkg", "--no-typescript",
], root);
const kb = (f) => (statSync(path.join(root, "engine/pkg", f)).size / 1024).toFixed(1);
console.log(`engine/pkg/applique_core_bg.wasm ${kb("applique_core_bg.wasm")} KB, applique_core.js ${kb("applique_core.js")} KB`);
