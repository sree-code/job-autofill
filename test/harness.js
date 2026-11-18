// Test harness: stands in for chrome.* so the real content scripts run on a
// plain page. AI calls go through the real AnswerSession (dist/ai-dev.js)
// against the mock Claude server on :8787.
(() => {
  const params = new URLSearchParams(location.search);
  const store = {
    profile: {
      firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "555-0100", phoneDeviceType: "Mobile",
      address1: "1 Engine Way", city: "Austin", state: "Texas", postalCode: "78701", country: "United States",
      linkedin: "https://linkedin.com/in/ada", currentCompany: "Analytical Engines", currentTitle: "Engineer",
      yearsExperience: "6", workAuthorized: "Yes", needsSponsorship: "No", previouslyEmployed: "No", howHeard: "LinkedIn",
      skills: "TypeScript, React, Angular",
    },
    resume: { name: "resume.pdf", dataUrl: "data:application/pdf;base64,JVBERi0xLjQK" },
    settings: { autoFill: params.get("auto") === "1", aiEnabled: params.get("ai") !== "0" },
  };
  const mem = new Map();
  let session;
  window.chrome = {
    storage: { local: { get: (keys, cb) => cb(Object.fromEntries([].concat(keys).map((k) => [k, store[k]]))) } },
    runtime: {
      onMessage: { addListener() {} },
      sendMessage(msg, cb) {
        if (msg.type === "GATE") return cb?.({ allowed: params.get("gate") !== "0" }); // ?gate=0: metrics not accepted
        if (msg.type === "OPEN_OPTIONS") return (window.__jafOpenedOptions = true), cb?.();
        if (msg.type === "TELEMETRY") { (window.__jafTelemetry ??= []).push(msg); return cb?.({ ok: true }); }
        if (msg.type !== "AI_ANSWER") return cb?.({});
        session ??= new window.JafAI.AnswerSession({
          storage: { get: async (k) => mem.get(k), set: async (k, v) => void mem.set(k, v) },
          apiKey: "test", baseURL: "http://localhost:8787",
        });
        session.answer(msg.questions, store.profile, msg.page).then(cb, (e) => cb({ answers: [], error: String(e) }));
      },
    },
  };
  window.__jafStore = store;
})();
