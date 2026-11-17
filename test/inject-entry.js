// Test-only: bridge + content scripts in one file for pasting into a live page.
// chrome.* is stubbed with an in-memory profile from window.__jafProfile.
import "../src/page/bridge.js";
import "./inject-stub.js";
import "../src/matcher.js";
import "../src/filler.js";
import "../src/adapters.js";
import "../src/content.js";
