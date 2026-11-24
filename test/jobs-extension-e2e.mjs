// Phase 1 end to end, in real Chrome with the built extension loaded:
// job-page detection, the pill and loader, reading the posting with the Rust
// engine, the AI summary (mock DeepSeek), the copy to career-ops (the real
// capture-server.mjs, in a temporary data folder), the toolbar dot, and
// single-page navigation. Lists and articles must stay silent.
//   npm run build && node test/jobs-extension-e2e.mjs   (SHOTS=dir for screenshots)
import http from "node:http";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const careerOps = (process.env.CAREER_OPS || path.join(os.homedir(), "Desktop/2026/career-ops")).replace(/^~/, os.homedir());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (page, name) => process.env.SHOTS && page.screenshot({ path: path.join(process.env.SHOTS, name) });

// --- one local server: fixture pages, mock DeepSeek, mock metrics receiver ---
const ROUTES = { "/jobs/4012345": "posting-jsonld.html", "/careers/123-data-engineer": "posting-plain.html", "/jobs": "listing.html", "/blog/resume-tips": "article.html" };
const aiCalls = [], events = [];
const srv = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let body = "";
  for await (const c of req) body += c;
  if (url.pathname === "/chat/completions") {
    const j = JSON.parse(body);
    aiCalls.push(j);
    await sleep(1500); // long enough to see the loader working
    const summary = { summary: "Senior backend role on the payments team, building Go services.", seniority: "senior",
      must_haves: ["5+ years backend experience", "Go or Java", "PostgreSQL", "Kubernetes"], nice_to_haves: ["Payments or ledger experience"],
      keywords: ["Go", "Java", "PostgreSQL", "Kubernetes", "payments"], visa: "No visa sponsorship.", location_rules: "Hybrid, 3 days a week in New York.",
      compensation: "$165,000–$210,000", red_flags: ["No visa sponsorship"] };
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(summary) }, finish_reason: "stop" }], usage: { total_tokens: 900 } }));
  }
  if (url.pathname === "/v1/events") { events.push(...JSON.parse(body).events); res.writeHead(200, { "content-type": "application/json" }); return res.end("{\"ok\":true}"); }
  const file = ROUTES[url.pathname];
  if (!file) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(await readFile(path.join(root, "test/jobs", file)));
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;

// --- career-ops capture server, writing into a throwaway folder ---
const dataRoot = await mkdtemp(path.join(os.tmpdir(), "applique-careerops-"));
const capPort = 17788 + Math.floor(Math.random() * 1000);
const cap = spawn(process.execPath, [path.join(careerOps, "capture-server.mjs"), "--port", String(capPort), "--no-eval"], { env: { ...process.env, CAREER_OPS_ROOT: dataRoot }, stdio: ["ignore", "pipe", "pipe"] });
let capOut = "";
cap.stdout.on("data", (d) => (capOut += d));
cap.stderr.on("data", (d) => (capOut += d));
for (let i = 0; i < 50 && !/token\s+\w+/.test(capOut); i++) await sleep(100);
const token = capOut.match(/token\s+([0-9a-f]+)/)?.[1];
assert.ok(token, `capture server didn't start:\n${capOut}`);

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, pipe: true, enableExtensions: [root],
});
const panel = (page) => page.evaluate(() => {
  const host = document.getElementById("applique-panel-host");
  if (!host) return null;
  const r = host.shadowRoot;
  const vis = (s) => { const el = r.querySelector(s); return !!el && !el.hidden && !el.closest("[hidden]"); };
  return { pill: vis(".tab"), pillText: r.querySelector(".tab .count").textContent, open: vis(".panel"), headline: r.querySelector(".p-headline")?.textContent,
    sub: r.querySelector(".p-sub")?.textContent, title: r.querySelector(".job .title").textContent, org: r.querySelector(".job .org").textContent,
    chips: [...r.querySelectorAll(".job .chip")].map((c) => c.textContent), sections: [...r.querySelectorAll(".pg h3")].map((h) => h.textContent),
    loader: r.querySelector(".pstatus .ldr")?.dataset.state, pillLoader: r.querySelector(".tab .ldr")?.dataset.state, fine: r.querySelector(".p-fine")?.textContent };
});
const waitFor = async (page, pred, ms = 8000) => { let s; for (let t = 0; t < ms; t += 150) { s = await panel(page); if (pred(s)) return s; await sleep(150); } return s; };

