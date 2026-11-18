// DeepSeek chat completions (OpenAI-compatible) with JSON output.
// Docs: https://api-docs.deepseek.com/guides/json_mode
// - response_format {type:"json_object"} requires the word "json" and an example in the prompt.
// - Invalid JSON comes back as blank content: retry once.
// - Thinking is on by default; form filling doesn't need it, so it's disabled.
export const DEEPSEEK_BASE = "https://api.deepseek.com";
export const DEEPSEEK_MODEL = "deepseek-flash";

const textOf = (content) =>
  typeof content === "string" ? content
  : Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join("\n")
  : String(content ?? "");

/**
 * @returns {Promise<{parsed: any|null, text: string, usage: object, finish: string}>}
 */
export async function deepseekJSON({ apiKey, baseURL, model, system, messages, schema, maxTokens = 4000, fetchImpl = fetch }) {
  const url = `${(baseURL || DEEPSEEK_BASE).replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model: model || DEEPSEEK_MODEL,
    messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: textOf(m.content) }))],
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    max_tokens: maxTokens,
    stream: false,
  };
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // 429/5xx: one retry after a short pause; anything else is final.
      if ((res.status === 429 || res.status >= 500) && attempt === 0) { await new Promise((r) => setTimeout(r, 1000)); continue; }
      throw new Error(`DeepSeek HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }
    const json = await res.json();
    const choice = json.choices?.[0] || {};
    const text = choice.message?.content || "";
    last = { parsed: null, text, usage: json.usage || {}, finish: choice.finish_reason || "" };
    if (!text.trim()) continue; // blank = model produced invalid JSON; retry
    try {
      const r = schema.safeParse(JSON.parse(text));
      if (r.success) return { ...last, parsed: r.data };
    } catch {}
  }
  return last;
}
