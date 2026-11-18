// Telemetry receiver for Job Autofill (self-hosted). Zero dependencies.
//   POST /v1/events        {events:[...]}  (from the extension; re-sanitized here)
//   GET  /v1/stats?key=K   aggregated metrics JSON
//   GET  /?key=K           dashboard
//   GET  /healthz
// Env: PORT (8790), DATA_DIR (./telemetry-data), ADMIN_KEY (required for stats).
// Stores one NDJSON file per day. Client IPs are not stored; a coarse country
// is kept only if a proxy/CDN header provides it. For Vercel see telemetry/vercel/.
import http from "node:http";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MAX_BODY, acceptBatch, countryFrom, aggregate, dashboard } from "./core.mjs";
export { clean, dashboard } from "./core.mjs";

async function loadAll(dir) {
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".ndjson")); } catch { return []; }
  const out = [];
  for (const f of files.sort()) for (const line of (await readFile(path.join(dir, f), "utf8")).split("\n")) if (line) try { out.push(JSON.parse(line)); } catch {}
  return out;
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
        const { events, rejected } = acceptBatch(body, countryFrom(req.headers));
        if (events.length) {
          await mkdir(dataDir, { recursive: true });
          await appendFile(path.join(dataDir, `${new Date().toISOString().slice(0, 10)}.ndjson`), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
        }
        return json(200, { accepted: events.length, rejected });
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
