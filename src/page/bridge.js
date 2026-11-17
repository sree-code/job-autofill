// Runs in the PAGE's main world (manifest "world": "MAIN").
// Content scripts live in an isolated world: they share the DOM but cannot see
// page globals (window.Ext, window.angular) or framework expandos on nodes
// (__reactFiber$…, __ngContext__). This bridge exposes just what the filler
// needs over DOM CustomEvents, with JSON-string payloads.
(() => {
  if (window.__jafBridge) return;
  window.__jafBridge = true;

  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const byJafId = (id) => document.querySelector(`[data-jaf-id="${CSS.escape(id)}"]`);

  function detect() {
    const out = { react: false, angular: false, angularjs: false, vue: false, ext: false, versions: {} };
    // Ext JS: a global with version info.
    if (window.Ext && (window.Ext.versions || window.Ext.version)) {
      out.ext = true;
      out.versions.ext = window.Ext.versions?.extjs?.version || window.Ext.version || "unknown";
      out.versions.extToolkit = window.Ext.isModern ? "modern" : "classic";
    }
    // AngularJS (1.x).
    if (window.angular?.version?.full) { out.angularjs = true; out.versions.angularjs = window.angular.version.full; }
    // Angular (2+): root carries ng-version; dev builds also expose window.ng.
    const ngRoot = document.querySelector("[ng-version]");
    if (ngRoot || window.getAllAngularRootElements) { out.angular = true; out.versions.angular = ngRoot?.getAttribute("ng-version") || "unknown"; }
    // Vue 3 / Vue 2.
    if (document.querySelector("[data-v-app]") || [...document.querySelectorAll("body *")].slice(0, 400).some((n) => n.__vue_app__ || n.__vue__)) {
      out.vue = true;
    }
    // React: fiber/props expandos on DOM nodes, or legacy root container.
    const sample = document.querySelectorAll("input, select, textarea, button, div");
    for (let i = 0; i < sample.length && i < 800; i++) {
      const n = sample[i];
      for (const k in n) {
        if (k.startsWith("__reactFiber$") || k.startsWith("__reactProps$") || k.startsWith("__reactInternalInstance$")) { out.react = true; break; }
      }
      if (out.react) break;
    }
    if (!out.react && (document.querySelector("[data-reactroot]") || document.getElementById("root")?._reactRootContainer)) out.react = true;
    if (out.react && window.React?.version) out.versions.react = window.React.version;
    out.primary = out.ext ? "extjs" : out.angular ? "angular" : out.angularjs ? "angularjs" : out.react ? "react" : out.vue ? "vue" : "vanilla";
    return out;
  }

  // ---------- Ext JS ----------
  function extFields() {
    const Ext = window.Ext;
    if (!Ext?.ComponentQuery) return [];
    // Only rendered, visible fields: Ext keeps internal ones (e.g. MessageBox prompt) unrendered.
    const fields = Ext.ComponentQuery.query("field").filter((f) => f.rendered && (f.isVisible ? f.isVisible(true) : !f.isHidden?.()) && !f.isDisabled?.() && !f.readOnly);
    let n = 0;
    return fields.map((f) => {
      const dom = f.inputEl?.dom || f.el?.dom;
      const id = `ext-${n++}`;
      if (dom) dom.setAttribute("data-jaf-id", id);
      f.__jafId = id;
      let options;
      const store = f.getStore?.();
      if (store?.getCount) {
        const df = f.displayField || "text";
        options = [];
        store.each((r) => { options.push(String(r.get(df))); });
      }
      const xtype = f.getXType?.() || f.xtype || "";
      const label = [f.fieldLabel, f.boxLabel, f.emptyText, f.name].filter(Boolean).join(" | ");
      return { id, label, xtype, name: f.name || "", options, isCheckbox: /checkbox|radio/.test(xtype), hasValue: !!(f.getValue?.() || f.getValue?.() === 0) && !/checkbox|radio/.test(xtype) };
    });
  }

  function extSet(id, value) {
    const Ext = window.Ext;
    const f = Ext?.ComponentQuery?.query("field").find((c) => c.__jafId === id);
    if (!f) return { ok: false, reason: "no-component" };
    const xtype = f.getXType?.() || "";
    if (/checkbox|radio/.test(xtype)) {
      const want = /^(y|yes|true|1)$/i.test(String(value)) || norm(value) === norm(f.boxLabel);
      f.setValue(want);
      return { ok: true };
    }
    const store = f.getStore?.();
    if (store?.getCount) {
      const df = f.displayField || "text", vf = f.valueField || df;
      let best = null, bestScore = 0;
      store.each((r) => {
        const a = norm(r.get(df)), b = norm(value);
        const s = a === b ? 100 : a.startsWith(b) || b.startsWith(a) ? 80 : a.includes(b) || b.includes(a) ? 60 : 0;
        if (s > bestScore) { best = r; bestScore = s; }
      });
      if (!best) return { ok: false, reason: "no-option" };
      f.setValue(best.get(vf));
      f.fireEvent?.("select", f, best);
    } else {
      f.setValue(value);
    }
    f.fireEvent?.("change", f, f.getValue());
    f.validate?.();
    return { ok: true };
  }

  // ---------- AngularJS ----------
  // ng-model listens to input/change already; this pushes the value through
  // ngModelController too, which also covers custom directives.
  function ngjsSync(id, value) {
    const el = byJafId(id);
    const ctrl = el && window.angular?.element(el).controller("ngModel");
    if (!ctrl) return { ok: false, reason: "no-ngmodel" };
    const scope = window.angular.element(el).scope();
    scope.$apply(() => ctrl.$setViewValue(value));
    ctrl.$render?.();
    return { ok: true };
  }

  const handlers = { detect, extFields, extSet, ngjsSync };

  document.addEventListener("jaf:req", (e) => {
    let req;
    try { req = JSON.parse(e.detail); } catch { return; }
    let result;
    try { result = handlers[req.op] ? handlers[req.op](...(req.args || [])) : { error: "unknown-op" }; }
    catch (err) { result = { error: String(err?.message || err) }; }
    document.dispatchEvent(new CustomEvent("jaf:res", { detail: JSON.stringify({ id: req.id, result }) }));
  });
  document.documentElement.setAttribute("data-jaf-bridge", "1");
})();
