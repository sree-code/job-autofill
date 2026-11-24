// End-to-end check of the in-page panel on test/multistep.html in real Chrome:
// checklist groups, consent boxes left alone, Continue moves one step and
// never submits.   node test/panel-e2e.mjs   (SHOTS=dir to save screenshots)
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const srv = http.createServer(async (req, res) => {
  try { const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)); const body = await readFile(p); res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "text/plain" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => srv.listen(0, r));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const shot = async (page, name) => process.env.SHOTS && page.screenshot({ path: path.join(process.env.SHOTS, name) });
const panelState = (page) => page.evaluate(() => {
  const r = document.getElementById("applique-panel-host").shadowRoot;
  const groups = Object.fromEntries([...r.querySelectorAll(".group")].map((g) => [g.querySelector("h3").firstChild.textContent, [...g.querySelectorAll(".row .lbl")].map((l) => l.textContent)]));
  return { headline: r.querySelector(".headline").textContent, next: r.querySelector("[data-act=next]").textContent, nextDisabled: r.querySelector("[data-act=next]").disabled, title: r.querySelector(".job .title").textContent, org: r.querySelector(".job .org").textContent, groups };
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: process.env.SCHEME || "light" }]);
  await page.goto(`http://localhost:${srv.address().port}/test/multistep.html?auto=1&ai=0`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 1200));
  let s = await panelState(page);
  await shot(page, "panel-step1.png");
  assert.equal(s.title, "Software Engineer II (R-1234)");
  assert.equal(s.org, "Example Payments, localhost");
  assert.deepEqual(s.groups["From your profile"].sort(), ["Email", "First Name", "Last Name", "Phone"]);
  assert.equal(s.groups["Left for you to decide"].length, 1, "talent community box is listed, not ticked");
  assert.equal(await page.$eval("#tc", (e) => e.checked), false);
  assert.equal(s.next, "Continue: Next");

  // Continue: goes to step 2, never submits.
  await page.evaluate(() => document.getElementById("applique-panel-host").shadowRoot.querySelector("[data-act=next]").click());
  await new Promise((r) => setTimeout(r, 1500));
  s = await panelState(page);
  await shot(page, "panel-step2.png");
  assert.equal(await page.$eval("#s2", (e) => e.hidden), false, "moved to step 2");
  assert.notEqual(await page.evaluate(() => document.body.dataset.submitted), "1", "never submitted");
  assert.ok(s.groups["Needs you"].some((l) => /outside employment/i.test(l)));
  assert.ok(s.groups["Needs you"].some((l) => /desired salary/i.test(l)));
  assert.ok(s.groups["Left for you to decide"].some((l) => /certify/i.test(l)));
  assert.equal(await page.$eval("#cert", (e) => e.checked), false);
  assert.equal(s.nextDisabled, true, "only Submit is left, so Continue is off");
  assert.match(s.headline, /filled|Nothing/);
  console.log("panel e2e: ok");
} finally { await browser.close(); srv.close(); }
