const out = document.getElementById("out");

document.getElementById("opts").onclick = () => chrome.runtime.openOptionsPage();

document.getElementById("fill").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: "AUTOFILL" });
    if (r?.needsConsent) { out.textContent = "Accept usage metrics on the profile page to start using the beta."; return; }
    out.textContent = `Filled ${r.filled.length}: ${r.filled.join(", ")}\nUnmatched: ${r.skipped.length}`;
  } catch {
    out.textContent = "No form script on this page. Reload the page and try again.";
  }
};
