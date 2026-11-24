//! JavaScript bindings. Values cross the boundary as JSON strings so the
//! surface stays small and stable while the engine grows.
use wasm_bindgen::prelude::*;

use crate::keywords;

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
