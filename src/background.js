// Service worker: keyboard shortcut + AI answering bridge for content scripts.
import { AnswerSession } from "./ai/session.js";

const chromeStorage = {
  get: (k) => chrome.storage.local.get(k).then((r) => r[k]),
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};

async function getSession() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  if (!settings.apiKey) return null;
  return new AnswerSession({
    storage: chromeStorage,
    apiKey: settings.apiKey,
    provider: settings.provider, // "deepseek" (default) | "anthropic"
    model: settings.model,
    reasoning: settings.reasoning, // DeepSeek reasoning effort; default "low"
    contextLimit: Number(settings.contextLimit) || undefined,
    baseURL: settings.baseURL,
  });
}

// Serialize AI calls so concurrent frames don't interleave session turns.
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn, fn));

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg?.type === "AI_ANSWER") {
    enqueue(async () => {
      try {
        const session = await getSession();
        if (!session) return send({ answers: [], error: "no-api-key" });
        const { profile = {} } = await chrome.storage.local.get("profile");
        send(await session.answer(msg.questions, profile, msg.page));
      } catch (e) {
        send({ answers: [], error: String(e?.message || e) });
      }
    });
    return true;
  }
  if (msg?.type === "AI_STATUS" || msg?.type === "AI_RESET") {
    (async () => {
      const session = await getSession();
      if (!session) return send({ error: "no-api-key" });
      if (msg.type === "AI_RESET") await session.reset({ keepMemory: msg.keepMemory !== false });
      send(await session.status());
    })();
    return true;
  }
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "autofill") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "AUTOFILL" }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});
