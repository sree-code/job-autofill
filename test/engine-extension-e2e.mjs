// Loads the built extension in Chrome and calls the Rust engine through the
// MV3 service worker (CSP 'wasm-unsafe-eval'), from an extension page.
//   npm run build && node test/engine-extension-e2e.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, pipe: true, enableExtensions: [root],
});
try {
  const sw = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/dist/background.js"), { timeout: 15000 });
  const id = new URL(sw.url()).host;
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${id}/src/popup.html`);
  const t0 = Date.now();
  const res = await page.evaluate(async () => {
    const ask = (m) => new Promise((r) => chrome.runtime.sendMessage(m, r));
    return { info: await ask({ type: "ENGINE", op: "info" }),
      cov: await ask({ type: "ENGINE", op: "coverage", keywords: ["React", "Azure", "k8s"], text: "React developer running Kubernetes" }) };
  });
  assert.equal(res.info.name, "applique-core", JSON.stringify(res));
  assert.deepEqual(res.cov, { matched: ["React", "k8s"], missing: ["Azure"], percent: 67 });
  console.log(`engine in extension: ok (${res.info.name} ${res.info.version}, first call incl. WASM init ${Date.now() - t0} ms)`);
} finally { await browser.close(); }
