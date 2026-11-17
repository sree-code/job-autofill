// Value writers that work with React/Vue/Angular-controlled inputs.
(() => {
  const NS = (globalThis.JobAutofill ??= {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  // Frameworks track value via the prototype setter; assigning el.value directly is ignored.
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, value) : (el.value = value);
  }

  function fire(el, ...types) {
    for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true, composed: true }));
  }

  function fillText(el, value) {
    if (value == null || value === "") return false;
    if (el.isContentEditable) { el.focus(); el.textContent = value; fire(el, "input", "change", "blur"); return true; }
    if (el.value && el.value.trim()) return false; // never overwrite what the user typed
    el.focus();
    setNativeValue(el, String(value));
    fire(el, "input", "change");
    el.blur(); fire(el, "blur");
    return true;
  }

  // Score how well an option label matches the wanted answer.
  function score(optText, want) {
    const a = norm(optText), b = norm(want);
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.startsWith(b) || b.startsWith(a)) return 80;
    if (a.includes(b) || b.includes(a)) return 60;
    const aw = new Set(a.split(" ")), bw = b.split(" ");
    const hit = bw.filter((w) => aw.has(w)).length;
    return hit ? (hit / bw.length) * 50 : 0;
  }

  function bestOption(options, want) {
    let best = null, bestScore = 0;
    for (const o of options) {
      const s = score(o.text, want);
      if (s > bestScore) { best = o; bestScore = s; }
    }
    return bestScore >= 40 ? best : null;
  }

  function fillSelect(el, value) {
    if (value == null || value === "") return false;
    if (el.selectedIndex > 0) return false;
    const opts = [...el.options].map((o) => ({ el: o, text: o.textContent || o.value }));
    const hit = bestOption(opts, value);
    if (!hit) return false;
    setNativeValue(el, hit.el.value);
    fire(el, "input", "change");
    return true;
  }

  // Radio/checkbox groups: pick the option whose label best matches the answer.
  function fillChoice(el, value) {
    if (value == null || value === "") return false;
    const root = el.form || el.closest("fieldset, [role=radiogroup], [role=group]") || document;
    const group = el.name ? [...root.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)] : [el];
    if (group.some((g) => g.checked)) return false;
    const opts = group.map((g) => ({ el: g, text: (g.labels?.[0]?.textContent || g.value || "") }));
    const want = typeof value === "boolean" ? (value ? "yes" : "no") : value;
    const hit = bestOption(opts, want);
    if (!hit) return false;
    hit.el.click();
    return true;
  }

  // Custom dropdowns (react-select, Workday, Greenhouse remix): open, type, pick matching option.
  async function fillCombobox(el, value) {
    if (value == null || value === "") return false;
    const input = el.matches("input") ? el : el.querySelector("input") || el;
    input.focus();
    input.click();
    if (input.matches("input")) { setNativeValue(input, String(value)); fire(input, "input"); }
    for (let i = 0; i < 10; i++) {
      await sleep(150);
      const listId = input.getAttribute("aria-controls") || input.getAttribute("aria-owns");
      const scope = (listId && document.getElementById(listId)) || document;
      const opts = [...scope.querySelectorAll("[role=option], [class*=option]:not([class*=options])")]
        .filter((o) => o.offsetParent !== null)
        .map((o) => ({ el: o, text: o.textContent }));
      const hit = bestOption(opts, value);
      if (hit) {
        hit.el.scrollIntoView({ block: "nearest" });
        for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
          hit.el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
        return true;
      }
    }
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }

  // Attach a stored file (resume) to <input type=file> via DataTransfer.
  function fillFile(el, file) {
    if (!file?.dataUrl || el.files?.length) return false;
    const [meta, b64] = file.dataUrl.split(",");
    const mime = meta.match(/data:(.*?);/)?.[1] || "application/pdf";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file.name || "resume.pdf", { type: mime }));
    el.files = dt.files;
    fire(el, "input", "change");
    return true;
  }

  NS.filler = { setNativeValue, fire, fillText, fillSelect, fillChoice, fillCombobox, fillFile, bestOption, norm, sleep };
})();
