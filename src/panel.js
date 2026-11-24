// Appliqué's in-page panel: docks to the right edge of a job application.
// Lives in a shadow root so the host page's CSS can't restyle it.
// content.js drives it through NS.panel.update(state); the panel only renders
// and reports clicks back through the handlers passed to mount().
(() => {
  const NS = (globalThis.JobAutofill ??= {});
  if (NS.panel) return;

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .wrap {
    --accent: #2C4B83; --accent-ink: #fff; --thread: #E9A93A; --ai: #5B83D0;
    --bg: rgb(250 250 252 / .86); --card: #fff; --label: #1d1d1f; --label-2: rgb(60 60 67 / .64); --label-3: rgb(60 60 67 / .32);
    --sep: rgb(60 60 67 / .18); --fill: rgb(118 118 128 / .12); --shadow: 0 0 0 .5px rgb(0 0 0 / .08), 0 24px 60px -16px rgb(20 36 66 / .38), 0 4px 14px rgb(0 0 0 / .08);
    font: 13px/1.38 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif; letter-spacing: -.006em; color: var(--label);
    -webkit-font-smoothing: antialiased;
  }
  @media (prefers-color-scheme: dark) {
    .wrap { --accent: #7FA2E3; --accent-ink: #0d1b33; --thread: #F2B84B; --ai: #8FB0EC; --bg: rgb(30 30 32 / .82); --card: rgb(255 255 255 / .06);
      --label: #f5f5f7; --label-2: rgb(235 235 245 / .62); --label-3: rgb(235 235 245 / .3); --sep: rgb(84 84 88 / .55); --fill: rgb(118 118 128 / .26);
      --shadow: 0 0 0 .5px rgb(255 255 255 / .1), 0 24px 60px -16px rgb(0 0 0 / .6); }
  }

  .panel {
    position: fixed; top: 16px; right: 16px; max-height: calc(100vh - 32px); width: 340px; z-index: 2147483646;
    display: flex; flex-direction: column; overflow: hidden; border-radius: 18px;
    background: var(--bg); box-shadow: var(--shadow);
    -webkit-backdrop-filter: saturate(180%) blur(28px); backdrop-filter: saturate(180%) blur(28px);
    transform-origin: right center; animation: in .32s cubic-bezier(.2,.8,.25,1);
  }
  @keyframes in { from { opacity: 0; transform: translateX(14px) scale(.985); } }
  .panel[hidden], .tab[hidden] { display: none; }

  header { display: flex; align-items: center; gap: 9px; padding: 14px 14px 10px 16px; }
  header .mark { width: 22px; height: 22px; flex: none; }
  header strong { font-size: 14px; font-weight: 600; letter-spacing: -.01em; }
  .icon-btn { margin-left: auto; width: 28px; height: 28px; border-radius: 14px; border: 0; background: var(--fill); color: var(--label-2); cursor: pointer; display: grid; place-items: center; }
  .icon-btn:hover { color: var(--label); }

  .job { margin: 0 12px; padding: 12px 14px; border-radius: 12px; background: var(--card); box-shadow: 0 0 0 .5px var(--sep); }
  .job .title { font-size: 15px; font-weight: 600; letter-spacing: -.012em; line-height: 1.25; }
  .job .org { margin-top: 2px; color: var(--label-2); }

  .status { padding: 16px 16px 12px; }
  /* The seam: a dashed line that gets "sewn" gold as fields are filled. */
  .seam { position: relative; height: 4px; margin-bottom: 10px; }
  .seam::before, .seam i { content: ""; position: absolute; inset: 0 auto 0 0; height: 2px; top: 1px; border-radius: 2px;
    background: repeating-linear-gradient(90deg, currentColor 0 7px, transparent 7px 11px); }
  .seam::before { right: 0; color: var(--label-3); }
  .seam i { color: var(--thread); width: 0; transition: width .35s cubic-bezier(.3,.7,.4,1); }
  .seam.busy i { animation: sew 1.1s linear infinite; background-size: 22px 2px; }
  @keyframes sew { to { background-position: 22px 0; } }
  .headline { font-size: 17px; font-weight: 600; letter-spacing: -.02em; }
  .sub { color: var(--label-2); margin-top: 1px; }
  .primary { margin-top: 12px; width: 100%; height: 38px; border: 0; border-radius: 10px; cursor: pointer;
    background: var(--accent); color: var(--accent-ink); font: 600 14px/1 inherit; font-family: inherit; }
  .primary:disabled { opacity: .45; cursor: default; }
  .primary:not(:disabled):active { transform: scale(.985); }

  .list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 12px 8px; border-top: .5px solid var(--sep); scrollbar-width: thin; }
  .list:empty { display: none; }
  .group { margin-top: 12px; }
  .group h3 { margin: 0 4px 6px; font-size: 12px; font-weight: 600; color: var(--label-2); display: flex; gap: 6px; }
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

  footer { padding: 10px 12px 12px; border-top: .5px solid var(--sep); }
  .secondary { width: 100%; height: 36px; border: 0; border-radius: 10px; cursor: pointer; background: var(--fill); color: var(--accent);
    font: 500 13.5px/1 inherit; font-family: inherit; }
  .secondary:disabled { color: var(--label-3); cursor: default; }
  .fine { margin: 8px 4px 0; color: var(--label-2); font-size: 11.5px; text-align: center; }

  .tab { position: fixed; right: 0; top: 50%; transform: translateY(-50%); z-index: 2147483646; display: flex; flex-direction: column; align-items: center; gap: 6px;
    padding: 10px 8px 10px 10px; border: 0; border-radius: 14px 0 0 14px; cursor: pointer; background: var(--bg); color: var(--label); box-shadow: var(--shadow);
    -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px); font: 600 11.5px/1 inherit; font-family: inherit; }
  .tab .mark { width: 24px; height: 24px; }

  button:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 1px; }
  @media (prefers-reduced-motion: reduce) { .panel { animation: none; } .seam i { transition: none; } .seam.busy i { animation: none; } }
  @media (max-width: 720px) { .panel { left: 12px; right: 12px; top: auto; height: 62vh; width: auto; } }
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
  const MARK_SVG = `<svg class="mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" aria-hidden="true"> <defs> <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4A6FAE"/><stop offset="1" stop-color="#1F3560"/></linearGradient> <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient> </defs> <rect width="96" height="96" rx="22" fill="url(#g)"/> <rect width="96" height="96" rx="22" fill="url(#sheen)"/> <g class="stitch"><rect x="8" y="8" width="80" height="80" rx="15" fill="none" stroke="#F2B84B" stroke-width="3" stroke-dasharray="7 5" stroke-linecap="round"/></g> <rect x="27" y="22" width="42" height="52" rx="7" fill="#fff"/> <rect x="34" y="31" width="28" height="5" rx="2.5" fill="#F2B84B"/> <rect x="34" y="41" width="20" height="5" rx="2.5" fill="#C9D3E6"/> <path d="M37 57.5l6 6 13-13" fill="none" stroke="#2C4B83" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/> </svg>`;
  // Each copy needs its own gradient ids, or a hidden copy breaks the visible one.
  let markN = 0;
  const mark = () => { const n = ++markN; return MARK_SVG.replace(/id="(g|sheen)"/g, `id="$1${n}"`).replace(/url\(#(g|sheen)\)/g, `url(#$1${n})`); };
  let host, root, els, handlers = {}, state = { phase: "idle", items: [] };

  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) k === "class" ? (n.className = v) : k.startsWith("on") ? n.addEventListener(k.slice(2), v) : n.setAttribute(k, v);
    n.append(...kids.filter((k) => k != null));
    return n;
  };

  function mount(on = {}) {
    handlers = on;
    if (host?.isConnected) return;
    host = h("div", { id: "applique-panel-host" });
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style>
      <div class="wrap">
        <button class="tab" hidden aria-label="Open Appliqué">${mark()}<span class="count"></span></button>
        <section class="panel" role="complementary" aria-label="Appliqué">
          <header>${mark()}<strong>Appliqué</strong>
            <button class="icon-btn" data-act="collapse" aria-label="Hide panel" title="Hide">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </header>
          <div class="job"><div class="title"></div><div class="org"></div></div>
          <div class="status">
            <div class="seam"><i></i></div>
            <div class="headline" role="status"></div>
            <div class="sub"></div>
            <button class="primary" data-act="fill">Fill this page</button>
          </div>
          <div class="list"></div>
          <footer>
            <button class="secondary" data-act="next">Continue to next page</button>
            <p class="fine">Appliqué never submits. You review and submit.</p>
          </footer>
        </section>
      </div>`;
    const $ = (s) => root.querySelector(s);
    els = { panel: $(".panel"), tab: $(".tab"), count: $(".count"), title: $(".job .title"), org: $(".job .org"), job: $(".job"),
      seam: $(".seam"), bar: $(".seam i"), headline: $(".headline"), sub: $(".sub"), fill: $("[data-act=fill]"), next: $("[data-act=next]"), list: $(".list") };
    $("[data-act=collapse]").addEventListener("click", () => setCollapsed(true));
    els.tab.addEventListener("click", () => setCollapsed(false));
    els.fill.addEventListener("click", () => (state.phase === "consent" ? handlers.openOptions?.() : handlers.fill?.()));
    els.next.addEventListener("click", () => handlers.next?.());
    document.documentElement.appendChild(host);
    try { chrome.storage?.local.get("panelCollapsed", (r) => setCollapsed(!!r?.panelCollapsed, false)); } catch {}
    render();
  }

  function setCollapsed(c, save = true) {
    if (!els) return;
    els.panel.hidden = c; els.tab.hidden = !c;
    if (save) try { chrome.storage?.local.set({ panelCollapsed: c }); } catch {}
  }

  function update(patch) { Object.assign(state, patch); if (els) render(); }

  function render() {
    const { phase, items = [], job, done = 0, total = 0, nextLabel, error } = state;
    els.job.hidden = !job?.title;
    els.title.textContent = job?.title || "";
    els.org.textContent = [job?.company, job?.host].filter(Boolean).join(", ");

    const counts = Object.fromEntries(GROUPS.map(([k]) => [k, 0]));
    for (const it of items) counts[it.status] = (counts[it.status] || 0) + 1;
    const filled = counts.profile + counts.ai + counts.existing;
    const need = counts.empty;
    const all = items.length - counts.yours; // boxes left for the user aren't part of "filled"
    const yours = counts.yours;

    const busy = phase === "scanning" || phase === "filling" || phase === "ai";
    els.seam.classList.toggle("busy", busy);
    const pct = phase === "filling" && total ? done / total : phase === "scanning" ? 0.04 : all ? filled / all : 0;
    els.bar.style.width = `${Math.round(Math.min(1, pct) * 100)}%`;

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

  NS.panel = { mount, update, setCollapsed, isMounted: () => !!host?.isConnected };
})();
