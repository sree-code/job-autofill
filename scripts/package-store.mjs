// Build the Chrome Web Store upload: store/job-autofill-<version>.zip
// Contains only what the extension loads (no tests, fixtures or dev bundles).
//   npm run package
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const stage = path.join(root, "store/build");
const zip = path.join(root, `store/job-autofill-${version}.zip`);

await rm(stage, { recursive: true, force: true });
await mkdir(path.join(stage, "dist"), { recursive: true });
for (const f of ["manifest.json", "icons", "src"]) await cp(path.join(root, f), path.join(stage, f), { recursive: true });
await rm(path.join(stage, "icons/src"), { recursive: true }); // icon source, not loaded
await rm(path.join(stage, "src/background.js")); // source of dist/background.js, not loaded
await cp(path.join(root, "dist/background.js"), path.join(stage, "dist/background.js"));
await cp(path.join(root, "dist/engine"), path.join(stage, "dist/engine"), { recursive: true });
await rm(zip, { force: true });
execFileSync("zip", ["-r", "-X", "-q", zip, "."], { cwd: stage });
await rm(stage, { recursive: true, force: true });
console.log(`${path.relative(root, zip)} (${Math.round((await stat(zip)).size / 1024)} KB)`);
