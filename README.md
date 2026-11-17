# Job Autofill (local)

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
