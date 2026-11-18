// Shared receiver logic (local server and Vercel functions).
import { sanitize } from "../src/telemetry.js";
export { aggregate } from "./stats.mjs";

export const MAX_BODY = 256 * 1024, MAX_EVENTS = 50;
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


// Validate a POST body; returns the events to store.
export function acceptBatch(body, country) {
  const raw = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS) : [];
  const events = raw.map((e) => clean(e, country)).filter(Boolean);
  return { events, rejected: raw.length - events.length };
}

export const countryFrom = (headers) => headers["x-vercel-ip-country"] || headers["cf-ipcountry"] || headers["x-country"];

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

