//! JavaScript bindings. Values cross the boundary as JSON strings so the
//! surface stays small and stable while the engine grows.
use wasm_bindgen::prelude::*;

use crate::{jd, keywords};

#[wasm_bindgen(js_name = engineInfo)]
pub fn engine_info() -> String {
    crate::info().to_string()
}

#[wasm_bindgen(js_name = normalizeText)]
pub fn normalize_text(s: &str) -> String {
    keywords::normalize_text(s)
}

#[wasm_bindgen(js_name = keywordCount)]
pub fn keyword_count(keyword: &str, text: &str) -> u32 {
    keywords::keyword_count(keyword, text) as u32
}

#[wasm_bindgen(js_name = expandTerms)]
pub fn expand_terms(keyword: &str) -> String {
    serde_json::to_string(&keywords::expand_terms(keyword)).unwrap_or_else(|_| "[]".into())
}

/// `keywordsJson`: JSON array of strings. Returns `{matched, missing, percent}` as JSON.
#[wasm_bindgen]
pub fn coverage(keywords_json: &str, text: &str) -> String {
    let list: Vec<String> = serde_json::from_str(keywords_json).unwrap_or_default();
    serde_json::to_string(&keywords::coverage(&list, text)).unwrap_or_else(|_| "{}".into())
}

/// `pageJson`: what the content script read from the page (see `jd::PageInput`).
/// Returns the cleaned posting as JSON, or `{"error": ...}`.
#[wasm_bindgen(js_name = extractPosting)]
pub fn extract_posting(page_json: &str) -> String {
    match serde_json::from_str::<jd::PageInput>(page_json) {
        Ok(input) => serde_json::to_string(&jd::extract(&input)).unwrap_or_else(|e| format!("{{\"error\":{:?}}}", e.to_string())),
        Err(e) => format!("{{\"error\":{:?}}}", e.to_string()),
    }
}

/// Company and role from a URL and page title (career-ops `deriveLabels`).
#[wasm_bindgen(js_name = deriveLabels)]
pub fn derive_labels(url: &str, title: &str) -> String {
    let (company, role) = jd::derive_labels(url, title);
    serde_json::json!({ "company": company, "role": role }).to_string()
}
