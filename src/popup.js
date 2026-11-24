const out = document.getElementById("out");
const say = (title, detail = "") => { out.replaceChildren(Object.assign(document.createElement("b"), { textContent: title }), Object.assign(document.createElement("span"), { textContent: detail })); };

document.getElementById("opts").onclick = () => chrome.runtime.openOptionsPage();

document.getElementById("fill").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: "AUTOFILL" });
    if (r?.needsConsent) { say("Accept the beta terms first", "Open Edit profile and accept usage metrics to start."); return; }
    const n = r.filled.length, left = r.skipped.length;
    say(n ? `Filled ${n} field${n === 1 ? "" : "s"}` : "Nothing to fill here",
      left ? `${left} question${left === 1 ? "" : "s"} need${left === 1 ? "s" : ""} your answer. Review everything before you submit.` : "Review everything before you submit.");
  } catch {
    say("This page isn't ready", "Reload the page, then try again.");
  }
};
