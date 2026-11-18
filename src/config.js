// Where anonymous usage metrics are sent (only for users who opt in on the
// options page). This is the maintainer's Vercel receiver (telemetry/vercel).
// Forks that run their own receiver change this; empty = telemetry disabled.
export const TELEMETRY_URL = "https://job-autofill-telemetry.vercel.app/v1/events";
