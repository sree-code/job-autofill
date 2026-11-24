// Is this page a job? Runs in the content script, on this machine only, and
// sends nothing anywhere. Scored signals (docs/PIPELINE_PLAN.md, section 3):
//   JobPosting structured data (JSON-LD or microdata)  +6
//   host is an applicant-tracking system               +4
//   URL looks like one job                             +2
//   an Apply button plus 2+ job section headings       +4
//   several JobPostings, or 10+ job links              −6  (a list of jobs)
// 6 points makes a posting. An application form is decided by content.js.
(() => {
  const NS = (globalThis.JobAutofill ??= {});
  if (NS.detect) return;

  const THRESHOLD = 6;

  // Hosts that only serve jobs. Seeded from career-ops' providers/.
  const ATS_HOSTS = [
    /(^|\.)myworkdayjobs\.com$/, /(^|\.)myworkdaysite\.com$/, /(^|\.)greenhouse\.io$/, /(^|\.)lever\.co$/, /(^|\.)ashbyhq\.com$/,
    /(^|\.)icims\.com$/, /(^|\.)smartrecruiters\.com$/, /(^|\.)workable\.com$/, /(^|\.)jobvite\.com$/, /(^|\.)taleo\.net$/,
    /(^|\.)successfactors\.(com|eu)$/, /(^|\.)teamtailor\.com$/, /(^|\.)breezy\.hr$/, /(^|\.)recruitee\.com$/, /(^|\.)dayforcehcm\.com$/,
    /(^|\.)phenompeople\.com$/, /(^|\.)ultipro\.com$/, /(^|\.)applytojob\.com$/, /(^|\.)pinpointhq\.com$/, /^ats\.rippling\.com$/,
    /^jobs\.gem\.com$/, /(^|\.)eightfold\.ai$/, /(^|\.)jazzhr\.com$/, /(^|\.)personio\.(de|com)$/, /(^|\.)bamboohr\.com$/,
    /(^|\.)oraclecloud\.com$/, /(^|\.)paylocity\.com$/, /(^|\.)adp\.com$/,
  ];
  // Hosts that serve other things too: only counted with a matching path.
  const ATS_PATHS = [[/(^|\.)oraclecloud\.com$/, /\/hcmUI\//i], [/(^|\.)bamboohr\.com$/, /\/careers/i], [/(^|\.)paylocity\.com$/, /\/Recruiting/i], [/(^|\.)adp\.com$/, /recruitment|careers|jobs/i]];

  const JOB_URL = /\/(jobs?|careers?|positions?|openings?|vacanc(y|ies)|requisitions?|postings?|roles?)\/(?!search\b|results\b|list\b|all\b)[^/?#]*\d|\/job\/[^/?#]+|\/jobs\/(?!search\b|results\b)[\w-]{8,}|\/positions\/[^/?#]+|\/(careers?|jobs?|roles?|openings?)\/(?!search\b)[a-z0-9]+(-[a-z0-9]+){2,}\/?$|\/apply\b|[?&](gh_jid|jobid|job_id|jobseqno|jid|reqid|requisitionid|jobreqid|ats_job_id)=/i;
  const APPLY_TEXT = /^(apply|apply now|apply for this (job|position|role)|apply to this (job|position|role)|apply on company site|i'?m interested|start (your )?application|easy apply|submit (an )?application)$/i;
  const SECTION_RE = /responsibilit|requirement|qualification|what you('|’)ll (do|bring)|what you will (do|bring)|what we('|’)re looking for|who you are|about the role|about you|nice to have|preferred|benefits|what we offer|duties|your role|the role|about the job|minimum qualifications|basic qualifications/i;

  const text = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
  const visible = (el) => el.getClientRects().length > 0;

  function isAtsHost(host = location.hostname, path = location.pathname) {
    const h = host.toLowerCase();
    if (!ATS_HOSTS.some((re) => re.test(h))) return false;
    const gated = ATS_PATHS.find(([re]) => re.test(h));
    return gated ? gated[1].test(path) : true;
  }

  // Count JobPosting nodes in JSON-LD (inside arrays, @graph or nested), and
  // keep the raw blocks for the engine.
  function jsonld(doc = document) {
    const blocks = [];
    let count = 0;
    const isPosting = (t) => (Array.isArray(t) ? t : [t]).some((x) => typeof x === "string" && /JobPosting$/.test(x));
    const walk = (v, depth) => {
      if (!v || typeof v !== "object" || depth > 8) return;
      if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
      if (isPosting(v["@type"])) { count++; return; }
      for (const [k, x] of Object.entries(v)) if (k !== "description") walk(x, depth + 1);
    };
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      const raw = s.textContent || "";
      if (raw.length > 400_000) continue;
      blocks.push(raw);
      try { walk(JSON.parse(raw.trim().replace(/^<!--|-->$/g, "")), 0); }
      catch { try { walk(JSON.parse(raw.replace(/[\n\r\t]/g, " ")), 0); } catch {} }
    }
    return { count, blocks };
  }

  function applyButton(doc = document) {
    for (const el of doc.querySelectorAll("a, button, [role=button], input[type=submit], input[type=button]")) {
      const t = (el.value || el.getAttribute("aria-label") || text(el)).slice(0, 60);
      if (APPLY_TEXT.test(t.trim()) && visible(el)) return el;
    }
    return null;
  }

  function sectionHeadings(doc = document) {
    let n = 0;
    const seen = new Set();
    const cands = doc.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading], strong, b, dt");
    for (let i = 0; i < cands.length && i < 600; i++) {
      const t = text(cands[i]);
      if (t.length > 60 || !SECTION_RE.test(t)) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      n++;
    }
    return n;
  }

  // Distinct links that look like individual jobs: many of them means a list.
  function jobLinks(doc = document) {
    const seen = new Set();
    for (const a of doc.querySelectorAll("a[href]")) {
      const href = a.href.split("#")[0];
      if (href === location.href.split("#")[0]) continue;
      if (JOB_URL.test(href) && !/\/apply\b/i.test(href)) seen.add(href);
      if (seen.size >= 30) break;
    }
    return seen.size;
  }

  /**
   * @returns {{score:number, isPosting:boolean, isList:boolean, signals:string[], postings:number, blocks:string[]}}
   */
  function run(doc = document) {
    const signals = [];
    let score = 0;
    const add = (n, why) => { score += n; signals.push(why); };
    const ld = jsonld(doc);
    const micro = doc.querySelectorAll('[itemtype*="schema.org/JobPosting" i]').length;
    const postings = ld.count || micro;
    if (postings === 1) add(6, ld.count ? "jsonld" : "microdata");
    if (postings > 1) add(-6, "many-postings");
    if (isAtsHost()) add(4, "ats-host");
    if (JOB_URL.test(location.pathname + location.search)) add(2, "job-url");
    const headings = sectionHeadings(doc);
    if (applyButton(doc) && headings >= 2) add(4, "apply+sections");
    else if (headings >= 3) add(1, "sections");
    const links = jobLinks(doc);
    if (links >= 10 && postings !== 1) add(-6, "job-links");
    return { score, isPosting: score >= THRESHOLD, isList: postings > 1 || links >= 10, signals, postings, blocks: ld.blocks };
  }

  NS.detect = { run, isAtsHost, jsonld, THRESHOLD, JOB_URL };
})();
