# Appliqué: Job Application Autofill

A Chrome (Manifest V3) extension that fills job application forms from a profile stored **only in your browser**. No account, no backend, no tracking.

## Features

- **Field discovery**: scans inputs, selects, textareas, ARIA comboboxes and fields inside open shadow roots.
- **Semantic matching**: reads `<label>`, `aria-label`, `aria-labelledby`, placeholder, `name`/`id`, `autocomplete` and fieldset legends, then maps the question to a profile key with ordered regex rules.
- **Framework-safe filling**: writes through the native `value` setter and dispatches `input`/`change`/`blur`, so React/Vue/Angular forms register the value.
- **Selects, radios and checkboxes**: fuzzy-match the option text against your answer ("Yes", "Texas", …).
- **Custom dropdowns**: opens the combobox, types, and clicks the matching `role=option`.
- **Resume upload**: attaches your stored PDF/DOCX to `<input type=file>` with `DataTransfer`.
- **ATS hints**: adapters for Workday, Greenhouse, Lever, Ashby, iCIMS and SmartRecruiters, which map known field ids.
- **Multi-step forms**: a `MutationObserver` re-detects fields as new steps render.
- Never overwrites a field you've already filled, and **never clicks Submit**.

## AI answers (optional)

Questions the profile can't answer go to one continuous AI session. When its context
passes the limit (default 120k tokens), it's summarized into memory and a new session starts.

- **DeepSeek** (default): OpenAI-compatible `https://api.deepseek.com`, model `deepseek-flash`,
  JSON output mode, fast reasoning (`reasoning_effort: low`; Off/High selectable).
- **Anthropic** (optional): `claude-sonnet-5-5` with structured outputs.

Pick the provider and paste its API key on the options page. The key stays in `chrome.storage.local`.

## Setup guide

[docs/Job-Autofill-Setup-Guide.pdf](docs/Job-Autofill-Setup-Guide.pdf) is a single document you can share. Give it to a Claude Code session
and it walks through install, build, profile and a practice run. The source is `docs/setup-guide.html`; run `npm run guide` to rebuild the PDF.

## Usage metrics (required during the beta)

When `TELEMETRY_URL` in `src/config.js` is set, the extension is locked until the user clicks **Accept and continue** on the options page
(there is no opt-out other than uninstalling). Nothing is sent before they accept. Metrics are counts, timings, the job site's hostname, field types, unmatched question labels and errors.
Profile values, answers, API keys and resumes are never sent.
Events go to the maintainer's Vercel receiver (`telemetry/vercel/`, private Blob storage); the dashboard is at
`https://job-autofill-telemetry.vercel.app/dashboard?key=ADMIN_KEY` and the privacy policy at
<https://job-autofill-telemetry.vercel.app/privacy>. To self-host, run `ADMIN_KEY=… npm run telemetry` (see `telemetry/server.mjs`).

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. The options page opens: fill in your profile, attach your resume, and click **Save**.

## Use

- Click the floating **Autofill** button that appears on application forms, or
- use the toolbar popup, or press **Alt+Shift+F**.

Review every field before submitting.

## Test locally

Open `test/form.html` in a browser. It stubs `chrome.storage` and loads the real scripts, then click **Autofill**.

## Layout

| File | Role |
|---|---|
| `src/matcher.js` | field discovery, label resolution, classification |
| `src/filler.js` | value writers (text, select, choice, combobox, file) |
| `src/adapters.js` | per-ATS field-id hints |
| `src/content.js` | orchestration, floating button, report |
| `src/options.*` | profile editor |
| `src/popup.*`, `src/background.js` | toolbar popup and keyboard shortcut |

## License

MIT

## Rust engine (`engine/`)

`engine/applique-core` is Appliqué's local engine, compiled to WebAssembly and loaded by the service worker (`src/engine.js`). The built files in `engine/pkg/` are committed, so `npm run build` doesn't need Rust. To change the engine:

```bash
npm run engine:test   # cargo test, including 328 golden cases from career-ops' JavaScript
npm run engine        # rebuild engine/pkg (needs rustup, wasm32-unknown-unknown, wasm-bindgen-cli 0.2.100)
```

The keyword module is a port of [career-ops](https://github.com/santifer/career-ops)' `keyword-match.mjs` (MIT). `engine/scripts/gen-golden.mjs` regenerates the golden cases from a local career-ops checkout. See `docs/PIPELINE_PLAN.md` for what comes next.

## Job postings (Phase 1)

On a job posting Appliqué shows a tab at the right edge and reads the posting locally: `src/detect.js` decides whether the page is a job (JSON-LD, ATS host, URL, Apply button + job headings; lists stay silent), `src/jd.js` collects the page, and the Rust engine's `jd` module (`engine/applique-core/src/jd.rs`) turns it into fields, sections and facts. With an API key the posting (not your profile) gets one AI summary. Jobs are saved in `chrome.storage.local` and listed on the options page. Optionally each job is copied to career-ops through its own local capture server:

```bash
cd ~/Desktop/2026/career-ops && node capture-server.mjs --no-eval
```

Paste the printed token into Appliqué's settings under career-ops.

Tests: `npm test` (includes the engine through WebAssembly) and `npm run test:e2e` (real Chrome; the jobs test needs career-ops at `~/Desktop/2026/career-ops` or `CAREER_OPS=`).
