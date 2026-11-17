// Keyboard shortcut -> tell the active tab's content scripts to autofill.
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "autofill") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "AUTOFILL" }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});
