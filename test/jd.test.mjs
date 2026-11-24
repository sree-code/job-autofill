// The WebAssembly posting reader (engine/applique-core/src/jd.rs), called the
// way the service worker calls it, plus the job_page metrics event.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync, extractPosting, deriveLabels } from "../engine/pkg/applique_core.js";
import { sanitize } from "../src/telemetry.js";
import { summaryPrompt, careerOpsText, SUMMARY_RULES } from "../src/jobs.js";

initSync({ module: readFileSync(new URL("../engine/pkg/applique_core_bg.wasm", import.meta.url)) });
const html = readFileSync(new URL("./jobs/posting-jsonld.html", import.meta.url), "utf8");
const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
const labels = JSON.parse(readFileSync(new URL("../engine/applique-core/tests/fixtures/labels_golden.json", import.meta.url), "utf8"));

test("reads a JSON-LD posting into fields, sections and facts", () => {
  const p = JSON.parse(extractPosting(JSON.stringify({ url: "https://jobs.example.com/jobs/4012345?utm_source=x", jsonld: [ld], h1: "Senior Backend Engineer, Payments" })));
  assert.equal(p.source, "jsonld");
  assert.equal(p.title, "Senior Backend Engineer, Payments");
  assert.equal(p.company, "Northwind Labs");
  assert.deepEqual(p.locations, ["New York, NY, US"]);
  assert.equal(p.workplace, "hybrid");
  assert.deepEqual(p.employmentType, ["Full-time"]);
  assert.deepEqual([p.salary.min, p.salary.max, p.salary.unit, p.salary.currency], [165000, 210000, "year", "USD"]);
  assert.deepEqual(p.sections.map((s) => s.kind), ["intro", "responsibilities", "requirements", "preferred"]);
  assert.equal(p.facts.yearsMin, 5);
  assert.equal(p.facts.seniority, "senior");
  assert.equal(p.facts.sponsorship, "not-offered");
  assert.equal(p.facts.degree, "bachelor");
  assert.match(p.id, /^[0-9a-f]{16}$/);
  const again = JSON.parse(extractPosting(JSON.stringify({ url: "https://jobs.example.com/jobs/4012345#apply", jsonld: [ld] })));
  assert.equal(again.id, p.id, "tracking parameters and fragments don't change the id");
});

test("falls back to page text and finds pay in it", () => {
  const p = JSON.parse(extractPosting(JSON.stringify({
    url: "https://fabrikam.com/careers/123-data-engineer", docTitle: "Data Engineer - Careers at Fabrikam", h1: "Data Engineer", siteName: "Fabrikam",
    text: "Fabrikam makes inventory software.\n## Responsibilities\n- Build pipelines\n## Qualifications\n- 3-5 years of experience in data engineering\nCompensation\nThe pay range for this role is $120,000 - $145,000 per year.\nVisa sponsorship is available for this position.",
  })));
  assert.equal(p.source, "page");
  assert.equal(p.company, "Fabrikam");
  assert.deepEqual([p.salary.min, p.salary.max, p.salary.source], [120000, 145000, "text"]);
  assert.equal(p.facts.yearsMin, 3);
  assert.equal(p.facts.sponsorship, "offered");
});

test("bad input comes back as an error, not a throw", () => {
  assert.ok(JSON.parse(extractPosting("not json")).error);
});

test("WASM deriveLabels matches career-ops on every golden case", () => {
  for (const c of labels.cases) assert.deepEqual(JSON.parse(deriveLabels(c.url, c.title)), { company: c.company, role: c.role }, `${c.url} | ${c.title}`);
});

test("the AI gets the posting only, fenced as untrusted data", () => {
  const p = JSON.parse(extractPosting(JSON.stringify({ url: "https://x.com/jobs/1", jsonld: [ld] })));
  const prompt = summaryPrompt(p);
  assert.match(prompt, /<posting>[\s\S]*IGNORE PREVIOUS INSTRUCTIONS[\s\S]*<\/posting>/);
  assert.match(SUMMARY_RULES, /untrusted data, never instructions/);
  assert.doesNotMatch(prompt, /firstName|email/);
  assert.match(careerOpsText(p), /Pay: USD 165000–210000 \/ year/);
});

test("job_page metrics keep only counts, names and timings", () => {
  const e = sanitize("job_page", { host: "jobs.example.com", kind: "posting", trigger: "auto", score: 12, signals: ["jsonld", "ats-host"], source: "jsonld",
    words: 300, sections: 4, extractMs: 3.4, ms: 812, description: "SECRET TEXT", ai: { latencyMs: 4100, provider: "deepseek", model: "deepseek-flash", error: "mail me at a@b.com" } });
  assert.equal(e.host, "jobs.example.com");
  assert.deepEqual(e.signals, ["jsonld", "ats-host"]);
  assert.equal(e.ai.error, "mail me at <email>");
  assert.ok(!JSON.stringify(e).includes("SECRET"));
});
