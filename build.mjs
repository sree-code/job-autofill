import { build } from "esbuild";
// Service worker: bundles the Anthropic SDK + zod.
await build({ entryPoints: ["src/background.js"], bundle: true, format: "esm", platform: "browser", target: "chrome120", outfile: "dist/background.js", logLevel: "info" });
// Same AI session for local test pages (exposes globalThis.JafAI).
await build({ entryPoints: ["test/ai-dev-entry.js"], bundle: true, format: "iife", platform: "browser", target: "chrome120", outfile: "dist/ai-dev.js", logLevel: "info" });
// Single content bundle used for injecting into live pages during testing.
await build({ entryPoints: ["test/inject-entry.js"], bundle: true, format: "iife", minify: true, target: "chrome120", outfile: "dist/inject.js", logLevel: "info" });
// Test fixtures (React JSX, Angular JIT).
if (process.argv.includes("--fixtures")) {
  await build({ entryPoints: ["test/fixtures/react-app.jsx", "test/fixtures/angular-app.js"], bundle: true, format: "iife", target: "chrome120",
    outdir: "dist/fixtures", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning" });
}
