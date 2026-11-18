// Aggregate raw telemetry events into the metrics used to improve the extension.
const pct = (a, q) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
const top = (m, n = 25) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));
const inc = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);

export function aggregate(events, now = Date.now()) {
  const installs = new Set(), active7 = new Set();
  const runs = events.filter((e) => e.type === "autofill_run");
  const group = (keyFn) => {
    const g = new Map();
    for (const r of runs) {
      const k = keyFn(r) || "(none)";
      const x = g.get(k) || { runs: 0, fields: 0, filled: 0, ms: [] , installs: new Set() };
      x.runs++; x.fields += r.fields; x.filled += r.filled; x.ms.push(r.ms); x.installs.add(r.install);
      g.set(k, x);
    }
    return [...g.entries()].map(([key, x]) => ({ key, runs: x.runs, users: x.installs.size, fillRate: x.fields ? +(x.filled / x.fields).toFixed(3) : 0, avgMs: avg(x.ms), p95Ms: pct(x.ms, 0.95) }))
      .sort((a, b) => b.runs - a.runs);
  };
  const skipped = new Map(), failures = new Map(), errors = new Map(), versions = new Map(), triggers = new Map(), daily = new Map(), countries = new Map();
  const ai = { calls: 0, asked: 0, answered: 0, latency: [], errors: new Map(), models: new Map() };
  for (const e of events) {
    installs.add(e.install);
    if (now - Date.parse(e.ts) < 7 * 864e5) active7.add(e.install);
    if (e.ext) inc(versions, e.ext);
    if (e.country) inc(countries, e.country);
    if (e.type === "error") inc(errors, `${e.where}: ${e.message}`);
  }
  for (const r of runs) {
    inc(daily, r.ts.slice(0, 10));
    inc(triggers, r.trigger || "?");
    for (const l of r.skippedLabels || []) inc(skipped, l);
    for (const f of r.failures || []) inc(failures, `${f.key} (${f.kind})`);
    if (r.ai) {
      ai.calls++; ai.asked += r.ai.asked; ai.answered += r.ai.answered;
      if (r.ai.latencyMs) ai.latency.push(r.ai.latencyMs);
      if (r.ai.error) inc(ai.errors, r.ai.error);
      inc(ai.models, `${r.ai.provider}/${r.ai.model}${r.ai.reasoning ? ` (${r.ai.reasoning})` : ""}`);
    }
  }
  const msAll = runs.map((r) => r.ms);
  return {
    generatedAt: new Date(now).toISOString(),
    totals: { events: events.length, installs: installs.size, activeInstalls7d: active7.size, runs: runs.length,
      fillRate: runs.length ? +(runs.reduce((a, r) => a + r.filled, 0) / Math.max(1, runs.reduce((a, r) => a + r.fields, 0))).toFixed(3) : 0,
      avgMs: avg(msAll), p95Ms: pct(msAll, 0.95) },
    byHost: group((r) => r.host),
    byFramework: group((r) => r.framework),
    byAdapter: group((r) => r.adapter),
    ai: { calls: ai.calls, asked: ai.asked, answered: ai.answered, answerRate: ai.asked ? +(ai.answered / ai.asked).toFixed(3) : 0,
      avgLatencyMs: avg(ai.latency), p50LatencyMs: pct(ai.latency, 0.5), p95LatencyMs: pct(ai.latency, 0.95),
      models: top(ai.models), errors: top(ai.errors) },
    topUnmatchedQuestions: top(skipped, 40), // candidates for new matcher rules
    fillFailures: top(failures),              // matched but the write didn't stick
    errors: top(errors),
    versions: top(versions), triggers: top(triggers), countries: top(countries),
    dailyRuns: [...daily.entries()].sort().map(([day, runs]) => ({ day, runs })),
  };
}
