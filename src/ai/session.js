// Continuous AI answering session with memory rollover.
//
// One long-running conversation answers application questions across many
// forms, so answers stay consistent ("you said 5 years of Python on the last
// form"). When the conversation's context use crosses `contextLimit`, the
// session is summarized into durable memory and a fresh session starts with
// that memory in its system prompt.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_CONTEXT_LIMIT = 120_000; // tokens; well under the 1M window to keep calls cheap
const STATE_KEY = "aiSession";

const AnswerBatch = z.object({
  answers: z.array(
    z.object({
      id: z.string(),
      answer: z.string(), // "" when unsure; must be one of the options when options are given
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  new_facts: z.array(z.string()), // durable facts worth remembering for later forms
});

const MemorySummary = z.object({ memory: z.string() });

const SYSTEM_RULES = `You fill job application forms for the candidate described below.
For each question return the best answer for this candidate.
Rules:
- If options are listed, the answer MUST be copied exactly from the options.
- Never invent credentials, employers, degrees, dates or licenses not supported by the profile or memory. If unsure, answer "" with confidence "low".
- Keep free-text answers concise and professional (1-4 sentences unless the question asks for more).
- For EEO/self-identification questions with no profile data, choose the "decline to answer" style option if present.
- Be consistent with answers given earlier in this session and in memory.
- Put any new durable fact you relied on or established (e.g. "Answered notice period: 2 weeks") in new_facts.`;

export class AnswerSession {
  /**
   * @param {{ storage: {get(k:string):Promise<any>, set(k:string,v:any):Promise<void>},
   *           apiKey: string, model?: string, contextLimit?: number, baseURL?: string,
   *           client?: Anthropic }} opts
   */
  constructor({ storage, apiKey, model, contextLimit, baseURL, client }) {
    this.storage = storage;
    this.model = model || DEFAULT_MODEL;
    this.contextLimit = contextLimit || DEFAULT_CONTEXT_LIMIT;
    this.client =
      client ||
      new Anthropic({ apiKey, baseURL: baseURL || undefined, dangerouslyAllowBrowser: true, maxRetries: 2 });
  }

  async load() {
    const s = await this.storage.get(STATE_KEY);
    return s || { sessionNumber: 1, messages: [], memory: "", lastContextTokens: 0, rollovers: 0 };
  }

  async save(state) {
    await this.storage.set(STATE_KEY, state);
  }

  async reset({ keepMemory = true } = {}) {
    const s = await this.load();
    await this.save({ sessionNumber: s.sessionNumber + 1, messages: [], memory: keepMemory ? s.memory : "", lastContextTokens: 0, rollovers: s.rollovers });
  }

  system(profile, memory) {
    // Stable prefix first (rules + profile) so prompt caching hits across calls.
    return [
      { type: "text", text: SYSTEM_RULES },
      { type: "text", text: `CANDIDATE PROFILE (JSON):\n${JSON.stringify(profile, null, 2)}` },
      { type: "text", text: `MEMORY FROM EARLIER SESSIONS:\n${memory || "(none yet)"}`, cache_control: { type: "ephemeral" } },
    ];
  }

  /**
   * @param {Array<{id:string,label:string,type:string,options?:string[],required?:boolean}>} questions
   * @param {object} profile
   * @param {{url?:string,title?:string,company?:string}} page
   */
  async answer(questions, profile, page = {}) {
    if (!questions.length) return { answers: [], session: await this.status() };
    let state = await this.load();
    if (state.lastContextTokens >= this.contextLimit) state = await this.rollover(state, profile);

    const userText =
      `Page: ${page.title || ""} ${page.url || ""}\n` +
      `Answer these form questions. Return JSON only.\n${JSON.stringify(questions)}`;
    state.messages.push({ role: "user", content: userText });

    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(AnswerBatch) },
      system: this.system(profile, state.memory),
      messages: state.messages,
    });

    if (res.stop_reason === "refusal" || !res.parsed_output) {
      state.messages.pop(); // don't poison the session with an unanswered turn
      await this.save(state);
      return { answers: [], error: res.stop_reason === "refusal" ? "refused" : "unparsed", session: await this.status() };
    }

    // Append full content (keeps thinking blocks valid for the next turn).
    state.messages.push({ role: "assistant", content: res.content });
    const u = res.usage || {};
    state.lastContextTokens =
      (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
    if (res.parsed_output.new_facts?.length) {
      state.pendingFacts = [...(state.pendingFacts || []), ...res.parsed_output.new_facts].slice(-200);
    }
    await this.save(state);
    return { answers: res.parsed_output.answers, session: await this.status() };
  }

  // Summarize the current session into memory, then start a fresh one.
  async rollover(state, profile) {
    const transcript = state.messages
      .map((m) => {
        if (typeof m.content === "string") return `${m.role.toUpperCase()}: ${m.content}`;
        const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
        return `${m.role.toUpperCase()}: ${text}`;
      })
      .join("\n\n");

    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 8000,
      output_config: { effort: "low", format: betaZodOutputFormat(MemorySummary) },
      system: [{ type: "text", text: "MEMORY_SUMMARY task. Merge the previous memory, the new facts and the transcript into a compact memory (max ~600 words) of durable facts about the candidate and answers already given to recurring application questions (work authorization, salary, notice period, how-heard, EEO choices, custom answers). Drop page-specific noise. Never add facts not present in the inputs." }],
      messages: [{
        role: "user",
        content: `PREVIOUS MEMORY:\n${state.memory || "(none)"}\n\nNEW FACTS:\n${(state.pendingFacts || []).join("\n") || "(none)"}\n\nTRANSCRIPT:\n${transcript}`,
      }],
    });

    const memory = res.parsed_output?.memory || [state.memory, ...(state.pendingFacts || [])].filter(Boolean).join("\n");
    const next = {
      sessionNumber: state.sessionNumber + 1,
      messages: [],
      memory,
      pendingFacts: [],
      lastContextTokens: 0,
      rollovers: (state.rollovers || 0) + 1,
    };
    await this.save(next);
    return next;
  }

  async status() {
    const s = await this.load();
    return {
      sessionNumber: s.sessionNumber,
      turns: s.messages.length / 2,
      contextTokens: s.lastContextTokens,
      contextLimit: this.contextLimit,
      rollovers: s.rollovers || 0,
      memoryChars: (s.memory || "").length,
    };
  }
}
