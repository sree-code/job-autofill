// Appliqué's in-page panel: docks to the right edge of a job posting or an
// application. Lives in a shadow root so the host page's CSS can't restyle it.
// content.js drives it through NS.panel.update(state); the panel only renders
// and reports clicks back through the handlers passed to mount().
//
// Two views: "form" (filling an application) and "posting" (what the job is).
// Collapsed, it's a pill on the right edge: on a posting it carries the
// needle-and-thread loader while the posting is read.
(() => {
  const NS = (globalThis.JobAutofill ??= {});
  if (NS.panel) return;
  const L = () => NS.loader;
  const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
  const EASE_DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)";
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .wrap {
    --accent: #2C4B83; --accent-ink: #fff; --thread: #E9A93A; --ai: #5B83D0; --warn: #B4501E; --needle: #8E96A8;
    --bg: rgb(250 250 252 / .86); --card: #fff; --label: #1d1d1f; --label-2: rgb(60 60 67 / .64); --label-3: rgb(60 60 67 / .32);
    --sep: rgb(60 60 67 / .18); --fill: rgb(118 118 128 / .12); --shadow: 0 0 0 .5px rgb(0 0 0 / .08), 0 24px 60px -16px rgb(20 36 66 / .38), 0 4px 14px rgb(0 0 0 / .08);
    --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    font: 13px/1.38 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif; letter-spacing: -.006em; color: var(--label);
    -webkit-font-smoothing: antialiased;
  }
  @media (prefers-color-scheme: dark) {
    .wrap { --accent: #7FA2E3; --accent-ink: #0d1b33; --thread: #F2B84B; --ai: #8FB0EC; --warn: #FF9F6B; --needle: #AEB5C4; --bg: rgb(30 30 32 / .82); --card: rgb(255 255 255 / .06);
      --label: #f5f5f7; --label-2: rgb(235 235 245 / .62); --label-3: rgb(235 235 245 / .3); --sep: rgb(84 84 88 / .55); --fill: rgb(118 118 128 / .26);
      --shadow: 0 0 0 .5px rgb(255 255 255 / .1), 0 24px 60px -16px rgb(0 0 0 / .6); }
  }

  .panel {
    position: fixed; top: 16px; right: 16px; max-height: calc(100vh - 32px); width: 340px; z-index: 2147483646;
    display: flex; flex-direction: column; overflow: hidden; border-radius: 18px;
    background: var(--bg); box-shadow: var(--shadow);
    -webkit-backdrop-filter: saturate(180%) blur(28px); backdrop-filter: saturate(180%) blur(28px);
    transform-origin: right center;
  }
  .panel[hidden], .tab[hidden], [data-view][hidden], .seg[hidden] { display: none; }

  header { display: flex; align-items: center; gap: 9px; padding: 14px 14px 10px 16px; }
  header .mark { width: 22px; height: 22px; flex: none; }
  header strong { font-size: 14px; font-weight: 600; letter-spacing: -.01em; }
  .icon-btn { margin-left: auto; width: 28px; height: 28px; border-radius: 14px; border: 0; background: var(--fill); color: var(--label-2); cursor: pointer; display: grid; place-items: center; }
  .icon-btn:hover { color: var(--label); }

  /* Segmented control: only when the page is both the posting and its application. */
  .seg { display: flex; margin: 0 12px 10px; padding: 2px; border-radius: 9px; background: var(--fill); }
  .seg button { flex: 1; height: 26px; border: 0; border-radius: 7px; background: none; color: var(--label); font: 500 12.5px/1 inherit; font-family: inherit; cursor: pointer;
    transition: background-color 160ms ease, box-shadow 160ms ease; }
  .seg button[aria-pressed=true] { background: var(--card); box-shadow: 0 0 0 .5px var(--sep), 0 2px 6px rgb(0 0 0 / .08); font-weight: 600; }

  .job { margin: 0 12px; padding: 12px 14px; border-radius: 12px; background: var(--card); box-shadow: 0 0 0 .5px var(--sep); }
  .job .title { font-size: 15px; font-weight: 600; letter-spacing: -.012em; line-height: 1.25; }
  .job .org { margin-top: 2px; color: var(--label-2); }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .chips:empty { display: none; }
  .chip { padding: 3px 8px; border-radius: 999px; background: var(--fill); color: var(--label); font-size: 11.5px; line-height: 1.3; }
  .chip.money { background: color-mix(in srgb, var(--thread) 20%, transparent); }
  .chip.kw { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }

  .status { padding: 16px 16px 12px; }
  /* The seam: a dashed line that gets "sewn" gold as fields are filled. */
  .seam { position: relative; height: 4px; margin-bottom: 10px; }
  .seam::before, .seam i { content: ""; position: absolute; inset: 0; height: 2px; top: 1px; border-radius: 2px;
    background: repeating-linear-gradient(90deg, currentColor 0 7px, transparent 7px 11px); }
  .seam::before { color: var(--label-3); }
  .seam i { color: var(--thread); clip-path: inset(0 calc(100% - var(--p, 0%)) 0 0); transition: clip-path 240ms var(--ease-out); }
  .seam.busy i { animation: sew 1.1s linear infinite; background-size: 22px 2px; }
  @keyframes sew { to { background-position: 22px 0; } }
  .headline { font-size: 17px; font-weight: 600; letter-spacing: -.02em; }
  .sub { color: var(--label-2); margin-top: 1px; }
  .primary { margin-top: 12px; width: 100%; height: 38px; border: 0; border-radius: 10px; cursor: pointer;
    background: var(--accent); color: var(--accent-ink); font: 600 14px/1 inherit; font-family: inherit; transition: transform 120ms var(--ease-out); }
  .primary:disabled { opacity: .45; cursor: default; }
  .primary:not(:disabled):active { transform: scale(.97); }
  .primary[hidden] { display: none; }

  .pstatus { display: flex; align-items: center; gap: 12px; padding: 14px 16px 12px; }
  .pstatus .ldr { flex: none; width: 48px; height: 24px; }
  .pstatus .headline { font-size: 15px; }

  .list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 12px 8px; border-top: .5px solid var(--sep); scrollbar-width: thin; }
  .list:empty { display: none; }
  .group { margin-top: 12px; }
  .group h3, .pg h3 { margin: 0 4px 6px; font-size: 12px; font-weight: 600; color: var(--label-2); display: flex; gap: 6px; }
  .group h3 span { font-weight: 400; }
  .rows { background: var(--card); border-radius: 11px; box-shadow: 0 0 0 .5px var(--sep); overflow: hidden; }
  .row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 36px; padding: 8px 12px; border: 0; background: none; color: inherit;
    font: inherit; text-align: left; cursor: pointer; position: relative; }
  .row + .row::before { content: ""; position: absolute; top: 0; left: 34px; right: 0; border-top: .5px solid var(--sep); }
  .row:hover { background: var(--fill); }
  .row .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .tag { color: var(--label-2); font-size: 11.5px; flex: none; }
  .dot { flex: none; width: 12px; height: 12px; border-radius: 4px; border: 1.5px dashed var(--label-3); }
  .dot.profile { border-color: var(--thread); background: color-mix(in srgb, var(--thread) 22%, transparent); }
  .dot.ai { border-color: var(--ai); background: color-mix(in srgb, var(--ai) 22%, transparent); }
  .dot.existing { border-style: solid; border-color: var(--label-3); background: var(--fill); }
  .dot.empty { border-color: #E5484D; }
  .dot.yours { border-color: var(--label-2); }
  details.group > summary { list-style: none; cursor: pointer; }
  details.group > summary::-webkit-details-marker { display: none; }
  details.group > summary h3::after { content: "Show"; margin-left: auto; color: var(--accent); font-weight: 500; }
  details.group[open] > summary h3::after { content: "Hide"; }

  /* Posting summary */
  .pg { margin-top: 12px; }
  .pg .card { background: var(--card); border-radius: 11px; box-shadow: 0 0 0 .5px var(--sep); padding: 10px 12px; }
  .pg p { margin: 0; }
  .pg ul { margin: 0; padding: 0; list-style: none; }
  .pg li { position: relative; padding: 3px 0 3px 16px; }
  .pg li::before { content: ""; position: absolute; left: 2px; top: 10px; width: 7px; height: 2px; border-radius: 1px; background: var(--thread); }
  .pg.warn li::before { background: var(--warn); }
  .pg.warn h3 { color: var(--warn); }
  .pg dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; }
  .pg dt { color: var(--label-2); }
  .pg dd { margin: 0; }
  .pg .chips { margin-top: 0; }
  .ai-note { color: var(--ai); font-size: 11.5px; margin-top: 6px; }

  footer { padding: 10px 12px 12px; border-top: .5px solid var(--sep); }
  .secondary { width: 100%; height: 36px; border: 0; border-radius: 10px; cursor: pointer; background: var(--fill); color: var(--accent);
    font: 500 13.5px/1 inherit; font-family: inherit; }
  .secondary:disabled { color: var(--label-3); cursor: default; }
  .secondary[hidden] { display: none; }
  .fine { margin: 8px 4px 0; color: var(--label-2); font-size: 11.5px; text-align: center; }
  .fine button { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; cursor: pointer; }

  /* The pill: collapsed panel, attached to the right edge. */
  .tab { position: fixed; right: 0; top: calc(50% - 22px); z-index: 2147483646; display: flex; align-items: center; gap: 8px; height: 44px;
    padding: 0 14px 0 10px; border: 0; border-radius: 22px 0 0 22px; cursor: pointer; background: var(--bg); color: var(--label); box-shadow: var(--shadow);
    -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px); font: 600 12.5px/1 inherit; font-family: inherit; letter-spacing: -.01em;
    transition: transform 160ms ease; }
  .tab .mark { width: 26px; height: 26px; }
  .tab .ldr { width: 40px; height: 20px; }
  .tab .count:empty { display: none; }
  @media (hover: hover) and (pointer: fine) { .tab:hover { transform: translateX(-3px); } }

  button:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 1px; }
  @media (prefers-reduced-motion: reduce) { .seam i { transition: none; } .seam.busy i { animation: none; } .tab { transition: none; } }
  @media (max-width: 720px) { .panel { left: 12px; right: 12px; top: auto; bottom: 12px; height: 62vh; width: auto; transform-origin: center bottom; } }
  `;

  const GROUPS = [
    ["empty", "Needs you", ""],
    ["yours", "Left for you to decide", ""],
    ["ai", "Drafted by AI", "check these"],
    ["profile", "From your profile", ""],
    ["existing", "Already filled on the page", ""],
  ];
  const COLLAPSED_GROUPS = new Set(["profile", "existing"]);

  // The icon, inlined: an <img> of an extension URL would need web_accessible_resources.
  // The stitched patch, with a needle tucked into the top-right corner.
  const MARK_SVG = `<svg class="mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" aria-hidden="true"> <defs> <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4A6FAE"/><stop offset="1" stop-color="#1F3560"/></linearGradient> <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient> </defs> <rect width="96" height="96" rx="22" fill="url(#g)"/> <rect width="96" height="96" rx="22" fill="url(#sheen)"/> <g class="stitch"><rect x="8" y="8" width="80" height="80" rx="15" fill="none" stroke="#F2B84B" stroke-width="3" stroke-dasharray="7 5" stroke-linecap="round"/></g> <rect x="27" y="22" width="42" height="52" rx="7" fill="#fff"/> <rect x="34" y="31" width="28" height="5" rx="2.5" fill="#F2B84B"/> <rect x="34" y="41" width="20" height="5" rx="2.5" fill="#C9D3E6"/> <path d="M37 57.5l6 6 13-13" fill="none" stroke="#2C4B83" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/> <path d="M66 27c4-2 7 1 6 5" fill="none" stroke="#F2B84B" stroke-width="2.2" stroke-linecap="round"/> <path d="M62 31L82 11" stroke="#E6EAF2" stroke-width="3.6" stroke-linecap="round"/> <ellipse cx="78.6" cy="14.4" rx="1.1" ry="2.6" transform="rotate(45 78.6 14.4)" fill="#2C4B83"/> </svg>`;
  // Each copy needs its own gradient ids, or a hidden copy breaks the visible one.
  let markN = 0;
  const mark = () => { const n = ++markN; return MARK_SVG.replace(/id="(g|sheen)"/g, `id="$1${n}"`).replace(/url\(#(g|sheen)\)/g, `url(#$1${n})`); };
  const loaderSVG = () => L()?.SVG || "";

  let host, root, els, handlers = {}, collapsed = false;
  let state = { view: "form", phase: "idle", items: [], posting: null, hasForm: false };

  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) k === "class" ? (n.className = v) : k.startsWith("on") ? n.addEventListener(k.slice(2), v) : n.setAttribute(k, v);
    n.append(...kids.filter((k) => k != null && k !== false));
    return n;
  };

  /**
   * @param {{fill?,next?,focus?,openOptions?,summarize?,quiet?}} on
   * @param {{view?: "form"|"posting", collapsed?: boolean}} opts
   */
  function mount(on = {}, opts = {}) {
    Object.assign(handlers, on);
    if (host?.isConnected) return;
    if (opts.view) state.view = opts.view;
    host = h("div", { id: "applique-panel-host" });
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}${L()?.CSS || ""}</style>
      <div class="wrap">
        <button class="tab" hidden aria-label="Open Appliqué"><span class="tab-icon">${mark()}</span><span class="count"></span></button>
        <section class="panel" role="complementary" aria-label="Appliqué" hidden>
          <header>${mark()}<strong>Appliqué</strong>
            <button class="icon-btn" data-act="collapse" aria-label="Hide panel" title="Hide">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </header>
          <div class="seg" role="group" aria-label="View" hidden><button data-view-btn="posting" aria-pressed="false">Job</button><button data-view-btn="form" aria-pressed="false">Application</button></div>
          <div class="job"><div class="title"></div><div class="org"></div><div class="chips"></div></div>
          <div data-view="form">
            <div class="status">
              <div class="seam"><i></i></div>
              <div class="headline" role="status"></div>
              <div class="sub"></div>
              <button class="primary" data-act="fill">Fill this page</button>
            </div>
          </div>
          <div data-view="posting" hidden>
            <div class="pstatus">${loaderSVG()}<div><div class="headline p-headline" role="status"></div><div class="sub p-sub"></div></div></div>
          </div>
          <div class="list"></div>
          <footer>
            <div data-view="form">
              <button class="secondary" data-act="next">Continue to next page</button>
              <p class="fine">Appliqué never submits. You review and submit.</p>
            </div>
            <div data-view="posting" hidden>
              <button class="secondary" data-act="summarize" hidden>Summarize this job</button>
              <p class="fine p-fine"></p>
            </div>
          </footer>
        </section>
      </div>`;
    const $ = (s) => root.querySelector(s);
    els = { panel: $(".panel"), tab: $(".tab"), tabIcon: $(".tab-icon"), count: $(".count"), title: $(".job .title"), org: $(".job .org"), chips: $(".job .chips"), job: $(".job"),
      seg: $(".seg"), seam: $(".seam"), bar: $(".seam i"), headline: $(".status .headline"), sub: $(".status .sub"), fill: $("[data-act=fill]"), next: $("[data-act=next]"),
      list: $(".list"), views: [...root.querySelectorAll("[data-view]")], pHead: $(".p-headline"), pSub: $(".p-sub"), pFine: $(".p-fine"), summarize: $("[data-act=summarize]"),
      pLoader: $(".pstatus .ldr") };
    $("[data-act=collapse]").addEventListener("click", () => setCollapsed(true));
    els.tab.addEventListener("click", () => setCollapsed(false));
    els.fill.addEventListener("click", () => (state.phase === "consent" ? handlers.openOptions?.() : handlers.fill?.()));
    els.next.addEventListener("click", () => handlers.next?.());
    els.summarize.addEventListener("click", () => (state.posting?.phase === "consent" ? handlers.openOptions?.() : handlers.summarize?.()));
    els.pFine.addEventListener("click", (e) => { const act = e.target.closest("[data-act]")?.dataset.act; if (act === "options") handlers.openOptions?.(); if (act === "quiet") handlers.quiet?.(); });
    for (const b of root.querySelectorAll("[data-view-btn]")) b.addEventListener("click", () => update({ view: b.dataset.viewBtn }));
    document.documentElement.appendChild(host);
    render();
    if (opts.collapsed !== undefined) setCollapsed(opts.collapsed, false);
    else {
      // The form view remembers whether you hid it.
      const decide = (c) => setCollapsed(!!c, false);
      try { chrome.storage.local.get("panelCollapsed", (r) => decide(r?.panelCollapsed)); } catch { decide(false); }
    }
  }

  function unmount() {
    host?.remove();
    host = root = els = null;
    collapsed = false;
    state = { view: "form", phase: "idle", items: [], posting: null, hasForm: false };
  }

  const stopMotion = (el) => { for (const a of el.getAnimations()) a.cancel(); };

  // The pill slides in from the edge it's attached to.
  function showPill() {
    els.tab.hidden = false;
    stopMotion(els.tab);
    els.tab.animate(reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: "translateX(100%)", opacity: 0 }, { transform: "none", opacity: 1 }],
      { duration: reduced() ? 160 : 240, easing: EASE_DRAWER });
  }

  // Panel grows out of the pill's position and goes back the same way.
  function setCollapsed(c, save = true) {
    if (!els) return;
    const first = els.panel.hidden && els.tab.hidden;
    if (!first && c === collapsed) return;
    collapsed = c;
    if (save && state.view === "form") try { chrome.storage?.local.set({ panelCollapsed: c }); } catch {}
    stopMotion(els.panel);
    const hiddenPose = reduced() ? { opacity: 0 } : { opacity: 0, transform: "translateX(16px) scale(0.96)" };
    if (!c) {
      const pill = els.tab.hidden ? null : els.tab.getBoundingClientRect();
      els.tab.hidden = true;
      els.panel.hidden = false;
      if (pill && innerWidth > 720) els.panel.style.transformOrigin = `right ${Math.max(0, pill.top + pill.height / 2 - 16)}px`;
      els.panel.animate([hiddenPose, { opacity: 1, transform: "none" }], { duration: reduced() ? 160 : 280, easing: EASE_DRAWER });
    } else if (first) {
      els.panel.hidden = true;
      showPill();
    } else {
      const out = els.panel.animate([{ opacity: 1, transform: "none" }, hiddenPose], { duration: 180, easing: EASE_OUT, fill: "forwards" });
      out.finished.then(() => {
        if (!collapsed || !els) return;
        out.cancel();
        els.panel.hidden = true;
        showPill();
      }, () => {});
    }
  }

  function update(patch) {
    if (patch.posting && state.posting) patch = { ...patch, posting: { ...state.posting, ...patch.posting } };
    Object.assign(state, patch);
    if (els) render();
  }

  // ---------- formatting ----------
  const money = (s) => {
    if (!s || (!s.min && !s.max)) return "";
    const cur = s.currency || "USD";
    const fmt = (v) => {
      try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, notation: v >= 10000 ? "compact" : "standard", maximumFractionDigits: v >= 10000 ? 1 : v % 1 ? 2 : 0 }).format(v); }
      catch { return `${cur} ${v}`; }
    };
    const range = s.min && s.max && s.min !== s.max ? `${fmt(s.min)}–${fmt(s.max)}` : fmt(s.min || s.max);
    const per = { year: "/yr", hour: "/hr", month: "/mo", week: "/wk", day: "/day" }[s.unit] || "";
    return range + per;
  };
  const ago = (d) => {
    const t = Date.parse(d);
    if (!t) return "";
    const days = Math.round((Date.now() - t) / 864e5);
    return days <= 0 ? "Posted today" : days === 1 ? "Posted yesterday" : days < 60 ? `Posted ${days} days ago` : `Posted ${new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
  };
  const WORKPLACE = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
  const DEGREE = { bachelor: "Bachelor's", master: "Master's", phd: "PhD" };
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

  // ---------- render ----------
  function render() {
    const posting = state.posting;
    const hasPosting = !!posting;
    const view = state.view === "posting" && hasPosting ? "posting" : state.hasForm || !hasPosting ? "form" : "posting";
    els.seg.hidden = !(hasPosting && state.hasForm);
    for (const b of root.querySelectorAll("[data-view-btn]")) b.setAttribute("aria-pressed", String(b.dataset.viewBtn === view));
    for (const v of els.views) v.hidden = v.dataset.view !== view;
    renderJobCard(view);
    renderPill(view); // first, so a freshly inserted pill loader gets the current state below
    if (view === "posting") renderPosting(); else renderForm();
  }

  function renderJobCard(view) {
    const p = state.posting?.entry?.posting;
    const job = state.job;
    const title = p?.title || job?.title || "";
    els.job.hidden = !title;
    els.title.textContent = title;
    if (view === "posting" && p) {
      els.org.textContent = [p.company, p.locations?.[0] && (p.locations.length > 1 ? `${p.locations[0]} +${p.locations.length - 1}` : p.locations[0])].filter(Boolean).join(" · ");
      const chips = [WORKPLACE[p.workplace], ...(p.employmentType || []).slice(0, 2), money(p.salary), ago(p.datePosted)].filter(Boolean);
      els.chips.replaceChildren(...chips.map((c) => h("span", { class: `chip${c === money(p.salary) ? " money" : ""}` }, c)));
    } else {
      els.org.textContent = [p?.company || job?.company, job?.host].filter(Boolean).join(", ");
      els.chips.replaceChildren();
    }
  }

  function renderForm() {
    const { phase, items = [], done = 0, total = 0, nextLabel, error } = state;
    const counts = Object.fromEntries(GROUPS.map(([k]) => [k, 0]));
    for (const it of items) counts[it.status] = (counts[it.status] || 0) + 1;
    const filled = counts.profile + counts.ai + counts.existing;
    const need = counts.empty;
    const all = items.length - counts.yours; // boxes left for the user aren't part of "filled"
    const yours = counts.yours;

    const busy = phase === "scanning" || phase === "filling" || phase === "ai";
    els.seam.classList.toggle("busy", busy);
    const pct = phase === "filling" && total ? done / total : phase === "scanning" ? 0.04 : all ? filled / all : 0;
    els.bar.style.setProperty("--p", `${Math.round(Math.min(1, pct) * 100)}%`);

    const H = {
      idle: ["Ready to fill", "Fills this page from your profile. Nothing is submitted."],
      scanning: ["Reading the form…", "Finding the questions on this page."],
      filling: [`Filling ${done} of ${total}…`, "Using your profile."],
      ai: ["Drafting answers…", "Writing the questions your profile doesn't cover."],
      done: all || yours ? [`${filled} of ${all} filled`,
        need ? `${need} ${need === 1 ? "question needs" : "questions need"} your answer.`
          : yours ? `Everything else is filled. ${yours === 1 ? "One box is" : `${yours} boxes are`} left for you to decide.`
          : "Everything here is filled. Review it before you continue."]
        : ["Nothing to fill here", "No form fields found on this page yet."],
      consent: ["Accept the beta terms", "Appliqué fills forms once you accept usage metrics."],
    }[phase] || ["", ""];
    els.headline.textContent = H[0];
    els.sub.textContent = error ? `${H[1]} ${error}` : H[1];
    els.fill.textContent = phase === "consent" ? "Open Appliqué settings" : phase === "done" ? "Fill again" : "Fill this page";
    els.fill.disabled = busy;
    els.next.disabled = busy || !nextLabel;
    els.next.textContent = nextLabel ? `Continue: ${nextLabel}` : "Continue to next page";
    els.next.title = nextLabel ? "Clicks the page's own button to move to the next step. Never Submit." : "No next-step button found on this page.";
    els.count.textContent = all ? `${filled}/${all}` : "";

    // Checklist
    els.list.replaceChildren();
    if (phase !== "done") return;
    for (const [key, title, hint] of GROUPS) {
      const rows = items.filter((i) => i.status === key);
      if (!rows.length) continue;
      const head = h("h3", {}, title, h("span", {}, `${rows.length}${hint ? `, ${hint}` : ""}`));
      const body = h("div", { class: "rows" }, ...rows.map((it) =>
        h("button", { class: "row", type: "button", title: it.label, onclick: () => handlers.focus?.(it.id) },
          h("span", { class: `dot ${it.status}` }), h("span", { class: "lbl" }, it.label),
          it.required && (key === "empty" || key === "yours") ? h("span", { class: "tag" }, "Required") : null)));
      if (COLLAPSED_GROUPS.has(key)) els.list.append(h("details", { class: "group" }, h("summary", {}, head), body));
      else els.list.append(h("div", { class: "group" }, head, body));
    }
  }

  const POSTING_TEXT = {
    reading: ["Reading the posting…", "Pulling out the role, pay and requirements."],
    summarizing: ["Summarizing…", "Asking your AI provider for the short version."],
    done: ["Saved to your jobs", ""],
    read: ["Saved to your jobs", ""],
    manual: ["Job posting found", "Appliqué doesn't read this site on its own. Click below to read it."],
    consent: ["Accept the beta terms", "Appliqué reads postings once you accept usage metrics."],
    error: ["Couldn't read this posting", ""],
  };

  function renderPosting() {
    const ps = state.posting || {};
    const phase = ps.phase || "reading";
    const busy = phase === "reading" || phase === "summarizing";
    const [head, sub] = POSTING_TEXT[phase] || ["", ""];
    els.pHead.textContent = head;
    const by = ps.entry?.summaryBy?.split("/")[0];
    els.pSub.textContent = phase === "error" ? ps.error || "Try reloading the page."
      : (phase === "done" || phase === "read") ? (ps.entry?.summary ? `Summarized with ${by === "anthropic" ? "Claude" : "DeepSeek"}. Kept in this browser.` : ps.aiNote || "Kept in this browser.")
      : sub;
    setLoader(busy ? "busy" : phase === "error" ? "fail" : "done");

    // Footer
    const manual = phase === "manual" || phase === "consent";
    els.summarize.hidden = !(manual || (phase === "read" && ps.canSummarize));
    els.summarize.textContent = phase === "consent" ? "Open Appliqué settings" : phase === "manual" ? "Read this job" : "Summarize with AI";
    const co = ps.entry?.careerOps;
    const fine = [];
    if (co?.ok) fine.push(co.duplicate ? "Already in career-ops." : "Also saved to career-ops.");
    else if (co && !co.ok) fine.push(`career-ops: ${co.error}.`);
    els.pFine.replaceChildren(...fine.map((t) => document.createTextNode(`${t} `)),
      h("button", { type: "button", "data-act": "quiet" }, "Don't show on this site"));

    // Summary
    els.list.replaceChildren();
    const p = ps.entry?.posting;
    if (!p) return;
    const s = ps.entry.summary;
    const f = p.facts || {};
    const sec = (title, kids, cls = "") => h("div", { class: `pg ${cls}` }, h("h3", {}, title), h("div", { class: "card" }, ...kids));
    const bullets = (arr) => h("ul", {}, ...arr.map((t) => h("li", {}, t)));
    const lines = (kind, n) => (p.sections || []).filter((x) => x.kind === kind).flatMap((x) => x.lines).filter((l) => l.length < 220).slice(0, n);

    if (s?.summary) els.list.append(sec("In short", [h("p", {}, s.summary)]));
    const warn = [...(s?.red_flags || [])];
    const addWarn = (t) => t && !warn.some((w) => w.toLowerCase().includes(t.toLowerCase().slice(0, 18))) && warn.push(t);
    if (f.sponsorship === "not-offered") addWarn(s ? null : `No visa sponsorship: “${f.sponsorshipText}”`);
    if (f.clearanceText && !s) addWarn(`Clearance: “${f.clearanceText}”`);
    if (f.citizenshipText && !s) addWarn(`Citizenship: “${f.citizenshipText}”`);
    if (warn.length) els.list.append(sec("Watch out", [bullets(warn.slice(0, 6))], "warn"));

    const must = s?.must_haves?.length ? s.must_haves : lines("requirements", 8);
    if (must.length) els.list.append(sec(s ? "Must-haves" : "Requirements", [bullets(must.slice(0, 8))]));
    const nice = s?.nice_to_haves?.length ? s.nice_to_haves : lines("preferred", 6);
    if (nice.length) els.list.append(sec("Nice to have", [bullets(nice.slice(0, 6))]));
    if (s?.keywords?.length) els.list.append(sec("Keywords", [h("div", { class: "chips" }, ...s.keywords.slice(0, 20).map((k) => h("span", { class: "chip kw" }, k)))]));
    if (!s) {
      const does = lines("responsibilities", 5);
      if (does.length) els.list.append(sec("What you'd do", [bullets(does)]));
    }

    const details = [
      ["Level", cap(s?.seniority || f.seniority || "")],
      ["Experience", f.yearsMin ? `${f.yearsMin}+ years` : ""],
      ["Degree", DEGREE[f.degree] || ""],
      ["Sponsorship", s?.visa || (f.sponsorship === "offered" ? "Offered" : f.sponsorship === "not-offered" ? "Not offered" : "")],
      ["Where", s?.location_rules || (p.locations || []).slice(0, 3).join("; ")],
      ["Pay", s?.compensation || money(p.salary)],
      ["Apply by", p.validThrough ? new Date(Date.parse(p.validThrough) || 0).toLocaleDateString() : ""],
    ].filter(([, v]) => v);
    if (details.length) els.list.append(sec("Details", [h("dl", {}, ...details.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))]));
    if (s) els.list.append(h("p", { class: "ai-note" }, "AI summary of the posting. Check the original before you rely on it."));
  }

  function renderPill(view) {
    const ps = state.posting;
    if (view === "posting" && ps) {
      if (!els.tabIcon.querySelector(".ldr") && L()) els.tabIcon.innerHTML = loaderSVG();
      const label = { reading: "Reading job", summarizing: "Summarizing", done: "Job summary", read: "Job summary", manual: "Read this job", consent: "Accept terms", error: "Couldn't read" }[ps.phase] || "Job";
      els.count.textContent = label;
      els.tab.setAttribute("aria-label", `Appliqué: ${label}`);
    } else if (els.tabIcon.querySelector(".ldr")) {
      els.tabIcon.innerHTML = mark();
    }
  }

  // Both loaders (pill and panel) follow the posting's state.
  function setLoader(s) {
    const lib = L();
    if (!lib) return;
    for (const svg of root.querySelectorAll(".ldr")) {
      if (s === "busy") { if (svg.dataset.state !== "busy") lib.busy(svg); }
      else if (s === "done") lib.done(svg);
      else lib.fail(svg);
    }
  }

  NS.panel = { mount, unmount, update, setCollapsed, isMounted: () => !!host?.isConnected, state: () => state, isCollapsed: () => collapsed };
})();
