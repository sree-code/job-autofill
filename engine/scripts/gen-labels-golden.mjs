// Regenerate engine/applique-core/tests/fixtures/labels_golden.json from the
// ORIGINAL career-ops `deriveLabels` (capture-jd.mjs), so the Rust port of the
// company/role labelling is checked against it.
//   CAREER_OPS=~/Desktop/2026/career-ops node engine/scripts/gen-labels-golden.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";

const root = (process.env.CAREER_OPS || path.join(os.homedir(), "Desktop/2026/career-ops")).replace(/^~/, os.homedir());
const { deriveLabels } = await import(pathToFileURL(path.join(root, "capture-jd.mjs")).href);

const urls = [
  "https://boards.greenhouse.io/anthropic/jobs/4020305008",
  "https://job-boards.greenhouse.io/stripe/jobs/6012345",
  "https://jobs.lever.co/mistral-ai/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab",
  "https://jobs.ashbyhq.com/openai/1f2e3d4c-5b6a-7980-1a2b-3c4d5e6f7a8b",
  "https://jobs.smartrecruiters.com/Visa/743999999999999-senior-engineer",
  "https://careers.smartrecruiters.com/en_US/whatever",
  "https://apply.workable.com/huggingface/j/ABC123/",
  "https://jobs.workable.com/de-de/view/1234",
  "https://jobs.lever.co/0b1c2d3e4f5a6b7c8d9e",
  "https://jobs.lever.co/acme%20labs/123",
  "https://jobs.lever.co/caf%C3%A9_co/123",
  "https://jobs.lever.co/bad%E0%A4%A/123",
  "https://mastercard.wd1.myworkdayjobs.com/en-US/CorporateCareers/job/O-Fallon-Missouri/Software-Engineer_R-251234",
  "https://careers.google.com/jobs/results/123",
  "https://www.careers.microsoft.com/us/en/job/1700000",
  "https://jobs.netflix.com/jobs/312345",
  "https://www.datadoghq.com/careers/detail/?gh_jid=6543210",
  "https://stripe.com/jobs/listing/backend-engineer/6012345",
  "https://apply.example.co.uk/x",
  "https://localhost:3000/jobs/1",
  "https://WWW.Example.COM/Careers",
  "http://hire.lyft.com/positions/123",
  "https://talent.ki/abc",
  "not a url",
  "",
];
const titles = [
  "",
  "Senior AI Engineer at Anthropic",
  "Senior AI Engineer @ Anthropic",
  "Senior AI Engineer AT Anthropic",
  "Senior AI Engineer | Anthropic",
  "Senior AI Engineer — Anthropic",
  "Senior AI Engineer – Anthropic",
  "Senior AI Engineer - Anthropic",
  "Job Application for Software Engineer, Payments at Stripe",
  "Software Engineer II - Backend | Payments - Mastercard",
  "Staff Engineer at Acme at Scale",
  "Data Scientist",
  "  Product\tDesigner \n at \r Figma  ",
  "Engineer|Pipes|In|Name",
  "Engineer - - Acme",
  "Engineer at",
  "at Acme",
  "Café Manager – Le Bistro",
  "Ingénieur logiciel H/F - Société Générale",
  "Lead Engineer at Acme",
  "A".repeat(100) + " | " + "B".repeat(100),
];

const cases = [];
for (const url of urls) for (const title of titles) cases.push({ url, title, ...deriveLabels(url, title) });
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../applique-core/tests/fixtures/labels_golden.json");
writeFileSync(out, JSON.stringify({ source: "career-ops capture-jd.mjs deriveLabels", cases }, null, 1));
console.log(`${cases.length} golden cases → ${path.relative(process.cwd(), out)}`);
