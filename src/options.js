const SECTIONS = {
  Personal: ["firstName", "middleName", "lastName", "preferredName", "pronouns", "email", "phone", "phoneDeviceType"],
  Address: ["address1", "address2", "city", "state", "postalCode", "country", "location"],
  Links: ["linkedin", "github", "portfolio"],
  Work: ["currentCompany", "currentTitle", "yearsExperience", "salary", "startDate", "howHeard"],
  Education: ["school", "degree", "major", "gradYear"],
  "Eligibility (answers like Yes / No)": ["workAuthorized", "needsSponsorship", "willingToRelocate", "previouslyEmployed"],
  "Background for AI answers (summary, skills, work history)": ["summary", "skills", "workHistory"],
  "Voluntary self-identification (optional)": ["gender", "race", "hispanic", "veteran", "disability"],
};
const LONG = new Set(["summary", "skills", "workHistory"]); // multi-line: textarea keeps newlines
const pretty = (k) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

const form = document.getElementById("f");
for (const [title, keys] of Object.entries(SECTIONS)) {
  const h = document.createElement("h2"); h.textContent = title; form.appendChild(h);
  const g = document.createElement("div"); g.className = "grid";
  for (const k of keys) {
    const l = document.createElement("label"); l.textContent = pretty(k);
    const i = document.createElement(LONG.has(k) ? "textarea" : "input"); i.name = k;
    if (LONG.has(k)) l.classList.add("wide");
    l.appendChild(i); g.appendChild(l);
  }
  form.appendChild(g);
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
  out.textContent = `Filled ${used.length} field(s).` + (ignored.length ? ` Ignored unknown keys: ${ignored.join(", ")}.` : "") + " Review, then Save.";
};

const settingsEl = document.getElementById("settings");
const sField = (k) => settingsEl.querySelector(`[name="${k}"]`);

function showAI() {
  chrome.runtime.sendMessage({ type: "AI_STATUS" }, (s) => {
    const el = document.getElementById("aiStatus");
    el.textContent = !s || s.error ? "AI: add an API key to enable." :
      `AI ${s.provider}/${s.model} · session #${s.sessionNumber} · ${s.turns} turns · ${s.contextTokens}/${s.contextLimit} tokens · ${s.rollovers} rollovers · memory ${s.memoryChars} chars`;
  });
}
document.getElementById("resetAI").onclick = () => chrome.runtime.sendMessage({ type: "AI_RESET", keepMemory: true }, showAI);
document.getElementById("wipeAI").onclick = () => chrome.runtime.sendMessage({ type: "AI_RESET", keepMemory: false }, showAI);

// Placeholders follow the chosen provider.
const HINTS = { deepseek: ["deepseek-flash", "https://api.deepseek.com"], anthropic: ["claude-sonnet-5-5", "https://api.anthropic.com"] };
const syncHints = () => { const [m, u] = HINTS[sField("provider").value] || HINTS.deepseek; sField("model").placeholder = m; sField("baseURL").placeholder = u; };
sField("provider").addEventListener("change", syncHints);

chrome.storage.local.get(["profile", "resume", "coverLetter", "settings"], ({ profile = {}, resume, coverLetter, settings = {} }) => {
  for (const [k, v] of Object.entries(settings)) if (sField(k)) sField(k).value = String(v);
  syncHints();
  showAI();
  for (const [k, v] of Object.entries(profile)) if (form.elements[k]) form.elements[k].value = v;
  if (resume) document.getElementById("resumeName").textContent = `Saved: ${resume.name}`;
  if (coverLetter) document.getElementById("coverLetterName").textContent = `Saved: ${coverLetter.name}`;
});

document.getElementById("save").onclick = async () => {
  const profile = Object.fromEntries([...new FormData(form)].filter(([, v]) => v !== ""));
  const settings = {};
  settingsEl.querySelectorAll("[name]").forEach((el) => {
    if (el.value === "") return;
    settings[el.name] = el.value === "true" ? true : el.value === "false" ? false : el.value;
  });
  const data = { profile, settings };
  for (const id of ["resume", "coverLetter"]) {
    const f = document.getElementById(id).files[0];
    if (f) {
      data[id] = await readFile(f);
      const note = document.getElementById(`${id}Name`);
      note.textContent = data[id].fixedFrom
        ? `Saved as ${data[id].name} (the file "${data[id].fixedFrom}" is really a ${data[id].name.split(".").pop().toUpperCase()}).`
        : `Saved: ${data[id].name}`;
    }
  }
  await chrome.storage.local.set(data);
  const s = document.getElementById("status");
  s.textContent = "Saved"; setTimeout(() => (s.textContent = ""), 2000);
  showAI();
};
