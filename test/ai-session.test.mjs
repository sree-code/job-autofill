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

test("answers a batch with sonnet 5.5, low effort, fallbacks beta", async () => {
  const s = new AnswerSession({ storage: mem(), apiKey: "test", baseURL: "http://localhost:8799" });
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

test("session keeps history across forms, then rolls over into memory", async () => {
  const storage = mem();
  const s = new AnswerSession({ storage, apiKey: "test", baseURL: "http://localhost:8799", contextLimit: 700 });
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