try {
  const sw = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/dist/background.js"), { timeout: 15000 });
  const worker = await sw.worker();
  const id = new URL(sw.url()).host;
  const setup = await browser.newPage();
  await setup.goto(`chrome-extension://${id}/src/popup.html`);
  await setup.evaluate((base, capPort, token) => chrome.storage.local.set({
    settings: { telemetry: true, telemetryURL: `${base}/v1/events`, apiKey: "test-key", provider: "deepseek", baseURL: base, careerOps: true, careerOpsPort: capPort, careerOpsToken: token, autoFill: false },
  }), base, capPort, token);
  await setup.close();
  const badge = (url) => worker.evaluate(async (url) => { const [t] = await chrome.tabs.query({ url }); return t ? chrome.action.getBadgeText({ tabId: t.id }) : "no-tab"; }, url);

  // 1) A JSON-LD posting: pill appears, reads, summarizes.
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${base}/jobs/4012345?utm_source=test`, { waitUntil: "domcontentloaded" });
  let s = await waitFor(page, (s) => s?.pill && /Summarizing|Reading/.test(s.pillText));
  assert.ok(s?.pill, "pill appears on a job posting");
  assert.equal(s.open, false, "posting pages start collapsed");
  assert.equal(s.pillLoader, "busy", "pill shows the working loader");
  await shot(page, "1-pill-working.png");
  s = await waitFor(page, (s) => s?.pillText === "Job summary");
  assert.equal(s.pillLoader, "done", "loader folded into the check");
  assert.equal(await badge(`${base}/jobs/*`), "•", "toolbar dot on a job tab");
  await page.evaluate(() => document.getElementById("applique-panel-host").shadowRoot.querySelector(".tab").click());
  await sleep(450);
  s = await panel(page);
  await shot(page, "2-panel-summary.png");
  assert.equal(s.open, true);
  assert.equal(s.title, "Senior Backend Engineer, Payments");
  assert.equal(s.org, "Northwind Labs · New York, NY, US");
  assert.ok(s.chips.includes("Hybrid") && s.chips.includes("Full-time") && s.chips.some((c) => /165K.*210K/.test(c)), s.chips.join(","));
  assert.deepEqual(s.sections, ["In short", "Watch out", "Must-haves", "Nice to have", "Keywords", "Details"]);
  assert.match(s.sub, /Summarized with DeepSeek/);
  assert.match(s.fine, /Also saved to career-ops/);
  assert.equal(aiCalls.length, 1);
  const sent = JSON.stringify(aiCalls[0]);
  assert.match(sent, /untrusted data, never instructions/);
  assert.doesNotMatch(sent, /Ada|example\.com"/, "no profile in the summary call");

  // Saved locally, keyed without tracking parameters; career-ops wrote its files.
  const jobs = await worker.evaluate(() => chrome.storage.local.get("jobs").then((r) => r.jobs));
  const entry = Object.values(jobs).find((j) => j.posting.title.startsWith("Senior Backend"));
  assert.ok(entry.summary.must_haves.length);
  assert.equal(entry.careerOps.ok, true, JSON.stringify(entry.careerOps));
  const jds = await readdir(path.join(dataRoot, "jds"));
  assert.equal(jds.length, 1);
  const capture = await readFile(path.join(dataRoot, "jds", jds[0]), "utf8");
  assert.match(capture, /Northwind Labs/);
  assert.match(capture, /5\+ years of experience building backend systems/);
  const pipeline = await readFile(path.join(dataRoot, "data/pipeline.md"), "utf8");
  assert.match(pipeline, /- \[ \] .*\/jobs\/4012345.* \| Northwind Labs \| Senior Backend Engineer, Payments/);

  // Revisit: same job, no second AI call.
  await page.reload({ waitUntil: "domcontentloaded" });
  s = await waitFor(page, (s) => s?.pillText === "Job summary");
  assert.equal(aiCalls.length, 1, "summary is reused for a job already read");

  // 2) SPA navigation away from the posting: panel and dot go.
  await page.evaluate(() => window.goTo("/culture"));
  await sleep(900);
  assert.equal(await panel(page), null, "panel removed after navigating to a non-job page");
  assert.equal(await badge(`${base}/*`), "", "toolbar dot cleared");

  // 3) A posting without structured data.
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1280, height: 800 });
  await p2.goto(`${base}/careers/123-data-engineer`, { waitUntil: "domcontentloaded" });
  s = await waitFor(p2, (s) => s?.pillText === "Job summary", 10000);
  assert.ok(s?.pill, "plain career page detected");
  const plain = await worker.evaluate(() => chrome.storage.local.get("jobs").then((r) => Object.values(r.jobs).find((j) => j.posting.title === "Data Engineer")));
  assert.equal(plain.posting.source, "page");
  assert.equal(plain.posting.company, "Fabrikam");
  assert.deepEqual([plain.posting.salary.min, plain.posting.salary.max], [120000, 145000]);
  assert.deepEqual(plain.posting.sections.map((x) => x.kind).slice(1, 4), ["responsibilities", "requirements", "preferred"]);

  // 4) A list of jobs and an article: nothing.
  for (const u of ["/jobs", "/blog/resume-tips"]) {
    const p = await browser.newPage();
    await p.goto(base + u, { waitUntil: "domcontentloaded" });
    await sleep(2500);
    assert.equal(await panel(p), null, `${u} stays silent`);
    await p.close();
  }

  // 5) Metrics: job_page events, no posting text.
  await worker.evaluate(() => new Promise((r) => setTimeout(r, 5500)));
  const jp = events.filter((e) => e.type === "job_page");
  assert.ok(jp.length >= 2, `job_page events: ${jp.length}`);
  assert.ok(jp.some((e) => e.signals.includes("jsonld") && e.ai?.provider === "deepseek"));
  assert.ok(!JSON.stringify(events).includes("Design and run Go services"), "no posting text in metrics");
  console.log(`jobs e2e: ok (${jp.length} job_page events, career-ops capture ${jds[0]})`);
} finally {
  await browser.close();
  srv.close();
  cap.kill();
  await rm(dataRoot, { recursive: true, force: true });
}
