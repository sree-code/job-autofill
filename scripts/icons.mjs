// Render icons/src/icon.svg to the PNG sizes Chrome uses.
// 128px follows the Chrome Web Store guideline: 96px artwork with 16px transparent padding.
// 16px drops the stitched border, which turns to noise at that size.
//   node scripts/icons.mjs
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(path.join(root, "icons/src/icon.svg"), "utf8");
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const SIZES = [[16, 0, false], [32, 1, true], [48, 2, true], [128, 16, true]]; // size, padding, stitch
try {
  for (const [size, pad, stitch] of SIZES) {
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const art = stitch ? svg : svg.replace(/<g class="stitch">[\s\S]*?<\/g>/, "");
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;margin:${pad}px;width:${size - 2 * pad}px;height:${size - 2 * pad}px}</style>${art}`);
    await page.screenshot({ path: path.join(root, `icons/icon${size}.png`), omitBackground: true });
    await page.close();
    console.log(`icons/icon${size}.png`);
  }
} finally { await browser.close(); }
