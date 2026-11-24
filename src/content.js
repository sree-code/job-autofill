// Orchestrator: detect the page framework, fill known fields from the local
// profile, ask the AI session for the rest, report.
(() => {
  const NS = globalThis.JobAutofill;
  if (!NS || NS.loaded) return;
  NS.loaded = true;
  const { matcher, filler, adapters } = NS;
  const panel = () => NS.panel;

  // Tick boxes that sign you up for something or make a legal statement are
  // never ticked by Appliqué, by profile or AI. They're listed for the user.
  const LEAVE_FOR_USER = /talent (community|network|pool)|newsletter|marketing|promotional|subscribe|send me|keep me (informed|updated|posted)|job alerts?|i (agree|accept|consent|certify|confirm|acknowledge|understand|attest)|terms (of|and)|privacy (policy|notice|statement)|consent|acknowledg|certif|attest|signature|e-?sign/i;

  // Short, human label for the checklist.
  function shortLabel(el) {
    const first = matcher.describe(el).split(" | ").map((t) => t.replace(/\*/g, "").replace(/\s+/g, " ").trim()).find((t) => t && !/^(yes|no|true|false|on)$/i.test(t));
    return (first || el.name || el.id || "Untitled field").slice(0, 90);
  }
  const isRequired = (el) => el.required || el.getAttribute("aria-required") === "true" || /\*/.test(matcher.describe(el).split(" | ")[0] || "");

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

  // Highlight what was filled; for radio groups, the option actually chosen.
  function markFilled(el, kind, ...extra) {
    const target = kind === "choice" ? filler.groupOf(el).find((g) => g.checked) || el : el;
    target.classList.add("jaf-filled", ...extra);
  }

  let running = false;
  const sendTelemetry = (event, props) => {
    try { chrome.runtime.sendMessage({ type: "TELEMETRY", event, props }, () => void chrome.runtime.lastError); } catch {}
  };

  // Beta: filling is locked until usage metrics are accepted on the options page.
  const gate = () => new Promise((r) => {
    try { chrome.runtime.sendMessage({ type: "GATE" }, (res) => { void chrome.runtime.lastError; r(res || {}); }); }
    catch { r({}); }
  });
  let gateNoticeShown = false;

  async function autofill({ useAI = true, trigger = "button" } = {}) {
    if (running) return { filled: [], skipped: [], busy: true };
    if ((await gate()).allowed === false) {
      if (trigger !== "auto" || !gateNoticeShown) {
        gateNoticeShown = true;
        if (panel()?.isMounted()) panel().update({ phase: "consent" });
        else toast("Accept the beta terms to start", "Open Appliqué's profile page and accept usage metrics.");
        if (trigger !== "auto") try { chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" }); } catch {}
      }
      return { filled: [], skipped: [], needsConsent: true };
    }
    running = true;
    const t0 = performance.now();
    try {
      const report = await runFill(useAI, t0);
      if (report.fields) {
        sendTelemetry("autofill_run", {
          host: location.hostname, trigger, framework: report.framework, versions: report.versions, adapter: report.adapter,
          fields: report.fields, filled: report.filled.length, filledKeys: report.filled.map((k) => (k.startsWith("ai:") ? "ai" : k)),
          skipped: report.skipped.length, skippedLabels: report.skipped, failures: report.failures, ms: report.ms,
          ai: report.ai && { ...report.ai, provider: report.ai.session?.provider, model: report.ai.session?.model,
            contextTokens: report.ai.session?.contextTokens, rollovers: report.ai.session?.rollovers },
        });
      }
      return report;
    } catch (e) {
      sendTelemetry("error", { where: "autofill", message: String(e?.message || e), host: location.hostname });
      throw e;
    } finally {
      running = false;
    }
  }

  async function runFill(useAI, t0) {
    {
      const { profile = {}, resume, coverLetter, settings = {} } = await getData();
      const files = { resume, coverLetter };
      const fw = (await bridge("detect")) || { primary: "unknown" };
      const adapter = adapters.adapterFor();
      const report = { framework: fw.primary, versions: fw.versions, adapter: adapter?.name || null, fields: 0, filled: [], skipped: [], failures: [], ai: null, items: [] };
      const item = (id, label, status, required = false) => { const it = { id, label, status, required }; report.items.push(it); return it; };
      const pendingItems = new Map(); // jaf-id -> item awaiting the AI
      const unknown = []; // questions for the AI: {id, label, type, options, write()}

      // 1) Ext JS: drive components, not DOM.
      const extHandled = new Set();
      if (fw.ext) {
        const fields = (await bridge("extFields")) || [];
        for (const f of fields) {
          report.fields++;
          const dom = document.querySelector(`[data-jaf-id="${CSS.escape(f.id)}"]`);
          if (dom) extHandled.add(dom);
          const extLabel = (f.label.split(" | ")[0] || f.name || "Field").slice(0, 90);
          if (f.hasValue) { item(f.id, extLabel, "existing"); continue; }
          const key = matcher.classifyText(f.label);
          const val = key ? valueFor(key, profile, files) : null;
          if (key && val != null && val !== "" && key !== "resume") {
            const r = await bridge("extSet", f.id, String(val));
            if (r?.ok) { report.filled.push(key); dom?.classList.add("jaf-filled"); item(f.id, extLabel, "profile"); continue; }
            report.failures.push({ key, kind: f.xtype || "ext" });
          }
          unknown.push({ id: f.id, label: f.label, type: f.isCheckbox ? "checkbox" : f.options ? "select" : "text", options: f.options,
            write: async (v) => (await bridge("extSet", f.id, v))?.ok });
          pendingItems.set(f.id, item(f.id, extLabel, "empty"));
        }
      }

      // 2) DOM controls (React / Angular / Vue / vanilla all accept native-setter + events).
      const seenGroups = new Set();
      const controls = matcher.collectControls();
      let step = 0;
      panel()?.update({ phase: "filling", done: 0, total: controls.length });
      for (const el of controls) {
        if (++step % 3 === 0) panel()?.update({ done: step });
        if (extHandled.has(el) || el.closest(".x-field, .x-form-item") && fw.ext) continue;
        const kind = kindOf(el);
        if (kind === "choice") {
          const g = filler.groupKey(el);
          if (seenGroups.has(g)) continue;
          seenGroups.add(g);
        }
        report.fields++;
        const id = jafId(el), short = shortLabel(el), required = isRequired(el);
        const label = matcher.describe(el);
        if (kind === "choice" && el.type === "checkbox" && LEAVE_FOR_USER.test(label)) {
          item(id, short, filler.hasValue(el, kind) ? "existing" : "yours", required);
          continue;
        }
        const key = adapters.keyFromAdapter(adapter, el) || matcher.classify(el);
        const val = key ? valueFor(key, profile, files) : null;
        if (key && val != null && val !== "") {
          let ok = false;
          try { ok = await writeDom(el, kind, val, fw); } catch (e) { console.warn("[job-autofill]", key, e); }
          if (ok) { report.filled.push(key); markFilled(el, kind); item(id, short, "profile", required); continue; }
          if (!filler.hasValue(el, kind)) report.failures.push({ key, kind });
        }
        if (filler.hasValue(el, kind)) { item(id, short, "existing", required); continue; }
        if (kind === "file") { item(id, short, "empty", required); continue; }
        pendingItems.set(id, item(id, short, "empty", required));
        unknown.push({ id, label, type: kind, options: optionsOf(el, kind), required: el.required || el.getAttribute("aria-required") === "true",
          write: (v) => writeDom(el, kind, v, fw) });
      }

      // 3) AI for everything left (one batched call; session keeps memory across forms).
      if (useAI && settings.aiEnabled !== false && unknown.length) {
        const ta = performance.now();
        panel()?.update({ phase: "ai" });
        const res = await askAI(unknown.map(({ write, ...q }) => q));
        report.ai = { asked: unknown.length, answered: 0, error: res.error || null, session: res.session || null,
          latencyMs: res.latencyMs ?? Math.round(performance.now() - ta), reasoning: res.reasoning };
        const byId = new Map(unknown.map((q) => [q.id, q]));
        for (const a of res.answers || []) {
          const q = byId.get(a.id);
          if (!q || !a.answer || a.confidence === "low") continue;
          if (await q.write(a.answer)) {
            report.filled.push(`ai:${q.label.slice(0, 40)}`);
            report.ai.answered++;
            const qel = document.querySelector(`[data-jaf-id="${CSS.escape(q.id)}"]`);
            if (qel) markFilled(qel, qel.type === "radio" || qel.type === "checkbox" ? "choice" : "text", "jaf-ai");
            if (pendingItems.has(q.id)) pendingItems.get(q.id).status = "ai";
            byId.delete(a.id);
          }
        }
        report.skipped.push(...[...byId.values()].map((q) => q.label));
      } else {
        report.skipped.push(...unknown.map((q) => q.label));
      }

      report.ms = Math.round(performance.now() - t0);
      // Required questions first in each group.
      report.items.sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0));
      if (panel()?.isMounted()) {
        panel().update({ phase: "done", items: report.items, nextLabel: nextButton()?.label, error: report.ai?.error ? "AI answers were unavailable." : null });
      } else {
        const n = report.filled.length, left = report.items.filter((i) => i.status === "empty").length;
        toast(n ? `Filled ${n} field${n === 1 ? "" : "s"}` : "Nothing to fill on this page",
          left ? `${left} question${left === 1 ? "" : "s"} still need${left === 1 ? "s" : ""} your answer` : "Review before you submit");
      }
      console.info("[job-autofill] report", report);
      NS.lastReport = report;
      return report;
    }
  }

  function toast(msg, detail = "") {
    if (window.top !== window) return;
    document.querySelector(".jaf-toast")?.remove();
    const t = Object.assign(document.createElement("div"), { className: "jaf-toast" });
    t.setAttribute("role", "status");
    t.append(Object.assign(document.createElement("b"), { textContent: msg }));
    if (detail) t.append(Object.assign(document.createElement("span"), { textContent: detail }));
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add("jaf-out"); setTimeout(() => t.remove(), 250); }, 4000);
  }

  // A page "looks like an application" if it asks for identity + a resume or many profile fields.
  function looksLikeApplication() {
    const keys = new Set(matcher.collectControls().map((el) => matcher.classify(el)).filter(Boolean));
    const ext = document.querySelector(".x-form-field, .x-field");
    return (keys.has("email") && (keys.has("resume") || keys.has("firstName") || keys.has("fullName"))) || keys.size >= 4 || !!ext;
  }

  // ---------- panel ----------
  // The page's own "Next"/"Continue" button. Anything that could send the
  // application (Submit, Apply, Send, Finish…) is never a candidate.
  const NEXT = /^(next|continue|save (and|&) continue|save (and|&) next|next step|proceed|go to next( step| page)?)\b/i;
  const FINAL = /submit|apply|send|finish|complete|done|review (and|&) submit|sign/i;
  function nextButton() {
    const cands = [...document.querySelectorAll("button, [role=button], input[type=submit], input[type=button], a[role=button]")]
      .filter((b) => !b.closest("#applique-panel-host") && b.getClientRects().length && !b.disabled && b.getAttribute("aria-disabled") !== "true");
    const textOf = (b) => (b.value || b.getAttribute("aria-label") || b.textContent || "").replace(/\s+/g, " ").trim();
    const auto = cands.find((b) => b.getAttribute("data-automation-id") === "bottom-navigation-next-button" || b.getAttribute("data-automation-id") === "pageFooterNextButton");
    const el = auto || cands.find((b) => { const t = textOf(b); return t.length < 40 && NEXT.test(t) && !FINAL.test(t); });
    if (!el || FINAL.test(textOf(el))) return null;
    return { el, label: textOf(el).replace(/[›»>▶→]+$/, "").trim() || "Next" };
  }

  function jobInfo() {
    const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content?.trim();
    const host = location.hostname.replace(/^www\./, "");
    const parts = host.split(".");
    const ats = /myworkdayjobs|greenhouse|lever|ashbyhq|icims|smartrecruiters|workable|jobvite|taleo|successfactors|oraclecloud/;
    const guess = ats.test(host) ? parts[0] : parts.length > 2 && /^(careers?|jobs|apply|join|work)$/.test(parts[0]) ? parts[1] : parts[parts.length - 2];
    const company = meta("og:site_name") || (guess ? guess.charAt(0).toUpperCase() + guess.slice(1) : "");
    const applyingFor = document.body.innerText.match(/applying (?:for|to)\s*[-:–]?\s*([^\n]{3,80})/i)?.[1];
    const heading = document.querySelector("h1, [data-automation-id=jobPostingHeader], .posting-headline h2, h2")?.textContent?.trim();
    const title = (applyingFor || meta("og:title") || heading || document.title.split(/[|–-]/)[0] || "").replace(/\s+/g, " ").trim().slice(0, 90);
    return { title, company, host };
  }

  function focusField(id) {
    const el = document.querySelector(`[data-jaf-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.classList.add("jaf-flash");
    setTimeout(() => el.classList.remove("jaf-flash"), 1600);
    try { el.focus({ preventScroll: true }); } catch {}
  }

  function maybeShowPanel() {
    if (window.top !== window || !NS.panel) return false;
    if (NS.panel.isMounted()) return true;
    if (!looksLikeApplication()) return false;
    NS.panel.mount({
      fill: () => autofill({ trigger: "button" }),
      next: () => {
        const n = nextButton();
        if (!n) return;
        n.el.click();
        // Steps often swap in place; look again as the next one renders.
        for (const ms of [500, 1200, 2500]) setTimeout(scan, ms);
      },
      focus: focusField,
      openOptions: () => { try { chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" }); } catch {} },
    });
    NS.panel.update({ phase: "idle", job: jobInfo(), nextLabel: nextButton()?.label });
    return true;
  }

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg?.type === "AUTOFILL") { autofill({ trigger: msg.trigger || "popup" }).then(send); return true; }
  });

  // Auto-fill as soon as an application form appears (and again when multi-step
  // forms render the next step). Debounced; never submits.
  let lastSig = "", timer;
  async function scan() {
    if (!maybeShowPanel()) return;
    if (running) return;
    const sig = matcher.collectControls().map((el) => el.name || el.id || el.getAttribute("data-automation-id") || "").join("|");
    const changed = sig !== lastSig;
    lastSig = sig;
    // A new step of a multi-page form: the old checklist no longer applies.
    panel()?.update(changed ? { phase: "idle", items: [], job: jobInfo(), nextLabel: nextButton()?.label } : { nextLabel: nextButton()?.label });
    if (!changed) return;
    const { settings = {} } = await getData();
    if (settings.autoFill === false) return;
    autofill({ trigger: "auto" });
  }
  scan();
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 300); })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "style", "aria-hidden"] });

  NS.autofill = autofill;
  NS.bridge = bridge;
})();
