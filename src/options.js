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
const pretty = (k) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

const form = document.getElementById("f");
for (const [title, keys] of Object.entries(SECTIONS)) {
  const h = document.createElement("h2"); h.textContent = title; form.appendChild(h);
  const g = document.createElement("div"); g.className = "grid";
  for (const k of keys) {
    const l = document.createElement("label"); l.textContent = pretty(k);
    const i = document.createElement("input"); i.name = k; l.appendChild(i); g.appendChild(l);
  }
  form.appendChild(g);
}

const readFile = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res({ name: file.name, dataUrl: r.result });
  r.onerror = rej;
  r.readAsDataURL(file);
});

const settingsEl = document.getElementById("settings");
const sField = (k) => settingsEl.querySelector(`[name="${k}"]`);

function showAI() {
  chrome.runtime.sendMessage({ type: "AI_STATUS" }, (s) => {
    const el = document.getElementById("aiStatus");
    el.textContent = !s || s.error ? "AI: add an API key to enable." :
      `AI session #${s.sessionNumber} · ${s.turns} turns · ${s.contextTokens}/${s.contextLimit} tokens · ${s.rollovers} rollovers · memory ${s.memoryChars} chars`;
  });
}
document.getElementById("resetAI").onclick = () => chrome.runtime.sendMessage({ type: "AI_RESET", keepMemory: true }, showAI);
document.getElementById("wipeAI").onclick = () => chrome.runtime.sendMessage({ type: "AI_RESET", keepMemory: false }, showAI);

chrome.storage.local.get(["profile", "resume", "coverLetter", "settings"], ({ profile = {}, resume, coverLetter, settings = {} }) => {
  for (const [k, v] of Object.entries(settings)) if (sField(k)) sField(k).value = String(v);
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
    if (f) data[id] = await readFile(f);
  }
  await chrome.storage.local.set(data);
  const s = document.getElementById("status");
  s.textContent = "Saved"; setTimeout(() => (s.textContent = ""), 2000);
  showAI();
};
