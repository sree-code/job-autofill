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
import { deepseekJSON, DEEPSEEK_MODEL } from "./deepseek.js";

export const DEFAULT_PROVIDER = "deepseek";
export const DEFAULT_MODELS = { deepseek: DEEPSEEK_MODEL, anthropic: "claude-sonnet-5-5" };
export const DEFAULT_MODEL = DEFAULT_MODELS.anthropic;
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

// JSON-mode providers (DeepSeek) need the shape spelled out with an example.
const JSON_SHAPES = {
  answers: `Reply with a single json object exactly like:
{"answers":[{"id":"q1","answer":"Yes","confidence":"high"},{"id":"q2","answer":"","confidence":"low"}],"new_facts":["Answered notice period: 2 weeks"]}
Include one entry in "answers" for every question id. confidence is one of "high","medium","low".`,
  memory: `Reply with a single json object exactly like: {"memory":"..."}`,
};
const MEMORY_RULES = "MEMORY_SUMMARY task. Merge the previous memory, the new facts and the transcript into a compact memory (max ~600 words) of durable facts about the candidate and answers already given to recurring application questions (work authorization, salary, notice period, how-heard, EEO choices, custom answers). Drop page-specific noise. Never add facts not present in the inputs.";

export class AnswerSession {
  /**
   * @param {{ storage: {get(k:string):Promise<any>, set(k:string,v:any):Promise<void>},
   *           apiKey: string, provider?: "deepseek"|"anthropic", model?: string,
   *           contextLimit?: number, baseURL?: string, reasoning?: string, client?: Anthropic, fetchImpl?: typeof fetch }} opts
   */
  constructor({ storage, apiKey, provider, model, contextLimit, baseURL, reasoning, client, fetchImpl }) {
    this.reasoning = reasoning || undefined; // DeepSeek: off | low | high | max
    this.storage = storage;
    this.provider = provider === "anthropic" ? "anthropic" : DEFAULT_PROVIDER;
    this.model = model || DEFAULT_MODELS[this.provider];
    this.contextLimit = contextLimit || DEFAULT_CONTEXT_LIMIT;
    this.apiKey = apiKey;
    this.baseURL = baseURL || undefined;
    this.fetchImpl = fetchImpl;
    if (this.provider === "anthropic")
      this.client = client || new Anthropic({ apiKey, baseURL: this.baseURL, dangerouslyAllowBrowser: true, maxRetries: 2 });
  }

  // One structured call, whichever provider. Returns {parsed, content, tokens, refused}.
  async callJSON({ systemBlocks, messages, schema, shape, anthropicExtras = {} }) {
    if (this.provider === "anthropic") {
      const res = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 8000,
        ...anthropicExtras,
        output_config: { effort: "low", format: betaZodOutputFormat(schema) },
        system: systemBlocks,
        messages,
      });
      const u = res.usage || {};
      return {
        parsed: res.parsed_output || null,
        content: res.content, // full content keeps any thinking blocks valid next turn
        tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0),
        refused: res.stop_reason === "refusal",
      };
    }
    const r = await deepseekJSON({
      apiKey: this.apiKey, baseURL: this.baseURL, model: this.model, schema, fetchImpl: this.fetchImpl, reasoning: this.reasoning,
      system: `${systemBlocks.map((b) => b.text).join("\n\n")}\n\n${JSON_SHAPES[shape]}`,
      messages,
    });
    const u = r?.usage || {};
    return {
      parsed: r?.parsed || null,
      content: r?.text || "",
      tokens: u.total_tokens || (u.prompt_tokens || 0) + (u.completion_tokens || 0),
      refused: r?.finish === "content_filter",
    };
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

    let res;
    try {
      res = await this.callJSON({
        systemBlocks: this.system(profile, state.memory),
        messages: state.messages,
        schema: AnswerBatch,
        shape: "answers",
        anthropicExtras: { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" },
      });
    } catch (e) {
      state.messages.pop();
      await this.save(state);
      throw e;
    }

    if (res.refused || !res.parsed) {
      state.messages.pop(); // don't poison the session with an unanswered turn
      await this.save(state);
      return { answers: [], error: res.refused ? "refused" : "unparsed", session: await this.status() };
    }

    state.messages.push({ role: "assistant", content: res.content });
    state.lastContextTokens = res.tokens;
    if (res.parsed.new_facts?.length) {
      state.pendingFacts = [...(state.pendingFacts || []), ...res.parsed.new_facts].slice(-200);
    }
    await this.save(state);
    return { answers: res.parsed.answers, session: await this.status() };
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

    const res = await this.callJSON({
      schema: MemorySummary,
      shape: "memory",
      systemBlocks: [{ type: "text", text: MEMORY_RULES }],
      messages: [{
        role: "user",
        content: `PREVIOUS MEMORY:\n${state.memory || "(none)"}\n\nNEW FACTS:\n${(state.pendingFacts || []).join("\n") || "(none)"}\n\nTRANSCRIPT:\n${transcript}`,
      }],
    });

    const memory = res.parsed?.memory || [state.memory, ...(state.pendingFacts || [])].filter(Boolean).join("\n");
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
      provider: this.provider,
      model: this.model,
      memoryChars: (s.memory || "").length,
    };
  }
}
