import { metricsGate } from "./telemetry.js";
const SECTIONS = {
  Personal: ["firstName", "middleName", "lastName", "preferredName", "pronouns", "email", "phone", "phoneDeviceType"],
  Address: ["address1", "address2", "city", "state", "postalCode", "country", "location"],
  Links: ["linkedin", "github", "portfolio"],
  Work: ["currentCompany", "currentTitle", "yearsExperience", "salary", "startDate", "howHeard"],
  Education: ["school", "degree", "major", "gradYear"],
  Eligibility: ["workAuthorized", "needsSponsorship", "willingToRelocate", "previouslyEmployed"],
  "About you": ["summary", "skills", "workHistory"],
  "Voluntary self-identification": ["gender", "race", "hispanic", "veteran", "disability"],
};
const FOOTS = {
  Eligibility: "Answer the way the forms ask, for example Yes or No.",
  "About you": "Used to draft answers to open questions when AI answers are on.",
  "Voluntary self-identification": "Optional. Leave blank and these questions stay unanswered.",
};
const LABELS = { address1: "Address line 1", address2: "Address line 2", linkedin: "LinkedIn", github: "GitHub", gradYear: "Graduation year",
  phoneDeviceType: "Phone type", howHeard: "How you heard about the job", workAuthorized: "Authorized to work", needsSponsorship: "Needs visa sponsorship",
  willingToRelocate: "Willing to relocate", previouslyEmployed: "Worked here before", hispanic: "Hispanic or Latino", workHistory: "Work history", yearsExperience: "Years of experience" };
const LONG = new Set(["summary", "skills", "workHistory"]); // multi-line: textarea keeps newlines
const pretty = (k) => LABELS[k] || k.replace(/([A-Z])/g, " $1").toLowerCase().replace(/^./, (c) => c.toUpperCase());

const form = document.getElementById("f");
for (const [title, keys] of Object.entries(SECTIONS)) {
  const sec = document.createElement("div"); sec.className = "section";
  const h = document.createElement("h2"); h.textContent = title; sec.appendChild(h);
  const g = document.createElement("div"); g.className = "group";
  for (const k of keys) {
    const l = document.createElement("label"); l.className = LONG.has(k) ? "row stack" : "row";
    const t = document.createElement("span"); t.textContent = pretty(k); l.appendChild(t);
    const i = document.createElement(LONG.has(k) ? "textarea" : "input"); i.name = k;
    if (!LONG.has(k)) i.placeholder = "Not set";
    l.appendChild(i); g.appendChild(l);
  }
  sec.appendChild(g);
  if (FOOTS[title]) { const f = document.createElement("p"); f.className = "foot"; f.textContent = FOOTS[title]; sec.appendChild(f); }
  form.appendChild(sec);
}

