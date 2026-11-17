const SECTIONS = {
  Personal: ["firstName", "middleName", "lastName", "preferredName", "pronouns", "email", "phone"],
  Address: ["address1", "address2", "city", "state", "postalCode", "country", "location"],
  Links: ["linkedin", "github", "portfolio"],
  Work: ["currentCompany", "currentTitle", "yearsExperience", "salary", "startDate", "howHeard"],
  Education: ["school", "degree", "major", "gradYear"],
  "Eligibility (answers like Yes / No)": ["workAuthorized", "needsSponsorship", "willingToRelocate"],
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

chrome.storage.local.get(["profile", "resume", "coverLetter"], ({ profile = {}, resume, coverLetter }) => {
  for (const [k, v] of Object.entries(profile)) if (form.elements[k]) form.elements[k].value = v;
  if (resume) document.getElementById("resumeName").textContent = `Saved: ${resume.name}`;
  if (coverLetter) document.getElementById("coverLetterName").textContent = `Saved: ${coverLetter.name}`;
});

document.getElementById("save").onclick = async () => {
  const profile = Object.fromEntries([...new FormData(form)].filter(([, v]) => v !== ""));
  const data = { profile };
  for (const id of ["resume", "coverLetter"]) {
    const f = document.getElementById(id).files[0];
    if (f) data[id] = await readFile(f);
  }
  await chrome.storage.local.set(data);
  const s = document.getElementById("status");
  s.textContent = "Saved"; setTimeout(() => (s.textContent = ""), 2000);
};
