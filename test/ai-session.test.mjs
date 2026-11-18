// Node tests for the AI session: batching, persistence, and memory rollover.
import test from "node:test";
import assert from "node:assert/strict";
import { start, log } from "./mock-claude.mjs";
import { AnswerSession } from "../src/ai/session.js";

const server = await start(8799);
test.after(() => server.close());

const mem = () => {
  const m = new Map();
  return { get: async (k) => structuredClone(m.get(k)), set: async (k, v) => void m.set(k, structuredClone(v)), m };
};
const profile = { firstName: "Ada", yearsExperience: "6", skills: "TypeScript, React" };
const qs = (n) => [
  { id: `q${n}a`, label: "Are you at least 18 years of age?", type: "select", options: ["Yes", "No"] },
  { id: `q${n}b`, label: "Why do you want to work here?", type: "text" },
  { id: `q${n}c`, label: "Favourite colour of the office carpet", type: "text" },
];

test("anthropic: answers a batch with sonnet 5.5, low effort, fallbacks beta", async () => {
  const s = new AnswerSession({ storage: mem(), apiKey: "test", provider: "anthropic", baseURL: "http://localhost:8799" });
  const r = await s.answer(qs(1), profile);
  assert.equal(r.answers.length, 3);
  assert.equal(r.answers.find((a) => a.id === "q1a").answer, "Yes");
  assert.match(r.answers.find((a) => a.id === "q1b").answer, /6 years/);
  assert.equal(r.answers.find((a) => a.id === "q1c").confidence, "low");
  const call = log.at(-1);
  assert.equal(call.model, "claude-sonnet-5-5");
  assert.equal(call.effort, "low");
  assert.match(call.betas, /server-side-fallback-2026-07-01/);
  assert.equal(r.session.turns, 1);
});

test("anthropic: session keeps history across forms, then rolls over into memory", async () => {
  const storage = mem();
  const s = new AnswerSession({ storage, apiKey: "test", provider: "anthropic", baseURL: "http://localhost:8799", contextLimit: 700 });
  let r;
  for (let i = 1; i <= 6; i++) r = await s.answer(qs(i), profile, { url: `https://example.test/job/${i}` });
  const st = storage.m.get("aiSession");
  assert.ok(st.rollovers >= 1, "should have rolled over at least once");
  assert.ok(st.sessionNumber >= 2);
  assert.match(st.memory, /Summarized memory/);
  assert.match(st.memory, /Answered q\d+a: Yes/, "facts from the old session carried into memory");
  assert.ok(log.some((c) => c.summary), "a MEMORY_SUMMARY call was made");
  // New session starts small and its system prompt carries the memory.
  assert.ok(r.session.turns < 6);
});

test("reset keeps or clears memory", async () => {
  const storage = mem();
  const s = new AnswerSession({ storage, apiKey: "test", baseURL: "http://localhost:8799", contextLimit: 900 });
  for (let i = 1; i <= 4; i++) await s.answer(qs(i), profile);
  await s.reset({ keepMemory: true });
  assert.ok(storage.m.get("aiSession").memory.length > 0);
  assert.equal(storage.m.get("aiSession").messages.length, 0);
  await s.reset({ keepMemory: false });
  assert.equal(storage.m.get("aiSession").memory, "");
});

test("deepseek is the default: flash, JSON mode, fast reasoning, bearer auth", async () => {
  const s = new AnswerSession({ storage: mem(), apiKey: "ds-test", baseURL: "http://localhost:8799" });
  const r = await s.answer(qs(1), profile);
  assert.equal(r.error, undefined);
  assert.equal(r.answers.find((a) => a.id === "q1a").answer, "Yes");
  assert.match(r.answers.find((a) => a.id === "q1b").answer, /6 years/);
  assert.equal(r.answers.find((a) => a.id === "q1c").confidence, "low");
  const call = log.at(-1);
  assert.equal(call.provider, "deepseek");
  assert.equal(call.model, "deepseek-flash");
  assert.equal(call.responseFormat, "json_object");
  assert.equal(call.thinking, "enabled");
  assert.equal(call.reasoningEffort, "low");
  assert.equal(call.auth, "Bearer ds-test");
  assert.equal(r.session.provider, "deepseek");
  assert.equal(r.session.turns, 1);
});

test("deepseek: session history, rollover into memory", async () => {
  const storage = mem();
  const s = new AnswerSession({ storage, apiKey: "ds-test", baseURL: "http://localhost:8799", contextLimit: 700 });
  let r;
  for (let i = 1; i <= 6; i++) r = await s.answer(qs(i), profile, { url: `https://example.test/job/${i}` });
  const st = storage.m.get("aiSession");
  assert.ok(st.rollovers >= 1);
  assert.match(st.memory, /Answered q\d+a: Yes/);
  assert.ok(log.some((c) => c.summary && c.provider === "deepseek"));
  assert.ok(r.session.turns < 6);
});

test("deepseek: blank (invalid-JSON) reply is retried once", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    const content = calls === 1 ? "   " : JSON.stringify({ answers: [{ id: "x", answer: "Yes", confidence: "high" }], new_facts: [] });
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { total_tokens: 10 } }), { status: 200 });
  };
  const s = new AnswerSession({ storage: mem(), apiKey: "k", fetchImpl });
  const r = await s.answer([{ id: "x", label: "18+?", type: "text" }], profile);
  assert.equal(calls, 2);
  assert.equal(r.answers[0].answer, "Yes");
});

test("deepseek: HTTP error surfaces and leaves session clean", async () => {
  const storage = mem();
  const fetchImpl = async () => new Response('{"error":{"message":"Authentication Fails"}}', { status: 401 });
  const s = new AnswerSession({ storage, apiKey: "bad", fetchImpl });
  await assert.rejects(s.answer(qs(1), profile), /DeepSeek HTTP 401/);
  assert.equal(storage.m.get("aiSession").messages.length, 0);
});

test("deepseek: reasoning off disables thinking", async () => {
  const s = new AnswerSession({ storage: mem(), apiKey: "k", baseURL: "http://localhost:8799", reasoning: "off" });
  await s.answer(qs(1), profile);
  assert.equal(log.at(-1).thinking, "disabled");
  assert.equal(log.at(-1).reasoningEffort, undefined);
});

test("deepseek: if JSON mode is rejected with reasoning, retry without it and parse fenced json", async () => {
  const bodies = [];
  const fetchImpl = async (_u, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    if (b.response_format) return new Response('{"error":{"message":"response_format is not supported in thinking mode"}}', { status: 400 });
    const content = "```json\n" + JSON.stringify({ answers: [{ id: "x", answer: "Yes", confidence: "high" }], new_facts: [] }) + "\n```";
    return new Response(JSON.stringify({ choices: [{ message: { content, reasoning_content: "..." }, finish_reason: "stop" }], usage: { total_tokens: 10 } }));
  };
  const s = new AnswerSession({ storage: mem(), apiKey: "k", fetchImpl });
  const r = await s.answer([{ id: "x", label: "18+?", type: "text" }], profile);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].response_format, undefined);
  assert.equal(r.answers[0].answer, "Yes");
});