// Trust the bytes, not the extension: a .docx saved as "resume.pdf" would be
// rejected or unreadable once uploaded to an ATS.
const SNIFF = [
  { magic: [0x25, 0x50, 0x44, 0x46], ext: "pdf", mime: "application/pdf" },                    // %PDF
  { magic: [0x50, 0x4b, 0x03, 0x04], ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, // PK zip
  { magic: [0xd0, 0xcf, 0x11, 0xe0], ext: "doc", mime: "application/msword" },                  // OLE
];
async function readFile(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const kind = SNIFF.find((k) => k.magic.every((b, i) => head[i] === b));
  let name = file.name, mime = file.type || "application/octet-stream", fixed = false;
  if (kind) {
    mime = kind.mime;
    if (!name.toLowerCase().endsWith("." + kind.ext)) { name = name.replace(/\.[^.]*$/, "") + "." + kind.ext; fixed = true; }
  }
  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  return { name, dataUrl: `data:${mime};base64,${b64}`, fixedFrom: fixed ? file.name : undefined };
}

for (const id of ["resume", "coverLetter"]) document.getElementById(id).addEventListener("change", (e) => {
  const f = e.target.files[0]; if (f) document.getElementById(`${id}Name`).textContent = `${f.name} (save to keep)`;
});

// Import: fill the form from pasted JSON (does not save until the user clicks Save).
const ALL_KEYS = new Set(Object.values(SECTIONS).flat());
document.getElementById("importBtn").onclick = () => {
  const out = document.getElementById("importStatus");
  let data;
  try { data = JSON.parse(document.getElementById("importJson").value); } catch (e) { out.textContent = `Not valid JSON: ${e.message}`; return; }
  if (!data || typeof data !== "object" || Array.isArray(data)) { out.textContent = "Expected a JSON object."; return; }
  const used = [], ignored = [];
  for (const [k, v] of Object.entries(data)) {
    if (!ALL_KEYS.has(k)) { ignored.push(k); continue; }
    if (v == null || v === "") continue;
    form.elements[k].value = Array.isArray(v) ? v.join(k === "workHistory" ? "\n" : ", ") : String(v);
    used.push(k);
  }
  out.textContent = `Filled ${used.length} field(s).` + (ignored.length ? ` Ignored unknown keys: ${ignored.join(", ")}.` : "") + " Review them, then save.";
};

const settingsEl = document.getElementById("settings");
const sField = (k) => settingsEl.querySelector(`[name="${k}"]`);

function showAI() {
  chrome.runtime.sendMessage({ type: "AI_STATUS" }, (s) => {
    const el = document.getElementById("aiStatus");
    el.textContent = !s || s.error ? "Add an API key to turn on AI answers." :
      `Using ${s.model} (${s.provider}). Session ${s.sessionNumber}: ${s.turns} questions, ${s.contextTokens.toLocaleString()} of ${s.contextLimit.toLocaleString()} tokens. When a session fills up it's summarized into memory (${s.rollovers} so far).`;
  });
}
document.getElementById("resetAI").onclick = () => chrome.runtime.sendMessage({ type: "AI_RESET", keepMemory: true }, showAI);
document.getElementById("wipeAI").onclick = () => chrome.runtime.sendMessage({ type: "AI_RESET", keepMemory: false }, showAI);

// Placeholders follow the chosen provider.
const HINTS = { deepseek: ["deepseek-flash", "https://api.deepseek.com"], anthropic: ["claude-sonnet-5-5", "https://api.anthropic.com"] };
const syncHints = () => { const [m, u] = HINTS[sField("provider").value] || HINTS.deepseek; sField("model").placeholder = m; sField("baseURL").placeholder = u; };
sField("provider").addEventListener("change", syncHints);

chrome.storage.local.get(["profile", "resume", "coverLetter", "settings"], ({ profile = {}, resume, coverLetter, settings = {} }) => {
  for (const [k, v] of Object.entries(settings)) {
    const el = sField(k);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = v === true || v === "true"; else el.value = String(v);
  }
  syncHints();
  lockUntilAccepted(settings);
  showAI();
  for (const [k, v] of Object.entries(profile)) if (form.elements[k]) form.elements[k].value = v;
  if (!form.elements.phoneDeviceType.value) form.elements.phoneDeviceType.value = "Mobile";
  if (resume) document.getElementById("resumeName").textContent = resume.name;
  if (coverLetter) document.getElementById("coverLetterName").textContent = coverLetter.name;
});

document.getElementById("save").onclick = async () => {
  const profile = Object.fromEntries([...new FormData(form)].filter(([, v]) => v !== ""));
  const settings = {};
  settingsEl.querySelectorAll("[name]").forEach((el) => {
    if (el.type === "checkbox") { settings[el.name] = el.checked; return; }
    if (el.value === "") return;
    settings[el.name] = el.value === "true" ? true : el.value === "false" ? false : el.value;
  });
  const { settings: prev = {} } = await chrome.storage.local.get("settings");
  for (const k of ["telemetry", "telemetryURL"]) if (k in prev) settings[k] = prev[k]; // not editable here
  const data = { profile, settings };
  for (const id of ["resume", "coverLetter"]) {
    const f = document.getElementById(id).files[0];
    if (f) {
      data[id] = await readFile(f);
      const note = document.getElementById(`${id}Name`);
      note.textContent = data[id].fixedFrom
        ? `Saved as ${data[id].name} (the file "${data[id].fixedFrom}" is really a ${data[id].name.split(".").pop().toUpperCase()}).`
        : data[id].name;
    }
  }
  await chrome.storage.local.set(data);
  const s = document.getElementById("status");
  s.textContent = "Saved"; setTimeout(() => (s.textContent = ""), 2000);
  showAI();
};

// Beta gate: the page (and the extension) stays locked until metrics are accepted.
function lockUntilAccepted(settings) {
  const { allowed } = metricsGate(settings);
  document.getElementById("consent").hidden = allowed;
  document.getElementById("app").inert = !allowed;
}
document.getElementById("consentYes").onclick = async () => {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const next = { ...settings, telemetry: true };
  await chrome.storage.local.set({ settings: next });
  lockUntilAccepted(next);
  chrome.runtime.sendMessage({ type: "TELEMETRY", event: "consent", props: {} }, () => void chrome.runtime.lastError);
};
