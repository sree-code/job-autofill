// Vercel function handlers backed by Vercel Blob (private store).
// `blob` is the @vercel/blob module (injected so tests can pass a fake).
import { MAX_BODY, acceptBatch, countryFrom, aggregate, dashboard } from "./core.mjs";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };
const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "content-type": type, ...CORS });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

async function readJson(req) {
  if (req.body !== undefined && typeof req.body !== "string" && !Buffer.isBuffer(req.body)) return req.body; // already parsed by the platform
  if (typeof req.body === "string" || Buffer.isBuffer(req.body)) return JSON.parse(String(req.body));
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw Object.assign(new Error("too large"), { code: 413 }); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function loadEvents(blob, { maxFiles = 5000 } = {}) {
  const out = [];
  let cursor, files = 0;
  do {
    const page = await blob.list({ prefix: "events/", cursor, limit: 1000 });
    for (const b of page.blobs) {
      if (++files > maxFiles) return out;
      const r = await blob.get(b.pathname, { access: "private" });
      if (!r || r.statusCode !== 200 || !r.stream) continue;
      const text = await new Response(r.stream).text();
      for (const line of text.split("\n")) if (line) try { out.push(JSON.parse(line)); } catch {}
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

export function makeHandlers(blob, { adminKey = process.env.ADMIN_KEY } = {}) {
  return {
    async events(req, res) {
      try {
        if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
        if (req.method !== "POST") return send(res, 405, { error: "POST only" });
        if (Number(req.headers["content-length"] || 0) > MAX_BODY) return send(res, 413, { error: "too large" });
        let body;
        try { body = await readJson(req); } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: e.code === 413 ? "too large" : "bad json" }); }
        const { events, rejected } = acceptBatch(body, countryFrom(req.headers));
        if (events.length) {
          const day = new Date().toISOString().slice(0, 10);
          await blob.put(`events/${day}/batch.ndjson`, events.map((e) => JSON.stringify(e)).join("\n") + "\n",
            { access: "private", addRandomSuffix: true, contentType: "application/x-ndjson" });
        }
        return send(res, 200, { accepted: events.length, rejected });
      } catch (e) {
        return send(res, 500, { error: "store failed" });
      }
    },
    async stats(req, res) {
      const url = new URL(req.url, "http://x");
      if (!adminKey || url.searchParams.get("key") !== adminKey) return send(res, 401, { error: "unauthorized" });
      const stats = aggregate(await loadEvents(blob));
      if (url.searchParams.get("format") === "json") return send(res, 200, stats);
      return send(res, 200, dashboard(stats), "text/html; charset=utf-8");
    },
  };
}
