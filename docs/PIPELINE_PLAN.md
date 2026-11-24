# Appliqué pipeline plan

Status: revision 2 (2026-11-23). Phases 0 and 1 done (2026-11-24); Phases 2–8 not started.

**Revision 2:**
- career-ops' scoring and keyword logic gets ported into a **Rust engine** (`applique-core`), instead of calling career-ops at run time.
- Resumes are handled as **DOCX first**, with a PDF download.
- At sign-up we extract the original resume's fonts, headings and structure, and every later edit follows them.
- A PDF someone uploads is rebuilt once as a DOCX that matches it.

The goal: when you open a job, Appliqué notices it on its own, reads and summarizes the posting, scores your fit, offers to tailor your resume without breaking its layout, then fills every page of the application and stops at Review with a summary. You click Submit.

## Phase 0 results (2026-11-24)

| Item | Result |
|---|---|
| Rust | Installed with rustup: rustc 1.100.0, `wasm32-unknown-unknown` target, `wasm-bindgen` 0.2.100 |
| Engine | `engine/applique-core` created. The first module, `keywords`, is a port of career-ops' `normalizeText` / `countOccurrences` / `variantForms` / `expandTerms` / `keywordCount` + synonyms, plus `coverage()` |
| Same answers as career-ops | **328/328** golden cases generated from the original JavaScript match, in Rust (`cargo test`) and through WebAssembly (`npm test`) |
| Runs in the extension | Yes. Loaded in Chrome's MV3 service worker with `'wasm-unsafe-eval'`; the first call including WASM start-up took **39 ms**. Engine WASM: **113 KB** |
| Typst WASM (in-extension PDF) | **28.3 MB** raw, **10.7 MB** compressed (`@myriaddreamin/typst-ts-web-compiler` 0.7.0, Apache-2.0). Chrome extensions must ship code inside the package (no downloading code later), so this would make the extension about 11 MB larger. **Lighter alternative for Phase 6:** our own small renderer in `applique-core` using Typst's low-level `pdf-writer` crate + `ttf-parser`/`rustybuzz` for fonts. That's under 1 MB, enough for resume layouts (paragraphs, bullets, tabs, columns, tables), and we decide after Phase 4 shows what real resumes need |
| Motion skills | `animate`, `apple-design`, `choreograph`, `animation-performance` from emilkowalski/skills (MIT) installed in `~/.claude/skills/` |
| Repos | `~/Desktop/2026/career-ops` and `~/Desktop/2026/resume_builder` |

## Phase 1 results (2026-11-24)

| Item | Result |
|---|---|
| Detection | `src/detect.js`, scored locally as in section 3. One change from the table: **Apply button + 2 job headings is worth 4, not 3**, and `/careers/<long-slug>` counts as a job URL. With the original weights a custom career page without markup scored 5 and was missed |
| Reading | `src/jd.js` collects JSON-LD, microdata and the main text (headings and bullets marked); the Rust `jd` module turns it into one posting: title, company, locations, workplace, type, salary (structured or from the text), dates, sections (role, responsibilities, requirements, preferred, benefits, pay…), and facts (seniority, minimum years, sponsorship, citizenship, clearance, degree). No Readability dependency: the engine does the HTML → text |
| career-ops parity | `deriveLabels` / `companyFromUrl` ported to Rust: **525/525** golden cases from the original JavaScript |
| AI summary | One call with the user's key (posting only, never the profile), career-ops' "untrusted posting text" guard, cached per job so revisits cost nothing |
| Saved | `chrome.storage.local` (`jobs`, last 200), listed on the options page; optional copy to career-ops through its existing `POST /capture` (no career-ops changes needed; never commits, pushes or evaluates) |
| UI | Pill on the right edge with the needle-and-thread loader (bobbing needle, stitches feed out; folds into a dashed check when done, relaxes into a wave on error); expands into the panel's Job view. Reduced motion: no movement, crossfades |
| Other | Toolbar dot on job tabs; single-page navigation via a `history.pushState` hook in the bridge; LinkedIn: nothing runs until you click, and no auto-fill; "Don't show on this site" |
| Engine size | WASM 113 KB → 251 KB |
| Tests | Rust unit + golden; `test/jd.test.mjs` (WASM in Node); `test/jobs-extension-e2e.mjs`: real Chrome with the extension, mock DeepSeek, the real career-ops capture server in a temp folder: posting with JSON-LD, posting without, a job list and an article (both silent), revisit (no second AI call), SPA navigation away |
| Not done | Not yet tried on real job sites in your Chrome. The metrics receiver must be redeployed before it accepts the new `job_page` event (until then those events are dropped by the receiver) |

