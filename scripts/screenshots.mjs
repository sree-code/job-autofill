// Capture UI screenshots with dummy data into docs/screenshots/.
//   npm run build -- --fixtures && node scripts/screenshots.mjs
// Uses your installed Chrome (CHROME_PATH to override). chrome.* is stubbed.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { start as startMockAI } from "../test/mock-claude.mjs";
import { createServer as telemetryServer } from "../telemetry/server.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "docs/screenshots");
const CHROME = process.env.CHROME_PATH || {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  win32: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  linux: "/usr/bin/google-chrome",
}[process.platform];

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
const files = http.createServer(async (req, res) => {
  try {
    const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(root)) throw 0;
    const body = await readFile(p);
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => files.listen(0, r));
const base = `http://localhost:${files.address().port}`;

// Mock AI on :8787 (the test harness expects it there); reuse one if already running.
let ai = null;
try { await fetch("http://localhost:8787/inject.js"); } catch { ai = await startMockAI(8787); }

// Dummy-data stub for extension pages.
const STUB = ({ consentAnswered, report }) => {
  const store = {
    profile: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "555-0100", phoneDeviceType: "Mobile",
      address1: "1 Engine Way", city: "Austin", state: "Texas", postalCode: "78701", country: "United States", location: "Austin, TX",
      linkedin: "https://linkedin.com/in/ada-demo", github: "https://github.com/ada-demo", currentCompany: "Analytical Engines",
      currentTitle: "Senior Engineer", yearsExperience: "6", school: "University of London", degree: "MS", major: "Mathematics", gradYear: "2019",
      workAuthorized: "Yes", needsSponsorship: "No", willingToRelocate: "Yes", summary: "Full-stack engineer focused on React and Java services.",
      skills: "TypeScript, React, Java, Spring Boot, AWS", workHistory: "Senior Engineer, Analytical Engines, Austin, TX, 2021–Present: led React migration.\nEngineer, Difference Co, Remote, 2019–2021: built REST APIs." },
    resume: { name: "Ada_Lovelace_Resume.pdf", dataUrl: "data:application/pdf;base64,JVBERi0=" },
    settings: { autoFill: true, aiEnabled: true, provider: "deepseek", apiKey: "sk-demo-not-a-real-key", reasoning: "low", telemetryURL: "https://telemetry.example.com/v1/events", ...(consentAnswered ? { telemetry: true } : {}) },
  };
  const pick = (k) => (k == null ? store : Object.fromEntries([].concat(k).map((x) => [x, store[x]])));
  window.chrome = {
    storage: { local: { get: (k, cb) => (cb ? cb(pick(k)) : Promise.resolve(pick(k))), set: (o, cb) => (Object.assign(store, o), cb ? cb() : Promise.resolve()) } },
    runtime: {
      lastError: undefined, getManifest: () => ({ version: "0.3.0" }), openOptionsPage() {},
      sendMessage: (m, cb) => cb?.(m.type === "AI_STATUS" ? { sessionNumber: 3, turns: 7, contextTokens: 18450, contextLimit: 120000, rollovers: 2, memoryChars: 1840, provider: "deepseek", model: "deepseek-flash" } : {}),
      onMessage: { addListener() {} },
    },
    tabs: { query: async () => [{ id: 1 }], sendMessage: async () => report },
  };
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
const shot = async (name, url, { width = 1100, height = 900, stub, full = false, prep } = {}) => {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  if (stub) await page.evaluateOnNewDocument(STUB, stub);
  await page.goto(url, { waitUntil: "networkidle0" });
  if (prep) await prep(page);
  await page.screenshot({ path: path.join(out, name), fullPage: full });
  console.log("saved", name);
  await page.close();
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await shot("1-options-first-run.png", `${base}/src/options.html`, { stub: { consentAnswered: false }, height: 1000 });
  await shot("2-options-full.png", `${base}/src/options.html`, { stub: { consentAnswered: true }, full: true,
    prep: async (p) => { await p.evaluate(() => { document.getElementById("importBox").open = true; document.querySelector("details.sent").open = true; }); } });
  await shot("3-popup.png", `${base}/src/popup.html`, { width: 270, height: 190,
    stub: { consentAnswered: true, report: { filled: ["firstName", "lastName", "email", "phone", "resume", "linkedin", "city", "state", "workAuthorized", "needsSponsorship"], skipped: ["Why do you want to work here?"] } },
    prep: async (p) => { await p.click("#fill"); await wait(200); } });
  await shot("4-workday-step1-filled.png", `${base}/test/workday.html?auto=1`, { width: 900, height: 950, prep: () => wait(1200) });
  await shot("5-workday-step2-ai.png", `${base}/test/workday.html?auto=1`, { width: 900, height: 700,
    prep: async (p) => { await wait(1200); await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => /next|continue/i.test(b.textContent))?.click()); await wait(1500); } });
  await shot("6-react-filled.png", `${base}/test/react.html?auto=1`, { width: 900, height: 900, prep: () => wait(1500) });

  // Telemetry dashboard with SAMPLE events (clearly synthetic).
  const dataDir = await mkdtemp(path.join(tmpdir(), "jaf-shot-"));
  const tel = telemetryServer({ dataDir, adminKey: "demo" });
  await new Promise((r) => tel.listen(0, r));
  const tb = `http://localhost:${tel.address().port}`;
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  const hosts = [["acme.wd5.myworkdayjobs.com", "vanilla", "workday", 14, 13, 70], ["job-boards.greenhouse.io", "react", "greenhouse", 12, 10, 1700], ["jobs.lever.co", "vanilla", "lever", 11, 9, 95], ["jobs.ashbyhq.com", "react", "ashby", 10, 9, 140]];
  const events = [];
  for (let d = 0; d < 6; d++) for (const [i, [host, framework, adapter, fields, filled, ms]] of hosts.entries()) for (let k = 0; k <= (i + d) % 3; k++) {
    events.push({ v: 1, type: "autofill_run", ts: new Date(Date.now() - d * 864e5).toISOString(), install: ids[(i + k) % 5], ext: "0.3.0", browser: "Google Chrome 157", os: "macOS",
      host, trigger: k ? "button" : "auto", framework, adapter, fields, filled: filled - (k % 2), ms: ms + k * 13,
      filledKeys: ["firstName", "email"], skipped: 2, skippedLabels: ["Are you willing to travel up to 25%?", i % 2 ? "Disability status" : "Desired start date"],
      failures: i === 2 ? [{ key: "location", kind: "combobox" }] : [], ai: { asked: 2, answered: 2 - (k % 2), latencyMs: 1200 + 300 * k, provider: "deepseek", model: "deepseek-flash", reasoning: "low" } });
  }
  await fetch(`${tb}/v1/events`, { method: "POST", body: JSON.stringify({ events: events.slice(0, 50) }) });
  await fetch(`${tb}/v1/events`, { method: "POST", body: JSON.stringify({ events: events.slice(50, 100) }) });
  await shot("7-telemetry-dashboard-sample.png", `${tb}/?key=demo`, { width: 1100, height: 1400 });
  tel.close();
} finally {
  await browser.close();
  files.close();
  ai?.close();
}
