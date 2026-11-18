// Orchestrator: detect the page framework, fill known fields from the local
// profile, ask the AI session for the rest, report.
(() => {
  const NS = globalThis.JobAutofill;
  if (!NS || NS.loaded) return;
  NS.loaded = true;
  const { matcher, filler, adapters } = NS;

  // ---------- main-world bridge client ----------
  let reqSeq = 0;
  const pending = new Map();
  document.addEventListener("jaf:res", (e) => {
    try {
      const { id, result } = JSON.parse(e.detail);
      pending.get(id)?.(result);
      pending.delete(id);
    } catch {}
  });
  function bridge(op, ...args) {
    if (!document.documentElement.hasAttribute("data-jaf-bridge")) return Promise.resolve(null);
    const id = `r${++reqSeq}`;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      document.dispatchEvent(new CustomEvent("jaf:req", { detail: JSON.stringify({ id, op, args }) }));
      setTimeout(() => pending.has(id) && (pending.delete(id), resolve(null)), 1500);
    });
  }

  const getData = () => new Promise((r) => chrome.storage.local.get(["profile", "resume", "coverLetter", "settings"], r));
  const askAI = (questions) =>
    new Promise((r) => {
      try {
        chrome.runtime.sendMessage({ type: "AI_ANSWER", questions, page: { url: location.href, title: document.title } }, (res) => {
          void chrome.runtime.lastError;
          r(res || { answers: [], error: "no-response" });
        });
      } catch (e) { r({ answers: [], error: String(e) }); }
    });

  function valueFor(key, p, files) {
    if (key === "fullName") return p.fullName || [p.firstName, p.lastName].filter(Boolean).join(" ");
    if (key === "resume") return files.resume;
    if (key === "coverLetter") return files.coverLetter;
    if (key === "location") return p.location || [p.city, p.state].filter(Boolean).join(", ");
    if (key === "phoneDeviceType") return p.phoneDeviceType || "Mobile";
    return p[key];
  }

  let jafSeq = 0;
  const jafId = (el) => el.getAttribute("data-jaf-id") || (el.setAttribute("data-jaf-id", `d-${++jafSeq}`), el.getAttribute("data-jaf-id"));

  const kindOf = (el) =>
    el.type === "file" ? "file"
    : el.tagName === "SELECT" ? "select"
    : el.type === "radio" || el.type === "checkbox" ? "choice"
    : el.getAttribute("role") === "combobox" || el.getAttribute("aria-haspopup") === "listbox" ? "combobox"
    : "text";

  async function writeDom(el, kind, val, fw) {
    let ok = false;
    if (kind === "file") ok = filler.fillFile(el, val);
    else if (kind === "select") ok = filler.fillSelect(el, val);
    else if (kind === "choice") ok = filler.fillChoice(el, val);
    else if (kind === "combobox") ok = await filler.fillCombobox(el, val);
    else ok = filler.fillText(el, val);
    // AngularJS: also push through ngModelController (covers custom directives).
    // (Text only: select/radio already go through ng-model's change handler with the proper option value.)
    if (ok && fw?.angularjs && kind === "text") await bridge("ngjsSync", jafId(el), el.value);
    return ok;
  }

  function optionsOf(el, kind) {
    if (kind === "select") return [...el.options].map((o) => o.textContent.trim()).filter((t) => t && !/^select|choose|--/i.test(t));
    if (kind === "choice") return filler.groupOf(el).map((g) => (g.labels?.[0]?.textContent || g.value).trim());
    return undefined;
  }

  let running = false;
  async function autofill({ useAI = true } = {}) {
    if (running) return { filled: [], skipped: [], busy: true };
    running = true;
    const t0 = performance.now();
    try {
      const { profile = {}, resume, coverLetter, settings = {} } = await getData();
      const files = { resume, coverLetter };
      const fw = (await bridge("detect")) || { primary: "unknown" };
      const adapter = adapters.adapterFor();
      const report = { framework: fw.primary, versions: fw.versions, adapter: adapter?.name || null, filled: [], skipped: [], ai: null };
      const unknown = []; // questions for the AI: {id, label, type, options, write()}

      // 1) Ext JS: drive components, not DOM.
      const extHandled = new Set();
      if (fw.ext) {
        const fields = (await bridge("extFields")) || [];
        for (const f of fields) {
          const dom = document.querySelector(`[data-jaf-id="${CSS.escape(f.id)}"]`);
          if (dom) extHandled.add(dom);
          if (f.hasValue) continue;
          const key = matcher.classifyText(f.label);
          const val = key ? valueFor(key, profile, files) : null;
          if (key && val != null && val !== "" && key !== "resume") {
            const r = await bridge("extSet", f.id, String(val));
            if (r?.ok) { report.filled.push(key); dom?.classList.add("jaf-filled"); continue; }
          }
          unknown.push({ id: f.id, label: f.label, type: f.isCheckbox ? "checkbox" : f.options ? "select" : "text", options: f.options,
            write: async (v) => (await bridge("extSet", f.id, v))?.ok });
        }
      }

      // 2) DOM controls (React / Angular / Vue / vanilla all accept native-setter + events).
      const seenGroups = new Set();
      for (const el of matcher.collectControls()) {
        if (extHandled.has(el) || el.closest(".x-field, .x-form-item") && fw.ext) continue;
        const kind = kindOf(el);
        if (kind === "choice") {
          const g = filler.groupKey(el);
          if (seenGroups.has(g)) continue;
          seenGroups.add(g);
        }
        const key = adapters.keyFromAdapter(adapter, el) || matcher.classify(el);
        const label = matcher.describe(el);
        const val = key ? valueFor(key, profile, files) : null;
        if (key && val != null && val !== "") {
          let ok = false;
          try { ok = await writeDom(el, kind, val, fw); } catch (e) { console.warn("[job-autofill]", key, e); }
          if (ok) { report.filled.push(key); el.classList.add("jaf-filled"); continue; }
        }
        if (kind === "file" || filler.hasValue(el, kind)) continue;
        unknown.push({ id: jafId(el), label, type: kind, options: optionsOf(el, kind), required: el.required || el.getAttribute("aria-required") === "true",
          write: (v) => writeDom(el, kind, v, fw) });
      }

      // 3) AI for everything left (one batched call; session keeps memory across forms).
      if (useAI && settings.aiEnabled !== false && unknown.length) {
        const res = await askAI(unknown.map(({ write, ...q }) => q));
        report.ai = { asked: unknown.length, error: res.error || null, session: res.session || null };
        const byId = new Map(unknown.map((q) => [q.id, q]));
        for (const a of res.answers || []) {
          const q = byId.get(a.id);
          if (!q || !a.answer || a.confidence === "low") continue;
          if (await q.write(a.answer)) {
            report.filled.push(`ai:${q.label.slice(0, 40)}`);
            document.querySelector(`[data-jaf-id="${CSS.escape(q.id)}"]`)?.classList.add("jaf-filled", "jaf-ai");
            byId.delete(a.id);
          }
        }
        report.skipped.push(...[...byId.values()].map((q) => q.label));
      } else {
        report.skipped.push(...unknown.map((q) => q.label));
      }

      report.ms = Math.round(performance.now() - t0);
      toast(`Filled ${report.filled.length} field(s) · ${report.framework}` + (adapter ? ` · ${adapter.name}` : "") + ` · ${report.ms}ms`);
      console.info("[job-autofill] report", report);
      NS.lastReport = report;
      return report;
    } finally {
      running = false;
    }
  }

  function toast(msg) {
    if (window.top !== window) return;
    const t = Object.assign(document.createElement("div"), { className: "jaf-toast", textContent: msg });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  // A page "looks like an application" if it asks for identity + a resume or many profile fields.
  function looksLikeApplication() {
    const keys = new Set(matcher.collectControls().map((el) => matcher.classify(el)).filter(Boolean));
    const ext = document.querySelector(".x-form-field, .x-field");
    return (keys.has("email") && (keys.has("resume") || keys.has("firstName") || keys.has("fullName"))) || keys.size >= 4 || !!ext;
  }

  function maybeShowButton() {
    if (window.top !== window || document.querySelector(".jaf-fab") || !looksLikeApplication()) return false;
    const b = Object.assign(document.createElement("button"), { className: "jaf-fab", textContent: "Autofill", type: "button" });
    b.addEventListener("click", () => autofill());
    document.body.appendChild(b);
    return true;
  }

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg?.type === "AUTOFILL") { autofill().then(send); return true; }
  });

  // Auto-fill as soon as an application form appears (and again when multi-step
  // forms render the next step). Debounced; never submits.
  let lastSig = "", timer;
  async function scan() {
    const shown = maybeShowButton() || !!document.querySelector(".jaf-fab");
    if (!shown) return;
    const { settings = {} } = await getData();
    if (settings.autoFill === false) return;
    const sig = matcher.collectControls().map((el) => el.name || el.id || el.getAttribute("data-automation-id") || "").join("|");
    if (sig === lastSig) return;
    lastSig = sig;
    autofill();
  }
  scan();
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 300); })
    .observe(document.documentElement, { childList: true, subtree: true });

  NS.autofill = autofill;
  NS.bridge = bridge;
})();
