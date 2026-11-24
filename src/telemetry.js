// Anonymous, opt-in usage metrics (service worker side).
//
// Sent ONLY after the user accepted metrics on the options page (settings.telemetry === true).
// During the beta that acceptance is required to use the extension (see metricsGate).
// Never sent: profile values, form answers, AI answers, API keys, resume/cover
// letter, full page URLs. Sent: event type, extension version, a random install
// id, the job site's hostname, framework/adapter detected, counts, field *types*
// filled (e.g. "email"), question labels we could not match (to add rules),
// timings, and error messages. For job postings: the job site's hostname, how
// the page was recognized (signal names and score), how much text was read,
// timings, and the AI provider/model. Never the posting text or its summary.
import { TELEMETRY_URL } from "./config.js";

const QUEUE_KEY = "telemetryQueue";
const ID_KEY = "telemetryId";
const MAX_QUEUE = 500;
const BATCH = 50;

const clip = (s, n = 120) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
// Drop anything that looks like an email/phone/long number in free text (labels, errors).
const scrub = (s, n) => clip(s, n).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>").replace(/\+?\d[\d\s().-]{6,}\d/g, "<num>");

export function sanitize(type, p = {}) {
  const e = { type };
  if (type === "autofill_run") {
    Object.assign(e, {
      host: p.host ? clip(p.host, 100) : hostOf(p.url),
      trigger: clip(p.trigger, 20),
      framework: clip(p.framework, 20),
      versions: Object.fromEntries(Object.entries(p.versions || {}).slice(0, 6).map(([k, v]) => [clip(k, 20), clip(v, 30)])),
      adapter: p.adapter ? clip(p.adapter, 30) : null,
      fields: Number(p.fields) || 0,
      filled: Number(p.filled) || 0,
      filledKeys: (p.filledKeys || []).slice(0, 60).map((k) => clip(k, 40)),
      skipped: Number(p.skipped) || 0,
      skippedLabels: (p.skippedLabels || []).slice(0, 20).map((l) => scrub(l, 100)),
      failures: (p.failures || []).slice(0, 30).map((f) => ({ key: clip(f.key, 40), kind: clip(f.kind, 20) })),
      ms: Math.round(Number(p.ms) || 0),
      ai: p.ai ? {
        asked: Number(p.ai.asked) || 0, answered: Number(p.ai.answered) || 0,
        error: p.ai.error ? scrub(p.ai.error, 160) : null, latencyMs: Math.round(Number(p.ai.latencyMs) || 0),
        provider: clip(p.ai.provider, 20), model: clip(p.ai.model, 40), reasoning: clip(p.ai.reasoning, 10),
        contextTokens: Number(p.ai.contextTokens) || 0, rollovers: Number(p.ai.rollovers) || 0,
      } : null,
    });
  } else if (type === "job_page") {
    Object.assign(e, {
      host: p.host ? clip(p.host, 100) : hostOf(p.url),
      kind: clip(p.kind, 20),
      trigger: clip(p.trigger, 20),
      score: Number(p.score) || 0,
      signals: (p.signals || []).slice(0, 10).map((s) => clip(s, 24)),
      source: p.source ? clip(p.source, 12) : null,
      words: Number(p.words) || 0,
      sections: Number(p.sections) || 0,
      extractMs: Math.round(Number(p.extractMs) || 0),
      ms: Math.round(Number(p.ms) || 0),
      careerOps: p.careerOps ? clip(p.careerOps, 10) : null,
      error: p.error ? scrub(p.error, 160) : null,
      ai: p.ai ? {
        latencyMs: Math.round(Number(p.ai.latencyMs) || 0), provider: clip(p.ai.provider, 20), model: clip(p.ai.model, 40),
        error: p.ai.error ? scrub(p.ai.error, 160) : null, cached: !!p.ai.cached,
      } : null,
    });
  } else if (type === "error") {
    Object.assign(e, { where: clip(p.where, 40), message: scrub(p.message, 200), host: p.host ? clip(p.host, 100) : hostOf(p.url) });
  } else if (type === "install" || type === "update" || type === "consent") {
    Object.assign(e, { previousVersion: p.previousVersion ? clip(p.previousVersion, 20) : undefined });
  } else {
    return null; // unknown event types are dropped
  }
  return e;
}

function browserInfo() {
  const b = navigator.userAgentData?.brands?.find((x) => !/not.?a.?brand|chromium/i.test(x.brand)) || navigator.userAgentData?.brands?.[0];
  return { browser: b ? `${b.brand} ${b.version}` : clip(navigator.userAgent.match(/Chrome\/\d+/)?.[0], 30), os: clip(navigator.userAgentData?.platform || "", 20) };
}

// Beta rule: when a receiver is configured, the extension only works after the
// user accepts usage metrics (settings.telemetry === true). Forks without a
// receiver are never gated.
export function metricsGate(settings = {}, url = TELEMETRY_URL) {
  const required = !!(settings.telemetryURL || url);
  return { required, accepted: settings.telemetry === true, allowed: !required || settings.telemetry === true };
}

export function createTelemetry({ storage, fetchImpl = fetch, url = TELEMETRY_URL, version = "0" } = {}) {
  let timer = null;
  const local = storage || {
    get: (k) => chrome.storage.local.get(k).then((r) => r[k]),
    set: (k, v) => chrome.storage.local.set({ [k]: v }),
  };

  async function enabled() {
    const settings = (await local.get("settings")) || {};
    return { on: settings.telemetry === true && !!(settings.telemetryURL || url), endpoint: settings.telemetryURL || url };
  }

  async function installId() {
    let id = await local.get(ID_KEY);
    if (!id) { id = crypto.randomUUID(); await local.set(ID_KEY, id); }
    return id;
  }

  async function track(type, props) {
    const { on } = await enabled();
    if (!on) return false;
    const e = sanitize(type, props);
    if (!e) return false;
    Object.assign(e, { v: 1, ts: new Date().toISOString(), ext: version, install: await installId(), ...browserInfo() });
    const q = ((await local.get(QUEUE_KEY)) || []).concat(e).slice(-MAX_QUEUE);
    await local.set(QUEUE_KEY, q);
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch(() => {}), q.length >= 20 ? 0 : 5000);
    return true;
  }

  // Send queued events; keep them if the receiver is unreachable.
  async function flush() {
    const { on, endpoint } = await enabled();
    if (!on) return 0;
    let q = (await local.get(QUEUE_KEY)) || [];
    let sent = 0;
    while (q.length) {
      const batch = q.slice(0, BATCH);
      const res = await fetchImpl(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: batch }) });
      if (!res.ok) break;
      sent += batch.length;
      q = q.slice(batch.length);
      await local.set(QUEUE_KEY, q);
    }
    return sent;
  }

  return { track, flush, sanitize };
}
