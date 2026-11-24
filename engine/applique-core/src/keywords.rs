//! ATS keyword matching primitives.
//!
//! A faithful port of career-ops `keyword-match.mjs` (MIT, © Santiago
//! Fernández de Valderrama): `normalizeText`, `countOccurrences`,
//! `variantForms`, `expandTerms`, `keywordCount` and the synonym table.
//! `tests/golden.rs` checks this port against outputs produced by the original
//! JavaScript (`engine/scripts/gen-golden.mjs`).

/// Synonym groups: any member matches the others.
pub const SYNONYMS: &[&[&str]] = &[
    &["javascript", "js"],
    &["typescript", "ts"],
    &["kubernetes", "k8s"],
    &["machine learning", "ml"],
    &["ci/cd", "cicd"],
    &["infrastructure as code", "iac"],
    &["natural language processing", "nlp"],
    &["large language model", "large language models", "llm"],
    &["amazon web services", "aws"],
    &["google cloud platform", "gcp"],
    &["postgresql", "postgres"],
];

/// JavaScript's `\s`: Unicode whitespace plus U+FEFF, which Rust's
/// `char::is_whitespace` leaves out.
fn is_js_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{FEFF}'
}

/// Lowercase and collapse runs of whitespace to single spaces, trimmed.
pub fn normalize_text(s: &str) -> String {
    let lower = s.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut pending_space = false;
    for c in lower.chars() {
        if is_js_space(c) {
            pending_space = true;
        } else {
            if pending_space && !out.is_empty() {
                out.push(' ');
            }
            pending_space = false;
            out.push(c);
        }
    }
    out
}

fn is_word_char(c: Option<char>) -> bool {
    matches!(c, Some(ch) if ch.is_ascii_lowercase() || ch.is_ascii_digit())
}

/// Boundary-delimited, non-overlapping occurrences of `term` in `text`.
/// A boundary means no ASCII letter or digit right before or after, so "java"
/// doesn't match inside "javascript" while "c++", "ci/cd" and "node.js" still
/// match around their symbols.
pub fn count_occurrences(term: &str, text: &str) -> usize {
    let t = normalize_text(term);
    if t.is_empty() {
        return 0;
    }
    let hay = normalize_text(text);
    let mut count = 0;
    let mut pos = 0;
    while let Some(rel) = hay[pos..].find(&t) {
        let start = pos + rel;
        let end = start + t.len();
        let before = hay[..start].chars().next_back();
        let after = hay[end..].chars().next();
        if !is_word_char(before) && !is_word_char(after) {
            count += 1;
            pos = end;
        } else {
            pos = start + hay[start..].chars().next().map_or(1, char::len_utf8);
        }
    }
    count
}

/// Conservative singular/plural forms. Never strips an "s" from a token of
/// three characters or fewer; appends one only from three characters up.
pub fn variant_forms(term: &str) -> Vec<String> {
    let t = normalize_text(term);
    let mut forms = vec![t.clone()];
    let n = t.chars().count();
    if n < 3 {
        return forms;
    }
    if !t.ends_with('s') {
        push_unique(&mut forms, format!("{t}s"));
    } else if n > 3 {
        push_unique(&mut forms, t[..t.len() - 1].to_string());
    }
    forms
}

fn push_unique(v: &mut Vec<String>, s: String) {
    if !v.contains(&s) {
        v.push(s);
    }
}

/// Every surface form to search for a keyword: its own variants plus the
/// variants of each member of any synonym group one of those forms is in.
pub fn expand_terms(keyword: &str) -> Vec<String> {
    let k = normalize_text(keyword);
    let forms = variant_forms(&k);
    let mut terms = forms.clone();
    for group in SYNONYMS {
        if !forms.iter().any(|f| group.contains(&f.as_str())) {
            continue;
        }
        for member in *group {
            if *member == k {
                continue;
            }
            for v in variant_forms(member) {
                push_unique(&mut terms, v);
            }
        }
    }
    terms
}

/// Total boundary-aware occurrences of a keyword across all its forms.
pub fn keyword_count(keyword: &str, text: &str) -> usize {
    expand_terms(keyword).iter().map(|t| count_occurrences(t, text)).sum()
}

/// Coverage of a keyword list against a text: which are present, which missing.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Coverage {
    pub matched: Vec<String>,
    pub missing: Vec<String>,
    /// 0–100, rounded.
    pub percent: u32,
}

pub fn coverage(keywords: &[String], text: &str) -> Coverage {
    let mut matched = Vec::new();
    let mut missing = Vec::new();
    for k in keywords {
        if normalize_text(k).is_empty() {
            continue;
        }
        if keyword_count(k, text) > 0 {
            matched.push(k.clone());
        } else {
            missing.push(k.clone());
        }
    }
    let total = matched.len() + missing.len();
    let percent = if total == 0 { 0 } else { ((matched.len() as f64 / total as f64) * 100.0).round() as u32 };
    Coverage { matched, missing, percent }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boundaries() {
        assert_eq!(count_occurrences("java", "JavaScript and Java"), 1);
        assert_eq!(count_occurrences("c++", "C++, c++17"), 1); // "c++17": a digit follows, so not a boundary (same as career-ops)
        assert_eq!(count_occurrences("ci/cd", "CI/CD pipelines"), 1);
        assert_eq!(count_occurrences("node.js", "Node.js"), 1);
    }

    #[test]
    fn synonyms_and_plurals() {
        assert_eq!(keyword_count("LLMs", "Built LLM apps with large language models"), 2);
        assert_eq!(keyword_count("Kubernetes", "k8s clusters"), 1);
        assert!(variant_forms("aws") == vec!["aws".to_string()]);
    }

    #[test]
    fn coverage_percent() {
        let k = vec!["React".to_string(), "Azure".to_string(), "Java".to_string()];
        let c = coverage(&k, "React and Java developer");
        assert_eq!(c.matched, vec!["React", "Java"]);
        assert_eq!(c.missing, vec!["Azure"]);
        assert_eq!(c.percent, 67);
    }
}
