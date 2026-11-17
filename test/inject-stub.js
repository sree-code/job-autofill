const p = globalThis.__jafProfile || {};
if (!globalThis.chrome?.storage) {
  globalThis.chrome = {
    storage: { local: { get: (_k, cb) => cb({ profile: p.profile || {}, resume: p.resume, settings: { autoFill: false, aiEnabled: false } }) } },
    runtime: { onMessage: { addListener() {} }, sendMessage: (_m, cb) => cb?.({ answers: [] }) },
  };
}