---

## 1. What already exists (checked on this laptop and GitHub)

| Piece | Where | What it gives us |
|---|---|---|
| Appliqué 0.6.0 | `job-autofill/` | Side panel, fill engine (React/Angular/Vue/Ext JS/Workday), AI answers with your DeepSeek/Claude key, safe Continue, beta metrics |
| career-ops (your fork) | `github.com/sree-code/career-ops`, MIT, v1.40.0. **Not on the laptop before today**; cloned read-only to `vendor/career-ops` in this session's folder | 1–5 fit score (`modes/_shared.md`, `modes/oferta.md`, bands in `lib/score-action.mjs`); zero-token ATS keyword coverage (`keyword-match.mjs`); JD capture (`capture-jd.mjs`); a **localhost receiver already built for a Chrome extension** (`capture-server.mjs`: 127.0.0.1 only, bearer token, `chrome-extension://` origin check); DeepSeek-compatible evaluator and tailor (`openai-eval.mjs`, `openai-tailor.mjs`); fact and structure gates (`verify-cv-facts.mjs`, `verify-cv-structure.mjs`); HTML→PDF (`generate-pdf.mjs`); onboarding writer (`onboard-write.mjs`) |
| resume_builder (yours) | `github.com/sree-code/resume_builder`, cloned to `vendor/resume_builder` | `scripts/format_preserve_resume.py`: edits resume **lines in place**. DOCX via python-docx (keeps paragraph style). PDF via PyMuPDF (blanks the old line's box, writes the new text in the same box, shrinks the font to fit) |
| humanizer skill | On this machine in a Claude plugin folder (`skills/humanizer/SKILL.md`, v2.2.0). Upstream `blader/humanizer`, MIT, ~72.8k stars | The writing rules we put into the tailoring prompt |
| UI motion skill | Not installed yet | See section 7 |

---

## 2. Target flow

```
 You open a job page
        │
        ▼
 [detect.js] career-page score ≥ threshold ──no──► stay silent
        │yes
        ▼
 Appliqué mark appears (animated) ─► reads the posting (JSON-LD → page text)
        │
        ├─► AI summary of the posting (saved locally, tracked in career-ops)
        └─► Fit score + ATS keyword coverage (Rust engine in the extension + one AI call)
                 │
        missing keywords? ──► "Improve resume" ──► tailoring session (animated)
                 │                                  humanizer rules + fact gate
                 │                                  in-place DOCX edit (fonts + structure kept)
                 │                                  you approve → DOCX + matching PDF
                 ▼
 Apply ─► Autopilot: fill page ─► Continue ─► fill ─► … ─► Review page
                 │  (pauses on anything that needs you)
                 ▼
 Review summary tab: fields filled per page, AI answers (short), resume changes,
 boxes left for you.  ──► You click Submit.
```

---

## 3. Auto-trigger: how detection will work

Detection runs entirely in the content script on your machine. It sends nothing anywhere until it decides a page is a job page and you have accepted the beta terms.

**Signals, scored. A page needs 6 points; a known application form always triggers.**

| Signal | Points | Why |
|---|---|---|
| A `<script type="application/ld+json">` with `@type: "JobPosting"` (also inside `@graph`, arrays, or microdata `itemtype=".../JobPosting"`) | 6 | Google for Jobs requires this markup (title, description, hiringOrganization, jobLocation, datePosted), so most real postings carry it |
| Host is a known applicant-tracking system: `*.myworkdayjobs.com`, `boards.greenhouse.io`, `job-boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`, `*.icims.com`, `jobs.smartrecruiters.com`, `apply.workable.com`, `jobs.jobvite.com`, `*.taleo.net`, `*.successfactors.com`, `*.oraclecloud.com/hcmUI`, `*.bamboohr.com/careers`, `*.teamtailor.com`, `*.breezy.hr`, `*.recruitee.com`, `*.dayforcehcm.com`, `*.paylocity.com/Recruiting`, `*.phenompeople.com` | 4 | These hosts only serve jobs. The list is seeded from career-ops `providers/`, which already tracks these boards |
| URL path or query looks like a single job: `/job/`, `/jobs/<id>`, `/careers/…/<slug>`, `/positions/`, `/apply`, `gh_jid=`, `jobId=`, `jobSeqNo=` | 2 | Cheap, and many company career sites follow it |
| An Apply button (`Apply`, `Apply now`, `I'm interested`) plus 2 or more job section headings (Responsibilities, Requirements, Qualifications, What you'll do, Benefits) | 3 | Catches custom career sites without markup |
| The existing "looks like an application form" check (identity fields + resume or 4+ profile fields) | triggers | That's the application itself |
| More than one `JobPosting`, or 10+ job links in a list | −6 | A search results or listing page, not a single job |

**Two kinds of pages, two behaviours:**
- **Job description page:** a small Appliqué pill appears at the right edge. It shows the animated mark while it reads the posting, then the score. Click it to open the full panel.
- **Application form:** the side panel opens as it does today.

**Keeping up with single-page apps.** LinkedIn, Workday and many career sites change pages without reloading. Re-check when:
- the URL changes (`popstate`, plus a hook on `history.pushState` in the existing MAIN-world bridge);
- the page settles after changes (the existing MutationObserver, throttled);
- the tab changes. The background script can listen to `chrome.webNavigation.onHistoryStateUpdated`, but that needs the `webNavigation` permission, so the content-side hook comes first.

**The toolbar icon** shows a dot when the current tab is a job (`chrome.action.setBadgeText`).

**Settings:** "Detect job pages automatically" (on), "Analyze postings automatically" (on, uses AI credits), and a per-site off switch.

**False positives:**
- Detection never fills anything by itself on a job description page.
- Filling still waits for an application form plus the auto-fill setting.
- On linkedin.com nothing runs automatically; you click to summarize (see limitations).

---

## 4. Reading and summarizing the posting

1. **Structured first.** From JSON-LD take title, company (`hiringOrganization.name`), locations, `employmentType`, `baseSalary` (min/max/unit), `datePosted`, `validThrough`, `jobLocationType` (remote), `applicantLocationRequirements`, and `description` (HTML → text).
2. **Text fallback.** Main-content extraction with Mozilla Readability (Apache-2.0, bundled locally; no remote code) when there's no JSON-LD.
3. **AI summary (one call):** role, seniority, must-haves, nice-to-haves, keywords (with variants), visa/sponsorship notes, location rules, compensation, red flags. The output is JSON, and the prompt includes career-ops' "untrusted posting text" guard (pages can contain prompt injection).
4. **Saved:**
   - in `chrome.storage.local`, keyed by URL (last 200 jobs);
   - **and** in career-ops through `POST /capture`, which writes `jds/<date>_<company>_<role>_<hash>.md` and a Pending row in `data/pipeline.md`. Your job history stays in plain files you own.

---

## 5. The Rust engine (`applique-core`) and what happens to career-ops

**Why career-ops felt slow.** The minutes go to the AI, not to JavaScript. Its full evaluation starts a coding-agent session that writes an 8-block report with many model calls. The deterministic parts (keyword matching, skill extraction, score bands) already run in milliseconds. So the speed-up has two halves:

1. **Replace the agent session with one structured AI call.** A short prompt built from career-ops' scoring rules (`modes/_shared.md`, `modes/oferta.md`, MIT, credited) returns JSON: fit 1–5, band, reasons, knock-outs, keywords. That's about 5–10 s with DeepSeek, instead of minutes.
2. **Move everything that isn't AI into Rust.** Rust's real advantage here isn't raw speed. It compiles to **WebAssembly that runs inside the extension**, so there's no local server, no Node, no Python. Your friends get the whole pipeline by installing the extension.

**What goes into `applique-core` (Rust → WASM, also built as a native CLI for tests):**

| Module | Ported from | Does |
|---|---|---|
| `jd` | our detector + `capture-jd.mjs` | JSON-LD / HTML → clean posting text and fields |
| `keywords` | career-ops `keyword-match.mjs` (synonyms, variant forms, coverage), `skill-extract.mjs`, `jd-skill-gap.mjs`, `title-keywords.mjs` | Required/preferred skills from the posting; matched / missing against your resume, "the way an ATS parser would" |
| `score` | `lib/score-action.mjs` + knock-out rules from `docs/APPLY_AUTOFILL.md` | Combines AI fit with deterministic checks (sponsorship, years, location, salary floor) into the band: Strong apply / Apply / Maybe / Skip |
| `docx` | new; ideas from resume_builder `format_preserve_resume.py` | Reads the DOCX and extracts its **layout fingerprint**; applies line edits **in place** (section 6) |
| `pdf_in` | new | Reads an uploaded PDF (text, fonts, sizes, positions) to rebuild it once as a matching DOCX |
| `render` | new | DOCX → PDF for download (section 6) |
| `gates` | `verify-cv-facts.mjs`, `verify-cv-structure.mjs` | Blocks invented claims; warns when sections are dropped or reordered |

**How it runs in Chrome:**
- The WASM module loads in the service worker, or in an offscreen document if the service worker is unreliable for it.
- MV3 allows this with `'wasm-unsafe-eval'` in the extension's `script-src`, and extensions using it can be published.
- AI calls stay in JavaScript (`fetch` from the service worker), as today.

**Crates (licenses to confirm in Phase 0):**
- `zip` + `quick-xml`: DOCX. We edit the XML ourselves, so anything we don't understand is copied through untouched. We don't use a DOCX library whose round-trip behaviour we can't verify.
- `lopdf` / `pdf-extract`: reading PDFs.
- `typst` (Apache-2.0): PDF rendering.
- `aho-corasick` + `regex`: keyword matching.
- `serde`: JSON.
- `wasm-bindgen`: the bridge to JavaScript.

**What career-ops still does (optional):**
- Your job history can still go to your career-ops folder through its existing local receiver (`POST /capture`).
- The full 8-block report is still available on demand for a job you care about.
- Neither is in the fill path any more.

## 6. Resume: DOCX first, fonts and structure kept, PDF download

**At sign-up, the engine reads your master resume and saves its layout fingerprint.** It captures:
- page size, margins and columns;
- theme and per-run fonts (Latin and East Asian), sizes, bold/italic/caps and colours;
- paragraph spacing, line height, indents and tab stops;
- bullet and numbering definitions (glyph, indent);
- named styles (Heading 1, …);
- **section headings**: from styles, or from formatting patterns such as bold + caps + larger size when the resume doesn't use styles;
- tables, hyperlinks, header and footer.

You see it as a check screen, for example: *"We found: Calibri 10.5 pt body, 11 pt bold headings, 6 sections (Summary, Skills, Experience…), 2 pages, Letter size. Bullets: •"*. You confirm or correct it.

**Editing rules (the session follows the fingerprint):**
- **Never invent experience.** A keyword is only added where your profile or resume has evidence for it. Everything else is listed as "You don't show this skill".
- **Humanizer rules** go into the prompt, plus a second check on each changed line.
- **Line edits only.** The AI returns `{lineId, oldText, newText, reason, keywordsAdded}`.
- **Text is replaced inside the existing runs.** The first run's formatting is kept; paragraph properties are never touched.
- **A new bullet copies its sibling's exact XML**, then swaps the text.
- **Width budget.** Each new line must fit the space the old line took, measured with that font's character widths (not a character count). A line that would wrap into an extra line is shortened or rejected.
- **Gates:** no new facts, no dropped or reordered sections, same page count.

**The PDF download (same look as the DOCX):**

| Option | Where it runs | Fidelity | For |
|---|---|---|---|
| Microsoft Word, scripted | Your Mac (Word is installed) | Exact; it is Word | You, when the optional local helper runs |
| LibreOffice headless (`soffice`, installed here) | Local helper | Very close | Anyone with LibreOffice |
| Typst in WebAssembly, from the fingerprint | Inside the extension | Close, not pixel-identical | Everyone, no install |

**Fonts for the in-extension PDF:**
- Chrome's Local Font Access API (`queryLocalFonts()`, Chrome 103+, one permission prompt after a click) can hand the extension your installed fonts (Calibri, Garamond…), so the PDF embeds the same fonts.
- If you decline, we fall back to bundled **metric-compatible** fonts: Carlito for Calibri, Caladea for Cambria, Liberation for Arial and Times. They have the same character widths, so lines break in the same places.

Every generated PDF is compared page by page with the original rendering. Any page that changed more than the edited lines did is flagged before you use it.

**When someone submits a PDF instead:**
1. **Preferred:** at sign-up the engine rebuilds it **once as a DOCX** that matches it: the same fonts, sizes, sections and positions read from the PDF. You compare the two side by side and approve. From then on everything is DOCX.
2. **Fallback:** edit lines in place in the PDF (blank the old line's box, write the new text into the same box). This works only when the new text uses characters the PDF's embedded font contains; subset fonts often don't. So it's used for small edits, and we tell you when it can't.

**About the "PDF skill":** the PDF skill in your Claude setup is a guide for Claude using Python libraries (pypdf, pdfplumber, reportlab). It's good for reading text, fonts and positions, and for creating PDFs. It doesn't do in-place text editing, and the extension can't call Claude skills or run Python. We use its approach (pdfplumber-style text, font and position extraction) as the reference for the Rust `pdf_in` module. Its scripts stay useful when you run things inside Claude Code yourself.

## 7. Icon, mascot and loader animation

**Most-starred UI motion skill on GitHub (checked today):**

| Repo | Stars | License | Fit |
|---|---|---|---|
| `emilkowalski/skills` | **~59.1k** | MIT | Most-starred. Includes `animate`, `apple-design`, `choreograph`, `animation-performance`, `review-animations`. **Recommended.** |
| `greensock/gsap-skills` | ~19k | MIT | Tied to the GSAP library, which we don't need for a small extension |
| `LottieFiles/motion-design-skill` | ~3.6k | MIT | General timing and easing rules; a good second reference |

**Install (on your go-ahead):** copy `animate`, `apple-design`, `choreograph` and `animation-performance` into `~/.claude/skills/`, and read each SKILL.md before using it.

**Mark and mascot.** Jobright has a bird; ours is **a needle and thread** (it fits the Appliqué name). The resting mark is the current stitched patch with a small needle tucked in the corner.

**The loader:**
1. The needle stitches a dashed gold seam left to right.
2. The seam then folds into a checkmark when the work finishes.
3. On error, the thread loosens into a soft wave.

It is built with inline SVG and the Web Animations API: no library, so no extra download and no remote code, both of which matter for the Chrome Web Store. It respects "reduce motion" with a static seam that fills.

**Where motion is used:** the pill appearing, "reading the posting", the score ring counting up, the tailoring session, and autopilot moving between pages. Nothing moves while idle.

---

## 8. Autopilot and the Review summary

**The loop:**
1. Fill the page.
2. Wait for the page's own validation.
3. If anything is in **Needs you** or **Left for you**, **pause** and ask.
4. Otherwise click the safe Continue button (same rules as today: never anything that could submit).
5. Wait for the next step to render, then repeat.

**It stops when** any of these happen:
- a Review/summary page (no empty fields and a Submit button present);
- a CAPTCHA, a sign-in or account wall, or a validation error;
- a file upload failure;
- the same page twice in a row;
- 12 steps.

**The Review summary tab** (in the panel):
- Each page with its fields filled (expandable).
- AI answers as "Question → what we answered" in one line each, with an edit link.
- Resume changes (from section 6).
- Boxes left for you.
- Anything skipped.
- Then: "Everything above is ready. Review the page and click Submit."

---

## 9. Sign-up (first run)

Today the profile stays in your browser and there is no account. Two options:

- **A. Local sign-up (recommended for the beta).** A welcome page opens on install:
  1. Your name and email.
  2. Upload your resume. AI fills in the profile from it and you check it.
  3. The questions forms always ask (authorization, sponsorship, salary, EEO, all optional).
  4. Choose your master resume (DOCX recommended).
  5. Pick the AI provider and paste your key.
  6. Optionally connect your career-ops folder for job tracking (paste its capture token).

  Nothing leaves your machine except the AI calls you enable.
- **B. Real accounts.** A server with login (for example Supabase or Clerk), so profiles sync across devices. That means storing resumes and personal details on a server, which brings security work, a new privacy policy and more Chrome Web Store disclosures. It is better as a later phase, once the beta proves the flow.

---

## 10. Limitations and workarounds

| Limitation | Workaround |
|---|---|
| Chrome won't open its built-in side panel without a click (`sidePanel.open` needs a user gesture) | We already use our own in-page panel, which can appear on its own |
| career-ops' full evaluation takes minutes, because it runs a coding-agent session | One structured AI call + the Rust engine for everything else: seconds. The full report only when you ask |
| The extension can't run Python, Playwright, Word or LibreOffice | The Rust engine runs inside the extension as WebAssembly. Word or LibreOffice output is an optional extra through a local helper |
| PDF in-place edits can change fonts or overflow a line, and subset fonts may lack new letters | DOCX master; a submitted PDF is rebuilt once as DOCX and you approve it. Width-budgeted edits, page-by-page comparison, "Keep original" |
| The in-extension PDF (Typst) isn't pixel-identical to Word | Your fonts via Local Font Access, or metric-compatible fallbacks; visual comparison; Word or LibreOffice output when the helper is running |
| The Typst WASM bundle is 28.3 MB (10.7 MB compressed), measured | Our own sub-1 MB renderer (`pdf-writer`), or the Word/LibreOffice helper; decided in Phase 6 |
| PyMuPDF (used by resume_builder) is AGPL-licensed | Not needed any more: the Rust engine uses permissively licensed crates |
| There's no single real "ATS score"; each system ranks differently | Shown as "Keyword match 72%" and "Fit 4.1/5 – Apply", with what was matched and missing |
| Workday and some others need an account and sign-in; Lever can show an hCaptcha when boxes are ticked programmatically | Autopilot stops and hands over to you. We never create accounts, store passwords or solve CAPTCHAs |
| Some forms use cross-origin iframes or unusual upload widgets | The content script already runs in all frames. Anything it can't fill goes to Needs you |
| LinkedIn's help center says it doesn't allow third-party software or browser extensions that scrape or automate activity on the site | On linkedin.com: no autopilot and no automated filling. We only offer the summary and score, and only after you click |
| The humanizer rules make text read naturally but can't guarantee anything about AI detectors | We don't claim it does; facts stay intact |
| AI cost | DeepSeek for summaries and scores; the full report only when you ask |
| Chrome Web Store review | Localhost and native messaging access, the new data uses and AI sending your profile all need listing and privacy-policy updates before the next submission |

---

## 11. Build order

| Phase | What | Est. |
|---|---|---|
| 0 | Install Rust (`rustup`, `wasm32-unknown-unknown`, `wasm-bindgen`); create `applique-core` (Cargo workspace inside `job-autofill/engine/`); prove WASM loads in the MV3 service worker; measure the Typst WASM size; install the motion skills; move career-ops and resume_builder to a permanent folder | 1 day |
| 1 | `detect.js` + JD capture (`jd` module) + local summary + animated needle mark and loader + job-page pill | 2 days |
| 2 | Port `keywords` + `score` to Rust, with career-ops' own test cases as golden tests; the single structured AI fit call | 2–3 days |
| 3 | Score ring, keyword chips and "Improve resume" entry in the panel | 1 day |
| 4 | Sign-up wizard + `docx` fingerprint extraction + check screen; `pdf_in` rebuild-as-DOCX for PDF uploads | 3 days |
| 5 | Tailoring: prompt with humanizer and fact gates, width-budgeted in-place DOCX edits, animated session UI, approval, upload | 3 days |
| 6 | PDF download: Typst WASM + Local Font Access + fallback fonts + visual comparison; optional local helper for Word/LibreOffice | 2–3 days |
| 7 | Autopilot multi-page + Review summary tab | 2 days |
| 8 | End-to-end fixtures (job page, multi-step ATS, tailoring on 3 real resume layouts), privacy and store updates, version 0.7 | 1.5 days |

That's about 17–19 working days. Each phase ends with tests and a demo on a test page before touching real sites.

## 12. Decisions needed

1. **Install Rust on this Mac** (`rustup` from rustup.rs) for Phase 0?
2. **Sign-up:** local sign-up for the beta (option A), accounts later?
3. **PDF default:** in-extension Typst PDF for everyone, plus exact Word output on your Mac through the optional helper?
4. **Font access:** ask for Chrome's local-fonts permission when generating a PDF (best match), with metric-compatible fallbacks if declined?
5. **Where the repos live:** `~/Desktop/2026/career-ops` and `~/Desktop/2026/resume_builder`?

## Sources

- Google, [Job posting structured data](https://developers.google.com/search/docs/appearance/structured-data/job-posting)
- Chrome, [chrome.sidePanel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) and the Chromium extensions group thread ["Sidepanel must be opened in response to a user gesture"](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/WRGFOAHxoaY)
- Single-page-app job sites and iframes: [DEV: parsing any job site](https://dev.to/galihm/how-i-built-a-chrome-extension-that-parses-any-job-site-without-scraping-3ng)
- Motion skills: [emilkowalski/skills](https://github.com/emilkowalski/skills), [greensock/gsap-skills](https://github.com/greensock/gsap-skills), [LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill) (star counts from the GitHub API, 2026-11-23); install-count claims from [skillselion's guide](https://skillselion.com/guides/motion-design-skill-claude-code-guide) conflict and weren't used
- [blader/humanizer](https://github.com/blader/humanizer)
- LinkedIn Help, [Automated activity on LinkedIn](https://www.linkedin.com/help/linkedin/answer/90586) and [Prohibited software and extensions](https://www.linkedin.com/help/linkedin/answer/a1341387)
- career-ops: `ARCHITECTURE.md`, `capture-server.mjs`, `keyword-match.mjs`, `modes/_shared.md`, `docs/APPLY_AUTOFILL.md` in your fork
- resume_builder: `scripts/format_preserve_resume.py`, `README.md`
- WebAssembly in MV3: [Chrome: Improving security in Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security), [chromium-extensions: Load wasm module using manifest V3](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/sJiaTnFMLHQ), [DEV: moving a WASM pipeline into an offscreen document](https://dev.to/sathiyasenpai/why-i-moved-my-transformersjs-pipeline-out-of-the-chrome-mv3-service-worker-and-into-an-offscreen-1kk4)
- Fonts: [MDN Local Font Access API](https://developer.mozilla.org/en-US/docs/Web/API/Local_Font_Access_API), [Chrome: Use advanced typography with local fonts](https://developer.chrome.com/docs/capabilities/web-apis/local-fonts)
- Rendering: [typst.ts](https://github.com/myriad-dreamin/typst.ts), [typst](https://github.com/typst/typst)
- DOCX crates: [docx-rs](https://docsearch.algolia.com/mcp/docs/repo/bokuweb/docx-rs), [rdocx](https://docs.rs/crate/rdocx/latest), [linch-docx-rs](https://docs.rs/crate/linch-docx-rs/latest) (round-trip behaviour unverified, which is why we edit the XML ourselves)
