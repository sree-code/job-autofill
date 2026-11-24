// Gathers the raw material of a job posting from the page for the engine
// (engine/applique-core/src/jd.rs): JSON-LD blocks, microdata, the heading and
// the main text with headings and bullets marked. Reads only; changes nothing.
(() => {
  const NS = (globalThis.JobAutofill ??= {});
  if (NS.jd) return;

  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "NAV", "FORM", "BUTTON", "SELECT", "TEXTAREA", "INPUT", "IFRAME", "CANVAS", "VIDEO", "AUDIO", "DIALOG"]);
  const BLOCK = /^(P|DIV|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ASIDE|UL|OL|DL|DD|DT|TABLE|TR|TD|TH|BLOCKQUOTE|PRE|FIGURE|FIGCAPTION|HR|H[1-6]|LI|BR)$/;
  const SECTION_RE = /responsibilit|requirement|qualification|what you('|’)ll (do|bring)|what you will (do|bring)|who you are|about the role|about you|nice to have|preferred|benefits|what we offer|duties|about the job|the role/i;
  const MAX = 60_000;

  const meta = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content?.trim() || "";
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

  // Text of a subtree, one paragraph per line, "## " headings, "- " list items.
  function structuredText(root) {
    const out = [];
    let line = "";
    let len = 0;
    const flush = () => {
      const t = line.replace(/\s+/g, " ").trim();
      if (t && t !== "-" && t !== "##") { out.push(t); len += t.length; }
      line = "";
    };
    const walk = (node) => {
      if (len > MAX) return;
      if (node.nodeType === 3) { line += node.nodeValue; return; }
      if (node.nodeType !== 1) return;
      const el = node;
      if (SKIP.has(el.tagName) || el.hidden || el.getAttribute("aria-hidden") === "true" || el.id === "applique-panel-host") return;
      const block = BLOCK.test(el.tagName);
      if (block && !el.getClientRects().length && el.tagName !== "BR") return; // display:none
      if (el.tagName === "BR") { flush(); return; }
      if (block) flush();
      if (/^H[1-6]$/.test(el.tagName) || el.getAttribute("role") === "heading") line += "## ";
      else if (el.tagName === "LI") line += "- ";
      // A paragraph that is only a bold phrase reads as a heading: "<p><b>Requirements</b></p>".
      else if ((el.tagName === "STRONG" || el.tagName === "B") && !line.trim() && clean(el.textContent).length < 60 && SECTION_RE.test(el.textContent)) line += "## ";
      for (const c of el.childNodes) walk(c);
      if (block) flush();
    };
    walk(root);
    flush();
    return out.join("\n");
  }

  // The element holding the posting: the smallest one containing two or more
  // job section headings and real text; else <main>/<article>; else <body>.
  function mainContainer() {
    const known = document.querySelector("[data-automation-id=jobPostingDescription], .job__description, #content .job-post, .posting-page, .iCIMS_JobContent, [data-ui=job-description], .job-sections, .ashby-job-posting-right-pane, [class*=jobDescription], [class*=job-description], #job-description");
    if (known && clean(known.innerText).length > 300) return known;
    const heads = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading], strong, b")].filter((h) => clean(h.textContent).length < 60 && SECTION_RE.test(h.textContent)).slice(0, 12);
    if (heads.length >= 2) {
      let node = heads[0].parentElement;
      while (node && node !== document.body) {
        const inside = heads.filter((h) => node.contains(h)).length;
        if (inside >= Math.min(heads.length, 3) && clean(node.innerText).length > 400) return node;
        node = node.parentElement;
      }
    }
    return document.querySelector("main, [role=main], article") || document.body;
  }

  // Microdata (itemscope/itemprop) → the same shape as JSON-LD.
  function microdata() {
    const root = document.querySelector('[itemtype*="schema.org/JobPosting" i]');
    if (!root) return null;
    const read = (scope) => {
      const obj = { "@type": (scope.getAttribute("itemtype") || "").split("/").pop() };
      const props = [...scope.querySelectorAll("[itemprop]")].filter((p) => p.parentElement.closest("[itemscope]") === scope);
      for (const p of props) {
        const name = p.getAttribute("itemprop");
        let val;
        if (p.hasAttribute("itemscope")) val = read(p);
        else if (name === "description") val = p.innerHTML;
        else val = p.getAttribute("content") || p.getAttribute("datetime") || p.getAttribute("href") || clean(p.textContent);
        obj[name] = obj[name] === undefined ? val : [].concat(obj[name], val);
      }
      return obj;
    };
    return read(root);
  }

  /** The raw page input for the engine's `extractPosting`. */
  function collect(blocks = NS.detect?.jsonld().blocks || []) {
    const h1 = document.querySelector("h1, [data-automation-id=jobPostingHeader], .posting-headline h2");
    return {
      url: location.href,
      canonical: document.querySelector('link[rel="canonical"]')?.href || "",
      docTitle: document.title,
      h1: clean(h1?.textContent).slice(0, 200),
      ogTitle: meta("og:title"),
      siteName: meta("og:site_name"),
      jsonld: blocks,
      microdata: microdata(),
      text: structuredText(mainContainer()).slice(0, MAX),
    };
  }

  NS.jd = { collect, structuredText, mainContainer };
})();
