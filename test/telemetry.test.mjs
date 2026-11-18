// Telemetry: opt-in only, no personal data, receiver + stats end to end.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTelemetry, sanitize } from "../src/telemetry.js";
import { createServer } from "../telemetry/server.mjs";

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { get: async (k) => structuredClone(m.get(k)), set: async (k, v) => void m.set(k, structuredClone(v)), m }; };
const run = (over = {}) => ({
  url: "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Austin/Engineer_R123/apply?token=secret",
  trigger: "auto", framework: "react", versions: { react: "18.3.1" }, adapter: "workday", fields: 12, filled: 10,
  filledKeys: ["firstName", "email"], skipped: 2, skippedLabels: ["Why Acme? Contact me at ada@example.com or 555-010-0199"],
  failures: [{ key: "location", kind: "combobox" }], ms: 63, ai: { asked: 2, answered: 1, latencyMs: 900, provider: "deepseek", model: "deepseek-flash", reasoning: "low" },
  // things that must never leave the browser:
  profile: { email: "ada@example.com" }, apiKey: "sk-secret", answers: ["I love Acme"],
  ...over,
});

test("sanitize keeps metrics, drops personal data and URL paths", () => {
  const e = sanitize("autofill_run", run());
  const s = JSON.stringify(e);
  assert.equal(e.host, "acme.wd5.myworkdayjobs.com");
  assert.doesNotMatch(s, /token=secret|R123|sk-secret|I love Acme|ada@example\.com|555-010-0199/);
  assert.match(e.skippedLabels[0], /<email>.*<num>/);
  assert.equal(e.profile, undefined);
  assert.equal(sanitize("anything_else", {}), null);
});

test("nothing is queued or sent without consent", async () => {
  const storage = mem({ settings: {} });
  let calls = 0;
  const t = createTelemetry({ storage, url: "http://x/v1/events", fetchImpl: async () => (calls++, new Response("{}")) });
  assert.equal(await t.track("autofill_run", run()), false);
  assert.equal(await t.flush(), 0);
  assert.equal(calls, 0);
  assert.equal(storage.m.get("telemetryQueue"), undefined);
});

test("opted-in events reach the receiver and show up in stats", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jaf-tel-"));
  const server = createServer({ dataDir, adminKey: "admin" });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    const storage = mem({ settings: { telemetry: true } });
    const t = createTelemetry({ storage, url: `${base}/v1/events`, version: "0.3.0" });
    await t.track("install", {});
    await t.track("autofill_run", run());
    await t.track("autofill_run", run({ url: "https://boards.greenhouse.io/x", framework: "react", adapter: "greenhouse", fields: 10, filled: 9, ms: 120, ai: null }));
    await t.track("error", { where: "autofill", message: "boom for ada@example.com", url: "https://boards.greenhouse.io/x" });
    assert.equal(await t.flush(), 4);
    assert.deepEqual(storage.m.get("telemetryQueue"), []);

    const files = await readdir(dataDir);
    const raw = await readFile(path.join(dataDir, files[0]), "utf8");
    assert.doesNotMatch(raw, /ada@example\.com|sk-secret|token=secret/);

    assert.equal((await fetch(`${base}/v1/stats`)).status, 401);
    const s = await (await fetch(`${base}/v1/stats?key=admin`)).json();
    assert.equal(s.totals.installs, 1);
    assert.equal(s.totals.runs, 2);
    assert.equal(s.totals.fillRate, +(19 / 22).toFixed(3));
    assert.equal(s.byHost[0].key, "acme.wd5.myworkdayjobs.com");
    assert.equal(s.ai.answerRate, 0.5);
    assert.equal(s.ai.models[0].key, "deepseek/deepseek-flash (low)");
    assert.equal(s.fillFailures[0].key, "location (combobox)");
    assert.match(s.topUnmatchedQuestions[0].key, /^Why Acme\?/);
    assert.match(s.errors[0].key, /<email>/);
    const html = await (await fetch(`${base}/?key=admin`)).text();
    assert.match(html, /Job sites/);
  } finally {
    server.close();
  }
});

test("receiver rejects junk and keeps events queued when unreachable", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jaf-tel-"));
  const server = createServer({ dataDir, adminKey: "a" });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    const r = await (await fetch(`${base}/v1/events`, { method: "POST", body: JSON.stringify({ events: [{ type: "autofill_run", v: 1, install: "nope" }, { type: "evil", v: 1, install: crypto.randomUUID() }] }) })).json();
    assert.deepEqual(r, { accepted: 0, rejected: 2 });
  } finally { server.close(); }
  const storage = mem({ settings: { telemetry: true } });
  const t = createTelemetry({ storage, url: "http://localhost:9/v1/events", fetchImpl: async () => new Response("", { status: 503 }) });
  await t.track("autofill_run", run());
  assert.equal(await t.flush(), 0);
  assert.equal(storage.m.get("telemetryQueue").length, 1);
});
