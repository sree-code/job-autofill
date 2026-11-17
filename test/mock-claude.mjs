// Minimal stand-in for POST /v1/messages so the real SDK path can be tested
// without an API key. Deterministic answers; usage ~= request chars / 4.
import http from "node:http";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.MOCK_PORT || 8787);
export const log = [];

function answerFor(q, profile) {
  const l = q.label.toLowerCase();
  const pick = (want) => (q.options || []).find((o) => o.toLowerCase().includes(want)) ?? want;
  if (/18|age/.test(l)) return pick("yes");
  if (/non-compete|non compete|restrictive/.test(l)) return pick("no");
  if (/why|interest|motivat/.test(l)) return `I'm excited by the team's work and my ${profile.yearsExperience || "several"} years of experience fit the role.`;
  if (/notice|start/.test(l)) return "2 weeks";
  if (/gender|race|ethnic|veteran|disab/.test(l)) return pick("decline") ?? pick("not");
  if (/terms|acknowledge|certify/.test(l)) return "Yes";
  if (/skill/.test(l)) return profile.skills || "JavaScript, React";
  return ""; // unsure
}

function reply(res, obj) {
  res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(obj));
}

export function start(port = PORT) {
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-private-network": "true" });
      return res.end();
    }
    // Test-only: serve the injectable bundle to live pages.
    if (req.method === "GET" && req.url.startsWith("/inject.js")) {
      res.writeHead(200, { "content-type": "text/javascript", "access-control-allow-origin": "*", "access-control-allow-private-network": "true", "cache-control": "no-store" });
      return res.end(readFileSync(fileURLToPath(new URL("../dist/inject.js", import.meta.url))));
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const r = JSON.parse(body || "{}");
      const sys = (r.system || []).map((b) => b.text).join("\n");
      const tokens = Math.ceil(body.length / 4);
      log.push({ model: r.model, betas: req.headers["anthropic-beta"], effort: r.output_config?.effort, tokens, summary: sys.includes("MEMORY_SUMMARY") });
      let out;
      if (sys.includes("MEMORY_SUMMARY")) {
        const user = r.messages[0].content;
        const facts = (user.match(/NEW FACTS:\n([\s\S]*?)\n\nTRANSCRIPT/) || [])[1] || "";
        out = { memory: `Summarized memory. Facts: ${facts.replace(/\n/g, "; ")}` };
      } else {
        const profile = JSON.parse((sys.match(/CANDIDATE PROFILE \(JSON\):\n([\s\S]*?)\nMEMORY FROM/) || [, "{}"])[1] || "{}");
        const last = r.messages[r.messages.length - 1].content;
        const qs = JSON.parse(last.slice(last.indexOf("[")));
        const answers = qs.map((q) => {
          const a = answerFor(q, profile);
          return { id: q.id, answer: a, confidence: a ? "high" : "low" };
        });
        out = { answers, new_facts: answers.filter((a) => a.answer).map((a) => `Answered ${a.id}: ${a.answer}`) };
      }
      reply(res, {
        id: `msg_mock_${log.length}`, type: "message", role: "assistant", model: r.model,
        content: [{ type: "text", text: JSON.stringify(out) }],
        stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: tokens, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      });
    });
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await start();
  console.log(`mock Claude API on http://localhost:${PORT}`);
}
