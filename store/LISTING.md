# Chrome Web Store submission: Appliqué

Copy each block into the matching field of the Chrome Web Store developer dashboard.

- **Upload:** `store/job-autofill-<version>.zip` (build it with `npm run package`)
- **Screenshots:** `store/screenshots/*.png` (1280×800; rebuild with `npm run store:screenshots`)
- **Icon:** `icons/icon128.png` (source: `icons/src/icon.svg`; re-render with `node scripts/icons.mjs`)
- **Privacy policy URL:** https://job-autofill-telemetry.vercel.app/privacy
- **Visibility (beta):** Unlisted. Share the store link only with testers.

---

## Store listing tab

**Name** (taken from the manifest): `Appliqué: Job Application Autofill`

**Summary** (from the manifest, 132 characters max):
Fill job applications from a profile that stays in your browser. Works on Workday, Greenhouse, Lever, Ashby and more.

**Category:** Tools (or Workflow & Planning)

**Language:** English

**Description:**

```
Appliqué fills job application forms for you using a profile you enter once. Your profile, resume and settings stay in your browser and are never sent to the developer.

WHAT IT DOES
• Fills name, contact details, address, links, work history, education, work authorization and other common questions on job application forms.
• Works on Workday, Greenhouse, Lever, Ashby and most company career sites, including forms built with React, Angular, Vue and Ext JS.
• Attaches your saved resume and cover letter to upload fields.
• Marks every field it filled with a stitched outline: gold for answers from your profile, blue for AI-drafted answers you should check.
• Never overwrites anything you've already typed, and never submits an application. You review every answer and click Submit yourself.
• Optional AI answers: add your own DeepSeek or Anthropic API key and the extension drafts answers to questions your profile doesn't cover, such as "Why do you want to work here?".

HOW TO USE
1. Open the extension's options page and accept the beta terms (see below).
2. Fill in your profile or paste it as JSON, attach your resume, and click Save.
3. Open a job application and click Fill application (or press Alt+Shift+F). Review the answers, then submit the application yourself.

PRIVACY
• Your profile, resume, cover letter and API key are stored only in this browser (chrome.storage.local).
• If you turn on AI answers, questions the extension can't answer from your profile are sent, together with your profile, directly from your browser to the AI provider you chose, using your own key. The developer never receives them.

BETA: ANONYMOUS USAGE METRICS ARE REQUIRED
This is a beta release. Before the extension fills any form, you must accept anonymous usage metrics on its options page. These metrics are: a random install ID, the extension and browser version, the job site's hostname (no page path), the number and types of fields found and filled, question labels it couldn't match (with emails and numbers masked), timings, the AI provider and model, and error messages. Your profile values, form contents, AI answers, API keys, resume and full URLs are never sent. If you don't want this, don't install the extension, or uninstall it at any time to stop all collection.

Privacy policy: https://job-autofill-telemetry.vercel.app/privacy
Source code: https://github.com/sree-code/job-autofill
```

---

## Privacy practices tab

**Single purpose:**

```
Fill job application forms on career websites with the user's own saved profile and resume, so the user doesn't retype the same information on every application.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Stores the user's profile, resume, cover letter, settings and optional AI API key locally in chrome.storage.local so they can be used to fill forms. |
| Host permissions (`https://*/*`, `http://*/*`) | Job applications are hosted on thousands of different domains: applicant-tracking systems such as Workday, Greenhouse, Lever and Ashby, plus each company's own career site. The content script has to run on these pages to detect form fields and fill them. It only reads and writes form fields, and only acts when the user clicks Fill application or has turned on auto-fill. The service worker also uses host access to call the AI provider the user configured (api.deepseek.com or api.anthropic.com) and to send the usage metrics the user accepted. |

**Remote code:** No, I am not using remote code. (All JavaScript is in the package. The AI provider returns JSON text only, and that text is never executed.)

**Data usage: what user data do you collect?** Check these boxes:

| Category | Check? | Why |
|---|---|---|
| Personally identifiable information | ✅ | Name, email, address and phone in the profile. Stored locally; sent to the user's chosen AI provider only if AI answers are on. |
| Health information | ✅ | Optional disability self-identification answer in the profile. Stored locally. |
| Financial and payment information | ☐ | |
| Authentication information | ✅ | The user's own AI provider API key, stored locally and sent only to that provider. |
| Personal communications | ☐ | |
| Location | ✅ | Address, city and state in the profile. Stored locally. |
| Web history | ☐ | Only the job site's hostname is sent in metrics, never full URLs or history. If a reviewer disagrees, check this box too. |
| User activity | ✅ | Anonymous fill counts and timings (the usage metrics). |
| Website content | ✅ | Form question labels on the job page (sent to the AI provider when AI is on; unmatched labels, masked, in metrics). |

**Certifications:** Check all three:
- I do not sell or transfer user data to third parties, apart from the approved use cases.
- I do not use or transfer user data for purposes unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://job-autofill-telemetry.vercel.app/privacy

---

## Distribution tab

- **Visibility:** Unlisted
- **Regions:** All regions (or only where your testers are)
- **Payment:** Free

## Notes for the reviewer (optional field, if offered)

```
To test: open the options page, click "Accept and continue", click "Import profile from JSON", paste {"firstName":"Test","lastName":"User","email":"test@example.com","phone":"555-0100","city":"Austin","state":"Texas"}, click "Fill form from JSON", then Save. Open any Greenhouse or Lever job application (for example a job on job-boards.greenhouse.io) and click the "Fill application" button in the bottom-right corner. The extension never submits forms. AI answers are optional and need the reviewer's own API key; everything else works without one.
```

## Before each new upload

1. Bump `version` in both `manifest.json` and `package.json`.
2. `npm test`
3. `npm run package`
4. Upload the new zip under **Package** in the dashboard, then **Submit for review**.
