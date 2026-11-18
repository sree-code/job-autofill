// Telemetry receiver for Job Autofill. Zero dependencies.
//   POST /v1/events        {events:[...]}  (from the extension; re-sanitized here)
//   GET  /v1/stats?key=K   aggregated metrics JSON
//   GET  /?key=K           dashboard
//   GET  /healthz
// Env: PORT (8790), DATA_DIR (./telemetry-data), ADMIN_KEY (required for stats).
// Stores one NDJSON file per day. Client IPs are not stored; a coarse country
// is kept only if a proxy/CDN header provides it.
import http from "node:http";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sanitize } from "../src/telemetry.js";
import { aggregate } from "./stats.mjs";

const MAX_BODY = 256 * 1024, MAX_EVENTS = 50;
const clip = (s, n) => String(s ?? "").slice(0, n);
const UUID = /^[0-9a-f-]{36}$/i;

export function clean(raw, country) {
  if (!raw || raw.v !== 1 || !UUID.test(raw.install || "")) return null;
  const e = sanitize(raw.type, raw);
  if (!e) return null;
  const ts = Date.parse(raw.ts);
  return { ...e, v: 1, ts: new Date(Number.isFinite(ts) ? Math.min(ts, Date.now()) : Date.now()).toISOString(), received: new Date().toISOString(),
    install: raw.install, ext: clip(raw.ext, 20), browser: clip(raw.browser, 40), os: clip(raw.os, 20), ...(country ? { country: clip(country, 2) } : {}) };
}

async function loadAll(dir) {
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".ndjson")); } catch { return []; }
  const out = [];
  for (const f of files.sort()) for (const line of (await readFile(path.join(dir, f), "utf8")).split("\n")) if (line) try { out.push(JSON.parse(line)); } catch {}
  return out;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function table(title, rows, cols) {
  if (!rows?.length) return `<h2>${title}</h2><p class=muted>No data yet.</p>`;
  return `<h2>${title}</h2><table><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c] ?? "")}</td>`).join("")}</tr>`).join("")}</table>`;
}
export function dashboard(s) {
  const t = s.totals, a = s.ai;
  const card = (k, v) => `<div class=card><div class=v>${esc(v)}</div><div class=k>${k}</div></div>`;
  return `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Job Autofill telemetry</title>
<style>:root{color-scheme:light dark}body{font:14px system-ui;max-width:1100px;margin:24px auto;padding:0 16px}.cards{display:flex;flex-wrap:wrap;gap:10px}.card{border:1px solid #8884;border-radius:10px;padding:10px 14px;min-width:120px}.v{font-size:22px;font-weight:700}.k,.muted{color:#888;font-size:12px}table{border-collapse:collapse;width:100%;margin-bottom:8px}td,th{border-bottom:1px solid #8883;padding:5px 8px;text-align:left;font-size:13px}h2{font-size:15px;margin-top:26px}</style>
<h1>Job Autofill telemetry</h1><p class=muted>Generated ${esc(s.generatedAt)}</p>
<div class=cards>${card("installs", t.installs)}${card("active 7d", t.activeInstalls7d)}${card("autofill runs", t.runs)}${card("fill rate", `${Math.round(t.fillRate * 100)}%`)}${card("avg fill ms", t.avgMs)}${card("p95 fill ms", t.p95Ms)}${card("AI answer rate", `${Math.round(a.answerRate * 100)}%`)}${card("AI p50 / p95 ms", `${a.p50LatencyMs} / ${a.p95LatencyMs}`)}</div>
${table("Job sites", s.byHost, ["key", "runs", "users", "fillRate", "avgMs", "p95Ms"])}
${table("Frameworks", s.byFramework, ["key", "runs", "users", "fillRate", "avgMs", "p95Ms"])}
${table("ATS adapters", s.byAdapter, ["key", "runs", "users", "fillRate", "avgMs", "p95Ms"])}
${table("Top unmatched questions (add matcher rules)", s.topUnmatchedQuestions, ["key", "count"])}
${table("Fill failures (matched, write didn't stick)", s.fillFailures, ["key", "count"])}
${table("AI models", a.models, ["key", "count"])}${table("AI errors", a.errors, ["key", "count"])}
${table("Errors", s.errors, ["key", "count"])}${table("Versions", s.versions, ["key", "count"])}${table("Triggers", s.triggers, ["key", "count"])}
${table("Countries", s.countries, ["key", "count"])}${table("Runs per day", s.dailyRuns, ["day", "runs"])}`;
}

export function createServer({ dataDir = process.env.DATA_DIR || "telemetry-data", adminKey = process.env.ADMIN_KEY } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };
    const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json", ...cors }); res.end(JSON.stringify(obj)); };
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
      if (req.url === "/healthz") return json(200, { ok: true });
      if (req.method === "POST" && url.pathname === "/v1/events") {
        let size = 0; const chunks = [];
        for await (const c of req) { size += c.length; if (size > MAX_BODY) return json(413, { error: "too large" }); chunks.push(c); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json(400, { error: "bad json" }); }
        const raw = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS) : [];
        const country = req.headers["x-vercel-ip-country"] || req.headers["cf-ipcountry"] || req.headers["x-country"];
        const events = raw.map((e) => clean(e, country)).filter(Boolean);
        if (events.length) {
          await mkdir(dataDir, { recursive: true });
          await appendFile(path.join(dataDir, `${new Date().toISOString().slice(0, 10)}.ndjson`), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
        }
        return json(200, { accepted: events.length, rejected: raw.length - events.length });
      }
      if (req.method === "GET" && (url.pathname === "/v1/stats" || url.pathname === "/")) {
        if (!adminKey || url.searchParams.get("key") !== adminKey) return json(401, { error: "set ADMIN_KEY and pass ?key=" });
        const stats = aggregate(await loadAll(dataDir));
        if (url.pathname === "/v1/stats") return json(200, stats);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(dashboard(stats));
      }
      json(404, { error: "not found" });
    } catch (e) {
      json(500, { error: String(e?.message || e) });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8790);
  if (!process.env.ADMIN_KEY) console.warn("ADMIN_KEY not set: /v1/stats and the dashboard are locked.");
  createServer().listen(port, () => console.log(`telemetry receiver on http://localhost:${port}`));
}
