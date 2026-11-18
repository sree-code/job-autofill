// Render docs/setup-guide.html to docs/Job-Autofill-Setup-Guide.pdf with your installed Chrome.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_PATH || { darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  win32: "C:/Program Files/Google/Chrome/Application/chrome.exe", linux: "/usr/bin/google-chrome" }[process.platform];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(root, "docs/setup-guide.html")).href, { waitUntil: "load" });
const out = path.join(root, "docs/Job-Autofill-Setup-Guide.pdf");
await page.pdf({ path: out, format: "Letter", printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log("saved", out);
