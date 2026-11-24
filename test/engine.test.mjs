// The WebAssembly build of the Rust engine, called from JavaScript the way the
// service worker calls it, agrees with career-ops' original JavaScript.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync, engineInfo, keywordCount, normalizeText, expandTerms, coverage } from "../engine/pkg/applique_core.js";

initSync({ module: readFileSync(new URL("../engine/pkg/applique_core_bg.wasm", import.meta.url)) });
const golden = JSON.parse(readFileSync(new URL("../engine/applique-core/tests/fixtures/keyword_golden.json", import.meta.url), "utf8"));

test("engine identifies itself", () => {
  const info = JSON.parse(engineInfo());
  assert.equal(info.name, "applique-core");
  assert.ok(info.modules.includes("keywords"));
});

test("WASM keyword functions match career-ops on every golden case", () => {
  for (const c of golden.cases) {
    assert.equal(normalizeText(c.text), c.normalized);
    assert.equal(keywordCount(c.term, c.text), c.keywordCount, `${c.term} in ${JSON.stringify(c.text)}`);
    assert.deepEqual(JSON.parse(expandTerms(c.term)), c.expanded);
  }
});

test("coverage splits matched and missing keywords", () => {
  const r = JSON.parse(coverage(JSON.stringify(["React", "Azure", "k8s", "LLMs"]), "React, Kubernetes and large language models"));
  assert.deepEqual(r, { matched: ["React", "k8s", "LLMs"], missing: ["Azure"], percent: 75 });
});
