// Orchestrator: find fields, resolve values from the local profile, fill, report.
(() => {
  const NS = globalThis.JobAutofill;
  if (!NS || NS.loaded) return;
  NS.loaded = true;
  const { matcher, filler, adapters } = NS;

  const getProfile = () => new Promise((r) => chrome.storage.local.get(["profile", "resume", "coverLetter"], r));

  function valueFor(key, p, files) {
    if (key === "fullName") return p.fullName || [p.firstName, p.lastName].filter(Boolean).join(" ");
    if (key === "resume") return files.resume;
    if (key === "coverLetter") return files.coverLetter;
    if (key === "location") return p.location || [p.city, p.state].filter(Boolean).join(", ");
    return p[key];
  }

  async function autofill() {
    const { profile = {}, resume, coverLetter } = await getProfile();
    const files = { resume, coverLetter };
    const adapter = adapters.adapterFor();
    const controls = matcher.collectControls();
    const seenGroups = new Set();
    const report = { filled: [], skipped: [] };

    for (const el of controls) {
      if ((el.type === "radio" || el.type === "checkbox") && el.name) {
        if (seenGroups.has(el.name)) continue;
        seenGroups.add(el.name);
      }
      const key = adapters.keyFromAdapter(adapter, el) || matcher.classify(el);
      const label = matcher.describe(el);
      if (!key) { report.skipped.push(label); continue; }
      const val = valueFor(key, profile, files);
      let ok = false;
      try {
        if (el.type === "file") ok = filler.fillFile(el, val);
        else if (el.tagName === "SELECT") ok = filler.fillSelect(el, val);
        else if (el.type === "radio" || el.type === "checkbox") ok = filler.fillChoice(el, val);
        else if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-haspopup") === "listbox") ok = await filler.fillCombobox(el, val);
        else ok = filler.fillText(el, val);
      } catch (e) { console.warn("[job-autofill]", key, e); }
      if (ok) { report.filled.push(key); el.classList.add("jaf-filled"); }
      else report.skipped.push(`${key}: ${label}`);
    }
    toast(`Filled ${report.filled.length} field(s)` + (adapter ? ` · ${adapter.name}` : ""));
    console.info("[job-autofill] report", report);
    return report;
  }

  function toast(msg) {
    if (window.top !== window) return;
    const t = Object.assign(document.createElement("div"), { className: "jaf-toast", textContent: msg });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // Floating button only on pages that look like an application form.
  function maybeShowButton() {
    if (window.top !== window || document.querySelector(".jaf-fab")) return;
    const n = matcher.collectControls().filter((el) => matcher.classify(el)).length;
    if (n < 3) return;
    const b = Object.assign(document.createElement("button"), { className: "jaf-fab", textContent: "Autofill", type: "button" });
    b.addEventListener("click", autofill);
    document.body.appendChild(b);
  }

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg?.type === "AUTOFILL") { autofill().then(send); return true; }
  });

  maybeShowButton();
  // Multi-step forms (Workday etc.) render new fields later.
  let timer;
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(maybeShowButton, 800); })
    .observe(document.documentElement, { childList: true, subtree: true });

  NS.autofill = autofill;
})();
