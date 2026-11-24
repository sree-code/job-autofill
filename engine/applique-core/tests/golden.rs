//! The Rust port must give the same answers as career-ops' JavaScript.
use applique_core::keywords::*;
use serde::Deserialize;

#[derive(Deserialize)]
struct Case {
    term: String,
    text: String,
    normalized: String,
    count: usize,
    variants: Vec<String>,
    expanded: Vec<String>,
    #[serde(rename = "keywordCount")]
    keyword_count: usize,
}

#[derive(Deserialize)]
struct Golden {
    cases: Vec<Case>,
}

#[test]
fn matches_career_ops_javascript() {
    let g: Golden = serde_json::from_str(include_str!("fixtures/keyword_golden.json")).unwrap();
    assert!(g.cases.len() > 100);
    let mut failures = Vec::new();
    for c in &g.cases {
        let got = (normalize_text(&c.text), count_occurrences(&c.term, &c.text), variant_forms(&c.term), expand_terms(&c.term), keyword_count(&c.term, &c.text));
        let want = (c.normalized.clone(), c.count, c.variants.clone(), c.expanded.clone(), c.keyword_count);
        if got != want {
            failures.push(format!("term={:?} text={:?}\n  got  {:?}\n  want {:?}", c.term, c.text, got, want));
        }
    }
    assert!(failures.is_empty(), "{} mismatches:\n{}", failures.len(), failures.join("\n"));
}
