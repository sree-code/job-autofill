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
    const group = groupOf(el);
    if (group.some((g) => g.checked)) return false;
    const opts = group.map((g) => ({ el: g, text: (g.labels?.[0]?.textContent || g.value || "") }));
    const want = typeof value === "boolean" ? (value ? "yes" : "no") : value;
    const hit = bestOption(opts, want);
    if (!hit) return false;
    hit.el.click();
    return true;
  }

  // Custom dropdowns (react-select, MUI/Angular Material, Workday listbox buttons).
  const OPTION_SEL = "[role=option], [id*='-option-'], [class*=option]:not([class*=options])";

  function visibleOptions(input) {
    const listId = input.getAttribute("aria-controls") || input.getAttribute("aria-owns");
    const scope = (listId && document.getElementById(listId)) || document;
    return [...scope.querySelectorAll(OPTION_SEL)]
      .filter((o) => o.offsetParent !== null && !o.closest("[aria-hidden=true]"))
      .map((o) => ({ el: o, text: o.textContent }));
  }

  // rAF is paused in background tabs; race it with a timer so we never hang.
  const nextTick = () => new Promise((r) => { const t = setTimeout(r, 16); requestAnimationFrame(() => { clearTimeout(t); r(); }); });

  function openMenu(input) {
    // A full click sequence on the control: react-select opens on mousedown,
    // some wrappers (Greenhouse) on mouseup, Workday/MUI on click.
    const control = input.closest("[class*='control']");
    const target = control && control !== input ? control : input;
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      target.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, button: 0, view: window }));
    input.focus();
    // Background tabs never get a real focus event; send one so onFocus handlers run.
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  }

  function choose(opt) {
    opt.scrollIntoView({ block: "nearest" });
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
      opt.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
  }

  async function fillCombobox(el, value) {
    if (value == null || value === "") return false;
    if (hasValue(el, "combobox")) return false;
    const input = el.matches("input") ? el : el.querySelector("input") || el;
    openMenu(input);
    let typed = false, arrowed = false;
    // Poll every frame (~16ms) for up to 1.5s: options usually render within 1-2 frames.
    for (let start = performance.now(); performance.now() - start < 1500; ) {
      await nextTick();
      const opts = visibleOptions(input);
      const hit = bestOption(opts, value);
      if (hit) { choose(hit.el); return true; }
      const waited = performance.now() - start;
      // Fallback 1: keyboard open.
      if (!arrowed && !opts.length && input.matches("input") && waited > 60) {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true }));
        arrowed = true;
      }
      // Fallback 2: long/async lists (locations, schools): type to filter, once.
      if (!typed && input.matches("input") && waited > 150) {
        setNativeValue(input, String(value));
        fire(input, "input");
        typed = true;
      }
    }
    if (typed) { setNativeValue(input, ""); fire(input, "input"); } // don't leave unselected typed text behind
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

  // Radio/checkbox group: same name, or (Angular formControlName / nameless) same fieldset.
  function groupOf(el) {
    if (el.name) {
      const root = el.form || el.getRootNode() || document;
      return [...root.querySelectorAll(`input[type="${el.type}"][name="${CSS.escape(el.name)}"]`)];
    }
    const box = el.closest("fieldset, [role=radiogroup], [role=group]");
    return box ? [...box.querySelectorAll(`input[type="${el.type}"]`)] : [el];
  }
  const groupKey = (el) => el.name || (el.closest("fieldset, [role=radiogroup], [role=group]") ? groupOf(el)[0] : el);

  function hasValue(el, kind) {
    if (kind === "select") return el.selectedIndex > 0;
    if (kind === "choice") return groupOf(el).some((g) => g.checked);
    if (kind === "combobox") {
      // react-select shows the chosen value in a sibling, not the input.
      const chosen = el.closest("[class*='container']")?.querySelector("[class*='single-value'], [class*='multi-value']");
      if (chosen?.textContent.trim()) return true;
      const t = (el.matches("input") ? el.value : el.textContent ?? "").trim();
      return !!t && !/^(select|choose)/i.test(t);
    }
    return !!String(el.value ?? el.textContent ?? "").trim();
  }

  NS.filler = { hasValue, groupOf, groupKey, setNativeValue, fire, fillText, fillSelect, fillChoice, fillCombobox, fillFile, bestOption, norm, sleep };
})();
