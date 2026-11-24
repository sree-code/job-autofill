// Regenerate engine/applique-core/tests/fixtures/keyword_golden.json from the
// ORIGINAL career-ops JavaScript, so the Rust port is checked against it.
//   CAREER_OPS=~/Desktop/2026/career-ops node engine/scripts/gen-golden.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";

const root = (process.env.CAREER_OPS || path.join(os.homedir(), "Desktop/2026/career-ops")).replace(/^~/, os.homedir());
const km = await import(pathToFileURL(path.join(root, "keyword-match.mjs")).href);

const texts = [
  "Senior Engineer — React, TypeScript, Node.js, AWS (EC2, S3), Kubernetes/k8s, CI/CD with GitHub Actions.",
  "Built LLM apps; fine-tuned large language models; ML pipelines on GCP and Google Cloud Platform.",
  "JavaScript and Java; C++17 and c++; PostgreSQL/postgres; REST APIs and GraphQL api.",
  "  Spaces and odd\ttabs\nnewlines​ and﻿BOM   ",
  "Ciência de Dados, Café, naïve résumé — Python & PyTorch; ÉTUDES.",
  "kubernetes kubernete Kubernetes's k8s K8S",
  "Team lead for 5 engineers; Agile/Scrum; Jira; Docker; Terraform (IaC); infrastructure as code.",
  "",
];
const terms = ["React", "react.js", "TypeScript", "ts", "js", "JavaScript", "Java", "Node.js", "AWS", "amazon web services", "Kubernetes",
  "k8s", "CI/CD", "cicd", "LLM", "LLMs", "large language model", "ML", "machine learning", "GCP", "C++", "PostgreSQL", "postgres", "API", "APIs",
  "GraphQL", "Python", "PyTorch", "café", "résumé", "Docker", "Terraform", "IaC", "Scrum", "Jira", "it", "its", "go", "s", "", "  "];

const cases = [];
for (const text of texts) for (const term of terms) {
  cases.push({ term, text, normalized: km.normalizeText(text), count: km.countOccurrences(term, text), variants: km.variantForms(term),
    expanded: km.expandTerms(term), keywordCount: km.keywordCount(term, text) });
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "../applique-core/tests/fixtures/keyword_golden.json");
writeFileSync(out, JSON.stringify({ source: "career-ops keyword-match.mjs", cases }, null, 1));
console.log(`${cases.length} golden cases → ${path.relative(process.cwd(), out)}`);
