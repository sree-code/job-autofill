// DeepSeek chat completions (OpenAI-compatible) with JSON output.
// Docs: https://api-docs.deepseek.com/guides/json_mode
// - response_format {type:"json_object"} requires the word "json" and an example in the prompt.
// - Invalid JSON comes back as blank content: retry once.
// - Thinking (reasoning) is on by default at effort "high". We default to the
//   fast setting: deepseek-flash with reasoning_effort "low". "off" disables it.
//   Docs: https://api-docs.deepseek.com/guides/thinking_mode
export const DEEPSEEK_BASE = "https://api.deepseek.com";
export const DEEPSEEK_MODEL = "deepseek-flash";
export const DEEPSEEK_REASONING = "low"; // "off" | "low" | "high" | "max"

// JSON may arrive wrapped in a ```json fence when JSON mode isn't active.
const unfence = (t) => t.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

const textOf = (content) =>
  typeof content === "string" ? content
  : Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join("\n")
  : String(content ?? "");

/**
 * @returns {Promise<{parsed: any|null, text: string, usage: object, finish: string}>}
 */
export async function deepseekJSON({ apiKey, baseURL, model, system, messages, schema, reasoning = DEEPSEEK_REASONING, maxTokens = 8000, fetchImpl = fetch }) {
  const url = `${(baseURL || DEEPSEEK_BASE).replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model: model || DEEPSEEK_MODEL,
    messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: textOf(m.content) }))],
    response_format: { type: "json_object" },
    max_tokens: maxTokens, // covers reasoning + answer
    stream: false,
  };
  if (reasoning === "off") body.thinking = { type: "disabled" };
  else { body.thinking = { type: "enabled" }; body.reasoning_effort = reasoning; }
  let last, droppedJsonMode = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // 429/5xx: one retry after a short pause; anything else is final.
      if ((res.status === 429 || res.status >= 500) && attempt === 0) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      // If JSON mode isn't accepted together with reasoning, retry without it (the prompt still asks for json).
      if (res.status === 400 && !droppedJsonMode && body.thinking.type === "enabled" && /response_format|json/i.test(detail)) {
        delete body.response_format; droppedJsonMode = true; continue;
      }
      throw new Error(`DeepSeek HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }
    const json = await res.json();
    const choice = json.choices?.[0] || {};
    const text = choice.message?.content || "";
    last = { parsed: null, text, usage: json.usage || {}, finish: choice.finish_reason || "" };
    if (!text.trim()) continue; // blank = model produced invalid JSON; retry
    try {
      const r = schema.safeParse(JSON.parse(unfence(text)));
      if (r.success) return { ...last, parsed: r.data };
    } catch {}
  }
  return last;
}
