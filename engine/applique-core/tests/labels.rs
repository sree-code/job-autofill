//! The Rust port of career-ops' `deriveLabels` must give the same company and
//! role as the original JavaScript (fixture: engine/scripts/gen-labels-golden.mjs).
use applique_core::jd::derive_labels;
use serde::Deserialize;

#[derive(Deserialize)]
struct Case {
    url: String,
    title: String,
    company: String,
    role: String,
}

#[derive(Deserialize)]
struct Golden {
    cases: Vec<Case>,
}

#[test]
fn matches_career_ops_derive_labels() {
    let g: Golden = serde_json::from_str(include_str!("fixtures/labels_golden.json")).unwrap();
    assert!(g.cases.len() > 400);
    let mut failures = Vec::new();
    for c in &g.cases {
        let got = derive_labels(&c.url, &c.title);
        if got != (c.company.clone(), c.role.clone()) {
            failures.push(format!("url={:?} title={:?}\n  got  {:?}\n  want {:?}", c.url, c.title, got, (&c.company, &c.role)));
        }
    }
    assert!(failures.is_empty(), "{} mismatches:\n{}", failures.len(), failures.join("\n"));
}
