// Loads the Rust engine (engine/pkg, built from engine/applique-core) once, on
// first use. Service workers can't use top-level await, so init is lazy.
import init, * as core from "../engine/pkg/applique_core.js";

let ready;
export function engine() {
  ready ??= init({ module_or_path: chrome.runtime.getURL("dist/engine/applique_core_bg.wasm") }).then(() => core);
  return ready;
}

// Message API for content scripts and extension pages.
export async function handleEngine(msg) {
  const e = await engine();
  switch (msg.op) {
    case "info": return JSON.parse(e.engineInfo());
    case "coverage": return JSON.parse(e.coverage(JSON.stringify(msg.keywords || []), String(msg.text || "")));
    case "keywordCount": return { count: e.keywordCount(String(msg.keyword || ""), String(msg.text || "")) };
    default: return { error: `unknown engine op: ${msg.op}` };
  }
}
