//! Reading a job posting.
//!
//! The content script hands over what the page offers: JSON-LD blocks,
//! microdata, the heading, and the main text with headings and bullets marked.
//! This module picks the posting, turns its HTML into plain structured text,
//! splits it into sections and pulls out the facts that matter before applying
//! (experience, sponsorship, clearance, degree, salary, workplace). No AI and
//! no I/O: the same page always gives the same posting.
//!
//! `derive_labels` and `company_from_url` are a port of career-ops
//! `capture-jd.mjs` (MIT, © Santiago Fernández de Valderrama), checked against
//! the original JavaScript by `tests/labels.rs`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JavaScript's `\s`. Rust's `char::is_whitespace` adds U+0085 and leaves out U+FEFF.
pub(crate) fn js_space(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{FEFF}'
}

fn collapse(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for c in s.chars() {
        if js_space(c) {
            space = true;
        } else {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.push(c);
        }
    }
    out
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out = out.trim_end().to_string();
    out.push('…');
    out
}

// ---------------------------------------------------------------------------
// Labels: port of career-ops capture-jd.mjs
// ---------------------------------------------------------------------------

const GENERIC_HOST_LABELS: &[&str] = &["boards", "jobs", "job-boards", "careers", "career", "apply", "recruiting", "hire", "talent", "www"];

const ATS_TENANT_HOSTS: &[&str] = &[
    "boards.greenhouse.io",
    "job-boards.greenhouse.io",
    "jobs.lever.co",
    "jobs.ashbyhq.com",
    "jobs.smartrecruiters.com",
    "careers.smartrecruiters.com",
    "apply.workable.com",
    "jobs.workable.com",
];

/// Host and path of an absolute http(s)-style URL, roughly as `new URL()` gives them.
fn split_url(url: &str) -> Option<(String, String)> {
    let url = url.trim_matches(|c: char| c <= ' ');
    let colon = url.find(':')?;
    let scheme = &url[..colon];
    if scheme.is_empty() || !scheme.chars().next()?.is_ascii_alphabetic() || !scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c)) {
        return None;
    }
    let rest = url[colon + 1..].trim_start_matches(['/', '\\']);
    let end = rest.find(['/', '\\', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    let host_port = authority.rsplit('@').next().unwrap_or("");
    let host = if host_port.starts_with('[') {
        host_port.split(']').next().map(|h| format!("{h}]")).unwrap_or_default()
    } else {
        host_port.split(':').next().unwrap_or("").to_string()
    };
    if host.is_empty() || host.contains(' ') {
        return None;
    }
    let after = &rest[end..];
    let path_end = after.find(['?', '#']).unwrap_or(after.len());
    let path = after[..path_end].replace('\\', "/");
    Some((host.to_ascii_lowercase(), if path.is_empty() { "/".into() } else { path }))
}

/// `decodeURIComponent`: None when the escapes aren't valid UTF-8 (JS throws).
fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn is_word_byte(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// `slug.replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim().replace(/\b\w/g, upper)`
fn prettify_slug(slug: &str) -> String {
    let spaced: String = slug.chars().map(|c| if c == '-' || c == '_' { ' ' } else { c }).collect();
    let collapsed = collapse(&spaced);
    let mut out = String::with_capacity(collapsed.len());
    let mut prev_word = false;
    for c in collapsed.chars() {
        let w = is_word_byte(c);
        out.push(if w && !prev_word { c.to_ascii_uppercase() } else { c });
        prev_word = w;
    }
    out
}

fn is_locale_segment(s: &str) -> bool {
    let b = s.as_bytes();
    let alpha2 = |x: &[u8]| x.len() == 2 && x.iter().all(|c| c.is_ascii_alphabetic());
    (b.len() == 2 && alpha2(b)) || (b.len() == 5 && alpha2(&b[..2]) && (b[2] == b'-' || b[2] == b'_') && alpha2(&b[3..]))
}

fn is_opaque_id(s: &str) -> bool {
    s.len() >= 16 && s.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-')
}

/// Best-effort employer name from a posting URL (career-ops `companyFromUrl`).
pub fn company_from_url(url: &str) -> String {
    let Some((host, path)) = split_url(url) else { return String::new() };
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    if ATS_TENANT_HOSTS.contains(&host.as_str()) {
        let tenant = path.split('/').find(|p| !p.is_empty()).unwrap_or("");
        if !tenant.is_empty() && !is_locale_segment(tenant) && !is_opaque_id(tenant) {
            return match percent_decode(tenant) {
                Some(t) => prettify_slug(&t),
                None => String::new(),
            };
        }
    }
    let mut labels: Vec<&str> = host.split('.').collect();
    if labels.len() > 2 && GENERIC_HOST_LABELS.contains(&labels[0]) {
        labels.remove(0);
    }
    match labels.first() {
        Some(base) if !base.is_empty() => prettify_slug(base),
        _ => String::new(),
    }
}

/// career-ops `oneLine`: one line, no pipes, at most `max` UTF-16 units.
fn one_line(text: &str, max: usize) -> String {
    let mut s = String::with_capacity(text.len());
    let mut prev_ctl = false;
    for c in text.chars() {
        if c == '\r' || c == '\n' || c == '\t' {
            if !prev_ctl {
                s.push(' ');
            }
            prev_ctl = true;
        } else {
            s.push(c);
            prev_ctl = false;
        }
    }
    let s = collapse_runs(&s).replace('|', "/");
    let s = s.trim_matches(js_space);
    let mut out = String::new();
    let mut units = 0;
    for c in s.chars() {
        units += c.len_utf16();
        if units > max {
            break;
        }
        out.push(c);
    }
    out
}

/// `.replace(/\s{2,}/g, ' ')`: only runs of two or more become a space.
fn collapse_runs(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < chars.len() {
        if js_space(chars[i]) {
            let mut j = i;
            while j < chars.len() && js_space(chars[j]) {
                j += 1;
            }
            if j - i >= 2 {
                out.push(' ');
            } else {
                out.push(chars[i]);
            }
            i = j;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

/// Company and role from a page title (career-ops `deriveLabels`).
pub fn derive_labels(url: &str, title: &str) -> (String, String) {
    let flat: String = {
        let mut s = String::new();
        let mut prev = false;
        for c in title.chars() {
            if c == '\r' || c == '\n' || c == '\t' {
                if !prev {
                    s.push(' ');
                }
                prev = true;
            } else {
                s.push(c);
                prev = false;
            }
        }
        s
    };
    let clean = collapse_runs(&flat).trim_matches(js_space).to_string();
    let chars: Vec<char> = clean.chars().collect();
    let mut company = String::new();
    let mut role = String::new();

    if !clean.is_empty() {
        // /^(.*?)\s+(?:at|@)\s+(.+)$/i
        let mut found = None;
        let mut i = 0;
        while i < chars.len() {
            if js_space(chars[i]) {
                let mut j = i;
                while j < chars.len() && js_space(chars[j]) {
                    j += 1;
                }
                let k = if j < chars.len() && chars[j] == '@' {
                    Some(j + 1)
                } else if j + 1 < chars.len() && chars[j].eq_ignore_ascii_case(&'a') && chars[j + 1].eq_ignore_ascii_case(&'t') {
                    Some(j + 2)
                } else {
                    None
                };
                if let Some(k) = k {
                    let mut m = k;
                    while m < chars.len() && js_space(chars[m]) {
                        m += 1;
                    }
                    if m > k && m < chars.len() {
                        found = Some((i, m));
                        break;
                    }
                }
                i = j;
            } else {
                i += 1;
            }
        }
        if let Some((i, m)) = found {
            role = chars[..i].iter().collect();
            company = chars[m..].iter().collect();
        } else {
            // split(/\s+[|—–]\s+|\s+-\s+/)
            let mut parts: Vec<String> = Vec::new();
            let mut cur = String::new();
            let mut i = 0;
            while i < chars.len() {
                if js_space(chars[i]) {
                    let mut j = i;
                    while j < chars.len() && js_space(chars[j]) {
                        j += 1;
                    }
                    if j < chars.len() && matches!(chars[j], '|' | '—' | '–' | '-') {
                        let mut m = j + 1;
                        while m < chars.len() && js_space(chars[m]) {
                            m += 1;
                        }
                        if m > j + 1 {
                            parts.push(std::mem::take(&mut cur));
                            i = m;
                            continue;
                        }
                    }
                    cur.extend(&chars[i..j]);
                    i = j;
                } else {
                    cur.push(chars[i]);
                    i += 1;
                }
            }
            parts.push(cur);
            let parts: Vec<String> = parts.iter().map(|p| p.trim_matches(js_space).to_string()).filter(|p| !p.is_empty()).collect();
            if parts.len() >= 2 {
                role = parts[0].clone();
                company = parts[parts.len() - 1].clone();
            } else {
                role = clean.clone();
            }
        }
    }
    if company.is_empty() {
        company = company_from_url(url);
    }
    (one_line(&company, 80), one_line(&role, 80))
}

// ---------------------------------------------------------------------------
// HTML → structured text
// ---------------------------------------------------------------------------

fn entity(name: &str) -> Option<char> {
    if let Some(num) = name.strip_prefix('#') {
        let code = if let Some(hex) = num.strip_prefix(['x', 'X']) { u32::from_str_radix(hex, 16).ok()? } else { num.parse().ok()? };
        return char::from_u32(code).filter(|c| *c != '\0');
    }
    Some(match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" | "#39" => '\'',
        "nbsp" | "ensp" | "emsp" | "thinsp" => ' ',
        "ndash" => '–',
        "mdash" => '—',
        "lsquo" => '‘',
        "rsquo" => '’',
        "ldquo" => '“',
        "rdquo" => '”',
        "hellip" => '…',
        "bull" => '•',
        "middot" => '·',
        "trade" => '™',
        "reg" => '®',
        "copy" => '©',
        "euro" => '€',
        "pound" => '£',
        "yen" => '¥',
        "cent" => '¢',
        "times" => '×',
        "deg" => '°',
        "eacute" => 'é',
        "egrave" => 'è',
        "aacute" => 'á',
        "oacute" => 'ó',
        "uuml" => 'ü',
        "ouml" => 'ö',
        "auml" => 'ä',
        "ntilde" => 'ñ',
        "ccedil" => 'ç',
        _ => return None,
    })
}

/// Decode HTML character references; unknown ones stay as written.
pub fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(p) = rest.find('&') {
        out.push_str(&rest[..p]);
        let tail = &rest[p + 1..];
        let semi = tail.char_indices().take(12).find(|(_, c)| *c == ';').map(|(i, _)| i);
        match semi.and_then(|i| entity(&tail[..i]).map(|c| (i, c))) {
            Some((i, c)) => {
                out.push(c);
                rest = &tail[i + 1..];
            }
            None => {
                out.push('&');
                rest = tail;
            }
        }
    }
    out.push_str(rest);
    out
}

const BLOCK_TAGS: &[&str] = &[
    "p", "div", "ul", "ol", "dl", "dd", "dt", "tr", "table", "section", "article", "header", "footer", "blockquote", "hr", "pre", "main", "aside", "nav",
    "figure", "figcaption", "td", "th", "tbody", "thead",
];

/// Start a new line, unless the current one is still empty or only holds a marker.
fn push_break(out: &mut String) {
    let tail = out.rsplit('\n').next().unwrap_or("");
    let t = tail.trim();
    if t.is_empty() || t == "-" || t == "##" {
        return;
    }
    out.push('\n');
}

/// Index of the `>` that closes the tag starting at `start` (quotes respected).
fn tag_end(s: &str, start: usize) -> Option<usize> {
    let mut quote: Option<char> = None;
    for (i, c) in s[start + 1..].char_indices() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == '"' || c == '\'' => quote = Some(c),
            None if c == '>' => return Some(start + 1 + i),
            None => {}
        }
    }
    None
}

/// HTML (or entity-escaped HTML, as many JSON-LD descriptions are) to plain
/// text with one paragraph per line, `## ` before headings and `- ` before list items.
pub fn html_to_text(input: &str) -> String {
    let decoded;
    let s = if !input.contains('<') && input.contains("&lt;") {
        decoded = decode_entities(input);
        decoded.as_str()
    } else {
        input
    };
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        let rest = &s[i..];
        if rest.starts_with("<!--") {
            i = rest.find("-->").map(|p| i + p + 3).unwrap_or(s.len());
            continue;
        }
        if rest.starts_with('<') {
            let inner_start = i + 1;
            let closing = s[inner_start..].starts_with('/');
            let name: String = s[inner_start + usize::from(closing)..].chars().take_while(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
            let end = if name.is_empty() { None } else { tag_end(s, i) };
            let Some(end) = end else {
                out.push('<');
                i += 1;
                continue;
            };
            i = end + 1;
            match name.as_str() {
                "script" | "style" | "noscript" | "template" | "svg" | "head" if !closing => {
                    let close = format!("</{name}");
                    let lower = s[i..].to_ascii_lowercase();
                    i = lower.find(&close).map(|p| i + p).unwrap_or(s.len());
                }
                "br" => out.push('\n'),
                "li" => {
                    push_break(&mut out);
                    if !closing {
                        out.push_str("- ");
                    }
                }
                "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                    push_break(&mut out);
                    if !closing {
                        out.push_str("## ");
                    }
                }
                n if BLOCK_TAGS.contains(&n) => push_break(&mut out),
                _ => {}
            }
        } else {
            let next = rest.find('<').map(|p| i + p).unwrap_or(s.len());
            out.push_str(&decode_entities(&s[i..next]));
            i = next;
        }
    }
    tidy_lines(&out)
}

/// Collapse spaces in each line, drop empty lines and empty markers, and turn
/// typed bullets (•, ·, *, ▪) into `- `.
pub fn tidy_lines(text: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.lines() {
        let mut line = collapse(raw);
        for b in ["• ", "· ", "* ", "▪ ", "◦ ", "‣ ", "– ", "o "] {
            if line.starts_with(b) && line.len() > b.len() + 1 && b != "o " {
                line = format!("- {}", &line[b.len()..]);
                break;
            }
        }
        if line.starts_with('•') && !line.starts_with("• ") {
            line = format!("- {}", line.trim_start_matches('•').trim());
        }
        let bare = line.trim_start_matches("## ").trim_start_matches("- ").trim();
        if bare.is_empty() || bare == "-" || bare == "##" {
            continue;
        }
        if lines.last() == Some(&line) {
            continue;
        }
        lines.push(line);
    }
    lines.join("\n")
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Section {
    pub kind: &'static str,
    pub heading: String,
    pub lines: Vec<String>,
}

fn norm_heading(h: &str) -> String {
    h.to_lowercase().replace(['’', '‘', '`'], "'").trim_matches(|c: char| !c.is_alphanumeric() && c != '\'').to_string()
}

/// What a heading introduces. Order matters: "preferred qualifications" is
/// preferred, not required; "about the role" is the role, not the company.
pub fn classify_heading(h: &str) -> &'static str {
    let t = norm_heading(h);
    let has = |words: &[&str]| words.iter().any(|w| t.contains(w));
    if has(&["preferred", "nice to have", "nice-to-have", "bonus", "pluses", "desired", "ideally", "would be great", "extra credit", "plus if"]) {
        "preferred"
    } else if has(&["salary", "compensation", "pay range", "pay transparency", "base pay", "pay rate", "hourly rate"]) {
        "compensation"
    } else if has(&["benefit", "perks", "what we offer", "we offer", "why join", "why you'll love", "total rewards", "what's in it for you", "what you'll get"]) {
        "benefits"
    } else if has(&["responsibilit", "what you'll do", "what you will do", "what you'd do", "duties", "day to day", "day-to-day", "in this role", "your role", "the role you", "your impact", "what you'll work on", "what you will work on", "key accountabilities", "your mission"]) {
        "responsibilities"
    } else if has(&["requirement", "qualification", "what you bring", "what you'll bring", "what you will bring", "who you are", "must have", "must-have", "about you", "what we're looking for", "what we are looking for", "you have", "you might be", "skills", "experience you", "you should have", "we'd love to hear from you if", "you'll need", "you will need", "competencies"]) {
        "requirements"
    } else if has(&["about the role", "about the job", "about the position", "about this role", "role overview", "position overview", "position summary", "job summary", "job description", "the opportunity", "overview", "summary", "about the team", "the team", "the role"]) {
        "about"
    } else if has(&["about us", "about the company", "who we are", "our company", "company overview", "our mission", "our story", "about "]) {
        "company"
    } else if has(&["equal opportunity", "eeo", "accommodation", "privacy", "e-verify", "disclaimer"]) {
        "legal"
    } else if has(&["location", "where you'll work", "work location", "hybrid", "remote"]) {
        "location"
    } else {
        "other"
    }
}

/// A line that reads like a heading even without heading markup:
/// short, no sentence punctuation, and either ends with ":" or is a known heading.
fn heading_text(line: &str) -> Option<String> {
    if let Some(h) = line.strip_prefix("## ") {
        return Some(h.trim().trim_end_matches(':').trim().to_string());
    }
    if line.starts_with("- ") {
        return None;
    }
    let words = line.split_whitespace().count();
    let chars = line.chars().count();
    if chars > 70 || words > 9 || words == 0 {
        return None;
    }
    let ends_colon = line.ends_with(':');
    let body = line.trim_end_matches(':').trim();
    if body.ends_with(['.', '!', ',', ';']) || body.contains(". ") {
        return None;
    }
    if ends_colon || (words <= 6 && classify_heading(body) != "other" && !body.contains(',')) {
        return Some(body.to_string());
    }
    None
}

pub fn split_sections(text: &str) -> Vec<Section> {
    let mut out: Vec<Section> = Vec::new();
    let mut cur = Section { kind: "intro", heading: String::new(), lines: Vec::new() };
    for line in text.lines() {
        if let Some(h) = heading_text(line) {
            if !cur.lines.is_empty() || !cur.heading.is_empty() {
                out.push(cur);
            }
            cur = Section { kind: classify_heading(&h), heading: h, lines: Vec::new() };
        } else {
            let l = line.strip_prefix("- ").unwrap_or(line).trim();
            if !l.is_empty() {
                cur.lines.push(l.to_string());
            }
        }
    }
    if !cur.lines.is_empty() || !cur.heading.is_empty() {
        out.push(cur);
    }
    out.retain(|s| !s.lines.is_empty());
    out
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Facts {
    pub seniority: Option<&'static str>,
    pub years_min: Option<u32>,
    pub years_text: Option<String>,
    /// "not-offered" | "offered"
    pub sponsorship: Option<&'static str>,
    pub sponsorship_text: Option<String>,
    pub citizenship_text: Option<String>,
    pub clearance_text: Option<String>,
    /// "bachelor" | "master" | "phd"
    pub degree: Option<&'static str>,
}

fn sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.strip_prefix("- ").or_else(|| line.strip_prefix("## ")).unwrap_or(line);
        let mut cur = String::new();
        let chars: Vec<char> = line.chars().collect();
        for (i, &c) in chars.iter().enumerate() {
            cur.push(c);
            let next_space = chars.get(i + 1).is_none_or(|n| n.is_whitespace());
            if matches!(c, '.' | '!' | '?' | ';') && next_space {
                let t = cur.trim();
                // "U.S." / "e.g." are not sentence ends
                let abbrev = t.ends_with("U.S.") || t.ends_with("e.g.") || t.ends_with("i.e.") || t.ends_with("etc.") || t.ends_with("vs.");
                if !abbrev {
                    if !t.is_empty() {
                        out.push(t.to_string());
                    }
                    cur.clear();
                }
            }
        }
        let t = cur.trim();
        if !t.is_empty() {
            out.push(t.to_string());
        }
    }
    out
}

fn title_words(title: &str) -> Vec<String> {
    title.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect()
}

pub fn seniority(title: &str) -> Option<&'static str> {
    let w = title_words(title);
    let any = |xs: &[&str]| w.iter().any(|t| xs.contains(&t.as_str()));
    let t = format!(" {} ", w.join(" "));
    if any(&["intern", "internship", "coop"]) || t.contains(" co op ") {
        Some("intern")
    } else if t.contains(" head of ") || any(&["director", "vp", "vice", "chief", "cto", "ceo"]) {
        Some("director")
    } else if any(&["principal", "distinguished", "fellow"]) {
        Some("principal")
    } else if any(&["staff"]) {
        Some("staff")
    } else if any(&["manager", "mgr"]) {
        Some("manager")
    } else if any(&["lead"]) {
        Some("lead")
    } else if any(&["senior", "sr", "iii", "iv"]) {
        Some("senior")
    } else if any(&["junior", "jr", "entry", "graduate", "grad", "apprentice", "i"]) || t.contains(" new grad") || t.contains(" early career ") {
        Some("junior")
    } else if any(&["ii", "mid", "intermediate"]) {
        Some("mid")
    } else {
        None
    }
}

const NUMBER_WORDS: &[(&str, u32)] = &[("one", 1), ("two", 2), ("three", 3), ("four", 4), ("five", 5), ("six", 6), ("seven", 7), ("eight", 8), ("nine", 9), ("ten", 10), ("twelve", 12), ("fifteen", 15)];

/// The lower bound of an experience requirement in one sentence ("5+ years",
/// "3-5 years", "at least three years"), if the sentence is about experience.
fn years_in(sentence: &str) -> Option<u32> {
    let s = sentence.to_lowercase();
    if !(s.contains("experience") || s.contains("exp ") || s.contains("track record") || s.contains("background")) {
        return None;
    }
    let mut best: Option<u32> = None;
    let mut search = 0;
    while let Some(p) = s[search..].find("year") {
        let at = search + p;
        search = at + 4;
        let before: String = s[..at].chars().rev().take(24).collect::<Vec<_>>().into_iter().rev().collect();
        let tokens: Vec<&str> = before.split(|c: char| c.is_whitespace() || c == '(' || c == ')').filter(|t| !t.is_empty()).collect();
        // Look at the last few tokens for a number: "5+", "3-5", "3–5", "5", "five", "3 to 5".
        let mut found = None;
        for tok in tokens.iter().rev().take(4) {
            let tok = tok.trim_end_matches(['+', ',']);
            let first = tok.split(['-', '–', '—']).next().unwrap_or("");
            if let Ok(n) = first.trim_end_matches('+').parse::<u32>() {
                found = Some(n);
                break;
            }
            if let Some((_, n)) = NUMBER_WORDS.iter().find(|(w, _)| *w == first) {
                found = Some(*n);
                break;
            }
        }
        // "3 to 5 years": the number right before "to"
        if let Some(n) = found {
            let lb = if before.contains(" to ") {
                before.rsplit(" to ").nth(1).and_then(|b| b.split_whitespace().last()).and_then(|t| t.trim_end_matches('+').parse::<u32>().ok()).filter(|m| *m < n).unwrap_or(n)
            } else {
                n
            };
            if (1..=30).contains(&lb) {
                best = Some(best.map_or(lb, |b: u32| b.max(lb)));
            }
        }
    }
    best
}

fn has_negation(s: &str) -> bool {
    [" not ", "unable", "cannot", "can't", "can not", "won't", "will not", "n't ", " no ", "without", "ineligible", "does not", "do not", "not be "].iter().any(|n| s.contains(n))
        || s.starts_with("no ")
}

pub fn facts(title: &str, sections: &[Section], description: &str) -> Facts {
    let mut f = Facts { seniority: seniority(title), ..Default::default() };
    // Experience: from requirement-type sections first, never from "nice to have".
    let pick = |kinds: &[&str]| -> String {
        sections.iter().filter(|s| kinds.contains(&s.kind)).flat_map(|s| s.lines.iter().cloned()).collect::<Vec<_>>().join("\n")
    };
    let req = pick(&["requirements"]);
    let not_pref = pick(&["intro", "about", "responsibilities", "requirements", "other"]);
    for scope in [&req, &not_pref] {
        let mut best: Option<(u32, String)> = None;
        for s in sentences(scope) {
            if let Some(n) = years_in(&s) {
                if best.as_ref().is_none_or(|(b, _)| n > *b) {
                    best = Some((n, s));
                }
            }
        }
        if let Some((n, s)) = best {
            f.years_min = Some(n);
            f.years_text = Some(clip(&s, 200));
            break;
        }
    }
    for s in sentences(description) {
        let l = format!(" {} ", s.to_lowercase().replace(['’', '‘'], "'"));
        if f.sponsorship.is_none() && (l.contains("sponsor") || l.contains("h-1b") || l.contains("h1b") || l.contains(" visa")) {
            if l.contains("sponsor") && has_negation(&l) || (l.contains("h-1b") || l.contains("h1b") || l.contains(" visa")) && has_negation(&l) && l.contains("sponsor") {
                f.sponsorship = Some("not-offered");
                f.sponsorship_text = Some(clip(&s, 220));
            } else if l.contains("sponsor") && (l.contains("available") || l.contains("will sponsor") || l.contains("offer") || l.contains("provide") || l.contains("support") || l.contains("eligible")) {
                f.sponsorship = Some("offered");
                f.sponsorship_text = Some(clip(&s, 220));
            }
        }
        if f.citizenship_text.is_none() && (l.contains("u.s. citizen") || l.contains("us citizen") || l.contains("united states citizen") || l.contains("citizenship is required") || l.contains("must be a citizen")) {
            f.citizenship_text = Some(clip(&s, 220));
        }
        if f.clearance_text.is_none() && l.contains("clearance") && (l.contains("secret") || l.contains("security") || l.contains("ts/sci") || l.contains("active") || l.contains("obtain") || l.contains("public trust")) {
            f.clearance_text = Some(clip(&s, 220));
        }
    }
    let degree_scope = if req.is_empty() { description.to_lowercase() } else { req.to_lowercase() };
    let d = degree_scope.replace(['’', '‘'], "'");
    f.degree = if ["bachelor", "b.s.", "b.a.", "bs degree", "ba degree", "bs/ba", "ba/bs", "bs in", "undergraduate degree", "4-year degree", "four-year degree"].iter().any(|k| d.contains(k)) {
        Some("bachelor")
    } else if ["master's", "masters", "m.s.", "ms degree", "ms in", "mba"].iter().any(|k| d.contains(k)) {
        Some("master")
    } else if ["phd", "ph.d", "doctorate", "doctoral"].iter().any(|k| d.contains(k)) {
        Some("phd")
    } else {
        None
    };
    f
}

// ---------------------------------------------------------------------------
// Salary
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
pub struct Salary {
    pub currency: Option<String>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// "year" | "month" | "week" | "day" | "hour"
    pub unit: Option<String>,
    /// The words it was read from, when it came from the text.
    pub text: Option<String>,
    /// "jsonld" | "text"
    pub source: &'static str,
}

fn unit_of(s: &str) -> Option<String> {
    let l = s.to_lowercase();
    let u = if l.contains("hour") || l.contains("/hr") || l.contains("/ hr") || l.ends_with(" hr") || l.contains("hourly") {
        "hour"
    } else if l.contains("year") || l.contains("annual") || l.contains("/yr") || l.contains("/ yr") || l.contains("per annum") || l.contains(" pa") || l.contains("yearly") {
        "year"
    } else if l.contains("month") || l.contains("/mo") {
        "month"
    } else if l.contains("week") {
        "week"
    } else if l.contains("day") || l.contains("daily") {
        "day"
    } else {
        return None;
    };
    Some(u.into())
}

/// Parse "$120,000", "120k", "$62.50" starting at byte `i` (just after any currency sign).
fn amount_at(s: &str, i: usize) -> Option<(f64, usize)> {
    let b = s.as_bytes();
    let mut j = i;
    while j < b.len() && b[j] == b' ' {
        j += 1;
    }
    let start = j;
    while j < b.len() && (b[j].is_ascii_digit() || b[j] == b',' || b[j] == b'.') {
        j += 1;
    }
    let raw = s[start..j].trim_end_matches(['.', ',']);
    if raw.is_empty() || !raw.as_bytes()[0].is_ascii_digit() {
        return None;
    }
    let consumed = start + raw.len();
    let mut v: f64 = raw.replace(',', "").parse().ok()?;
    let mut end = consumed;
    let after = &s[consumed..];
    if after.starts_with(['k', 'K']) && !after[1..].starts_with(|c: char| c.is_ascii_alphabetic()) {
        v *= 1000.0;
        end += 1;
    } else {
        let a = after.trim_start().to_lowercase();
        if a.starts_with("million") || a.starts_with("billion") || a.starts_with("m ") || a.starts_with("bn") || a.starts_with("b ") || a.starts_with("m+") {
            return None;
        }
    }
    Some((v, end))
}

/// The first pay range in the text, like "$120,000 – $150,000 per year" or "USD 60-75/hr".
pub fn salary_from_text(text: &str) -> Option<Salary> {
    let signs: &[(&str, &str)] = &[("US$", "USD"), ("USD", "USD"), ("CA$", "CAD"), ("CAD", "CAD"), ("$", "USD"), ("£", "GBP"), ("GBP", "GBP"), ("€", "EUR"), ("EUR", "EUR"), ("₹", "INR"), ("INR", "INR")];
    for line in text.lines() {
        let mut idx = 0;
        while idx < line.len() {
            let rest = &line[idx..];
            let Some((pos, sign, cur)) = signs.iter().filter_map(|(sg, c)| rest.find(sg).map(|p| (p, *sg, *c))).min_by_key(|(p, sg, _)| (*p, usize::MAX - sg.len())) else { break };
            let at = idx + pos + sign.len();
            idx = at;
            let Some((lo, end)) = amount_at(line, at) else { continue };
            // Optional second amount: " - $150,000", "–150k", " to $150,000"
            let tail = &line[end..];
            let t = tail.trim_start();
            let mut hi = None;
            let mut span_end = end;
            for sep in ["-", "–", "—", "to "] {
                if let Some(after) = t.strip_prefix(sep) {
                    let after_trim = after.trim_start();
                    let skip_sign = signs.iter().find(|(sg, _)| after_trim.starts_with(sg)).map(|(sg, _)| sg.len()).unwrap_or(0);
                    let off = line.len() - after_trim.len() + skip_sign;
                    if let Some((v, e)) = amount_at(line, off) {
                        hi = Some(v);
                        span_end = e;
                    }
                    break;
                }
            }
            // "k" on the high side only ("120-150k"): scale the low side too.
            let (lo, hi) = match hi {
                Some(h) if h >= 1000.0 && lo < 1000.0 && line[..span_end].ends_with(['k', 'K']) => (lo * 1000.0, Some(h)),
                other => (lo, other),
            };
            if lo < 7.0 || hi.is_some_and(|h| h < lo) {
                continue;
            }
            let unit_window: String = line[span_end..].chars().take(28).collect();
            let unit = unit_of(&unit_window).or_else(|| if lo >= 1000.0 { Some("year".into()) } else { unit_of(line) });
            let start = line[..idx - sign.len()].len();
            let text: String = line[start..span_end].to_string() + unit_window.split([',', '.', ';', '(']).next().unwrap_or("").trim_end();
            return Some(Salary { currency: Some(cur.into()), min: Some(lo), max: hi.or(Some(lo)), unit, text: Some(collapse(&text)), source: "text" });
        }
    }
    None
}

// ---------------------------------------------------------------------------
// JSON-LD / microdata
// ---------------------------------------------------------------------------

fn parse_jsonld(raw: &str) -> Option<Value> {
    let t = raw.trim().trim_start_matches("<!--").trim_end_matches("-->").trim();
    let t = t.trim_start_matches("//<![CDATA[").trim_start_matches("<![CDATA[").trim_end_matches("//]]>").trim_end_matches("]]>").trim();
    serde_json::from_str(t).ok().or_else(|| {
        // Raw newlines and tabs inside strings are invalid JSON but common.
        let fixed: String = t.chars().map(|c| if c == '\n' || c == '\r' || c == '\t' { ' ' } else { c }).collect();
        serde_json::from_str(&fixed).ok()
    })
}

fn is_job_posting(v: &Value) -> bool {
    match v.get("@type") {
        Some(Value::String(s)) => s.ends_with("JobPosting"),
        Some(Value::Array(a)) => a.iter().any(|t| t.as_str().is_some_and(|s| s.ends_with("JobPosting"))),
        _ => false,
    }
}

fn collect_postings<'a>(v: &'a Value, depth: usize, out: &mut Vec<&'a Value>) {
    if depth > 8 {
        return;
    }
    match v {
        Value::Array(a) => a.iter().for_each(|x| collect_postings(x, depth + 1, out)),
        Value::Object(o) => {
            if is_job_posting(v) {
                out.push(v);
                return;
            }
            for (k, x) in o {
                if k != "description" {
                    collect_postings(x, depth + 1, out);
                }
            }
        }
        _ => {}
    }
}

/// Every JobPosting node in the page's JSON-LD blocks.
pub fn find_postings(blocks: &[String]) -> Vec<Value> {
    let parsed: Vec<Value> = blocks.iter().filter_map(|b| parse_jsonld(b)).collect();
    let mut found = Vec::new();
    for p in &parsed {
        collect_postings(p, 0, &mut found);
    }
    found.into_iter().cloned().collect()
}

fn text_of(v: &Value) -> Option<String> {
    let s = match v {
        Value::String(s) => decode_entities(s),
        Value::Number(n) => n.to_string(),
        Value::Object(o) => return o.get("name").and_then(text_of).or_else(|| o.get("@value").and_then(text_of)),
        Value::Array(a) => return a.iter().find_map(text_of),
        _ => return None,
    };
    let s = collapse(&s);
    (!s.is_empty()).then_some(s)
}

fn number_of(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.replace([',', '$', ' '], "").parse().ok(),
        _ => None,
    }
    .filter(|n: &f64| n.is_finite() && *n > 0.0)
}

fn as_list(v: Option<&Value>) -> Vec<&Value> {
    match v {
        Some(Value::Array(a)) => a.iter().collect(),
        Some(Value::Null) | None => vec![],
        Some(x) => vec![x],
    }
}

fn format_address(a: &Value) -> Option<String> {
    if let Value::String(s) = a {
        let s = collapse(&decode_entities(s));
        return (!s.is_empty()).then_some(s);
    }
    let mut parts: Vec<String> = Vec::new();
    for k in ["addressLocality", "addressRegion", "addressCountry"] {
        if let Some(t) = a.get(k).and_then(text_of) {
            if !parts.iter().any(|p| p.eq_ignore_ascii_case(&t)) {
                parts.push(t);
            }
        }
    }
    (!parts.is_empty()).then(|| parts.join(", "))
}

fn locations_of(p: &Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for place in as_list(p.get("jobLocation")) {
        let loc = match place {
            Value::String(_) => format_address(place),
            _ => as_list(place.get("address")).into_iter().find_map(format_address).or_else(|| place.get("name").and_then(text_of)),
        };
        if let Some(l) = loc {
            if !out.contains(&l) {
                out.push(l);
            }
        }
        if out.len() >= 12 {
            break;
        }
    }
    out
}

fn employment_types(p: &Value) -> Vec<String> {
    let mut out = Vec::new();
    let raw: Vec<String> = as_list(p.get("employmentType")).into_iter().filter_map(text_of).flat_map(|s| s.split(',').map(|x| x.trim().to_string()).collect::<Vec<_>>()).collect();
    for t in raw {
        let key = t.to_uppercase().replace([' ', '-'], "_");
        let label = match key.as_str() {
            "FULL_TIME" | "FULLTIME" => "Full-time".to_string(),
            "PART_TIME" | "PARTTIME" => "Part-time".to_string(),
            "CONTRACTOR" | "CONTRACT" => "Contract".to_string(),
            "TEMPORARY" => "Temporary".to_string(),
            "INTERN" | "INTERNSHIP" => "Internship".to_string(),
            "PER_DIEM" => "Per diem".to_string(),
            "VOLUNTEER" => "Volunteer".to_string(),
            "OTHER" | "" => continue,
            _ => t,
        };
        if !out.contains(&label) {
            out.push(label);
        }
    }
    out
}

fn salary_of(p: &Value) -> Option<Salary> {
    let amount = p.get("baseSalary").or_else(|| p.get("estimatedSalary"))?;
    let amount = match amount {
        Value::Array(a) => a.first()?,
        x => x,
    };
    let currency = amount.get("currency").and_then(text_of).or_else(|| p.get("salaryCurrency").and_then(text_of));
    let value = amount.get("value").unwrap_or(amount);
    let (min, max, unit) = match value {
        Value::Object(_) => {
            let single = value.get("value").and_then(number_of);
            let min = value.get("minValue").and_then(number_of).or(single);
            let max = value.get("maxValue").and_then(number_of).or(single).or(min);
            let unit = value.get("unitText").and_then(text_of).or_else(|| amount.get("unitText").and_then(text_of));
            (min, max, unit)
        }
        other => {
            let n = number_of(other);
            (n, n, amount.get("unitText").and_then(text_of))
        }
    };
    if min.is_none() && max.is_none() {
        return None;
    }
    let unit = unit.and_then(|u| unit_of(&u)).or_else(|| min.filter(|m| *m >= 1000.0).map(|_| "year".into()));
    Some(Salary { currency, min, max, unit, text: None, source: "jsonld" })
}

fn date_of(v: Option<&Value>) -> Option<String> {
    let s = text_of(v?)?;
    let d: String = s.chars().take(10).collect();
    (d.len() == 10 && d.as_bytes()[4] == b'-').then_some(d).or(Some(s))
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

/// What the content script sends: the raw material from the page.
#[derive(Deserialize, Default, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct PageInput {
    pub url: String,
    pub canonical: String,
    pub doc_title: String,
    pub h1: String,
    pub og_title: String,
    pub site_name: String,
    pub jsonld: Vec<String>,
    /// Microdata converted to JSON-LD shape by the content script.
    pub microdata: Option<Value>,
    /// The main content, one paragraph per line, `## ` headings, `- ` bullets.
    pub text: String,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Posting {
    pub id: String,
    pub url: String,
    /// "jsonld" | "microdata" | "page"
    pub source: &'static str,
    pub title: String,
    pub company: String,
    pub locations: Vec<String>,
    /// "remote" | "hybrid" | "onsite"
    pub workplace: Option<&'static str>,
    pub employment_type: Vec<String>,
    pub salary: Option<Salary>,
    pub date_posted: Option<String>,
    pub valid_through: Option<String>,
    pub applicant_locations: Vec<String>,
    pub description: String,
    pub sections: Vec<Section>,
    pub facts: Facts,
    pub words: usize,
    /// How many JobPosting entries the page carries (more than one means a list).
    pub postings_on_page: usize,
}

/// FNV-1a, 64-bit: a stable id for a posting URL.
fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// The URL without its fragment and tracking parameters, so revisits match.
pub fn canonical_url(url: &str) -> String {
    let url = url.split('#').next().unwrap_or("");
    let (base, query) = match url.split_once('?') {
        Some((b, q)) => (b, q),
        None => (url, ""),
    };
    let keep: Vec<&str> = query
        .split('&')
        .filter(|kv| {
            let k = kv.split('=').next().unwrap_or("").to_ascii_lowercase();
            !k.is_empty() && !k.starts_with("utm_") && !["ref", "source", "src", "gclid", "fbclid", "lever-source", "lever-origin", "trk", "refid", "trackingid"].contains(&k.as_str())
        })
        .collect();
    let base = base.trim_end_matches('/');
    let base = match base.find("://") {
        Some(p) => {
            let (scheme, rest) = base.split_at(p + 3);
            let (host, path) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
            format!("{}{}{}", scheme.to_ascii_lowercase(), host.to_ascii_lowercase(), path)
        }
        None => base.to_string(),
    };
    if keep.is_empty() { base } else { format!("{base}?{}", keep.join("&")) }
}

fn workplace(p: Option<&Value>, title: &str, locations: &[String], description: &str) -> Option<&'static str> {
    if let Some(p) = p {
        let t = p.get("jobLocationType").and_then(text_of).unwrap_or_default().to_uppercase();
        if t.contains("TELECOMMUTE") {
            return Some("remote");
        }
    }
    let head: String = description.chars().take(700).collect();
    let hay = format!("{} | {} | {}", title, locations.join(" | "), head).to_lowercase();
    if hay.contains("hybrid") {
        Some("hybrid")
    } else if (hay.contains("remote") || hay.contains("work from home") || hay.contains("wfh")) && !hay.contains("not remote") && !hay.contains("no remote") && !hay.contains("non-remote") {
        Some("remote")
    } else if hay.contains("on-site") || hay.contains("onsite") || hay.contains("in-office") || hay.contains("in office") || hay.contains("on site") {
        Some("onsite")
    } else {
        None
    }
}

/// Clean one posting out of what the page offers.
pub fn extract(input: &PageInput) -> Posting {
    // The address bar, not <link rel=canonical>: some sites point every job at the careers home.
    let url = if input.url.trim().is_empty() { input.canonical.trim() } else { input.url.trim() };
    let mut postings = find_postings(&input.jsonld);
    let postings_on_page = postings.len();
    let mut source = "page";
    // With several, prefer the one whose title is the page heading.
    let h1 = collapse(&input.h1).to_lowercase();
    let chosen: Option<Value> = if postings.is_empty() {
        input.microdata.clone().filter(|m| m.is_object()).inspect(|_| source = "microdata")
    } else {
        source = "jsonld";
        let idx = postings.iter().position(|p| p.get("title").and_then(text_of).is_some_and(|t| !h1.is_empty() && t.to_lowercase() == h1)).unwrap_or(0);
        Some(postings.swap_remove(idx))
    };
    let p = chosen.as_ref();

    let (label_company, label_role) = derive_labels(url, if input.doc_title.is_empty() { &input.og_title } else { &input.doc_title });
    let title = p
        .and_then(|p| p.get("title").or_else(|| p.get("name")).and_then(text_of))
        .or_else(|| Some(collapse(&input.h1)).filter(|s| !s.is_empty() && s.chars().count() <= 140))
        .or_else(|| Some(collapse(&input.og_title)).filter(|s| !s.is_empty()))
        .unwrap_or(label_role);
    let company = p
        .and_then(|p| p.get("hiringOrganization").and_then(text_of))
        .or_else(|| Some(collapse(&input.site_name)).filter(|s| !s.is_empty()))
        .unwrap_or(label_company);

    let structured = p.and_then(|p| p.get("description")).and_then(|d| d.as_str()).map(html_to_text).unwrap_or_default();
    let page_text = tidy_lines(&input.text);
    let description = if structured.chars().count() >= 200 || page_text.chars().count() < structured.chars().count() { structured } else { page_text };
    let description: String = if description.chars().count() > 40_000 { description.chars().take(40_000).collect() } else { description };

    let sections = split_sections(&description);
    let locations = p.map(locations_of).unwrap_or_default();
    let salary = p.and_then(salary_of).or_else(|| {
        let comp: String = sections.iter().filter(|s| s.kind == "compensation").flat_map(|s| s.lines.iter().cloned()).collect::<Vec<_>>().join("\n");
        salary_from_text(&comp).or_else(|| salary_from_text(&description))
    });
    let applicant_locations = p
        .map(|p| as_list(p.get("applicantLocationRequirements")).into_iter().filter_map(text_of).collect())
        .unwrap_or_default();
    let words = description.split_whitespace().count();
    Posting {
        id: format!("{:016x}", fnv1a(&canonical_url(url))),
        url: url.to_string(),
        source,
        workplace: workplace(p, &title, &locations, &description),
        employment_type: p.map(employment_types).unwrap_or_default(),
        date_posted: p.and_then(|p| date_of(p.get("datePosted"))),
        valid_through: p.and_then(|p| date_of(p.get("validThrough"))),
        facts: facts(&title, &sections, &description),
        title: clip(&title, 160),
        company: clip(&company, 100),
        locations,
        salary,
        applicant_locations,
        sections,
        description,
        words,
        postings_on_page,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_to_text_keeps_headings_and_bullets() {
        let html = "<h2>About the role</h2><p>We build&nbsp;payments.</p><h3>Requirements</h3><ul><li><p>5+ years of Rust</p></li><li>Kubernetes &amp; AWS</li></ul><script>x()</script><p>Bye<br>now</p>";
        assert_eq!(html_to_text(html), "## About the role\nWe build payments.\n## Requirements\n- 5+ years of Rust\n- Kubernetes & AWS\nBye\nnow");
    }

    #[test]
    fn html_to_text_decodes_escaped_html_first() {
        assert_eq!(html_to_text("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;&lt;ul&gt;&lt;li&gt;One&lt;/li&gt;&lt;/ul&gt;"), "Hello & welcome\n- One");
        assert_eq!(html_to_text("a < b and c > d"), "a < b and c > d");
    }

    #[test]
    fn sections_from_markup_and_from_plain_headings() {
        let text = "We are Acme.\n## What you'll do\n- Ship features\nRequirements:\n- 3-5 years of experience with Python\nPreferred Qualifications\n- Go\nBenefits\n- Health";
        let s = split_sections(text);
        let kinds: Vec<_> = s.iter().map(|x| x.kind).collect();
        assert_eq!(kinds, ["intro", "responsibilities", "requirements", "preferred", "benefits"]);
        assert_eq!(s[2].lines, ["3-5 years of experience with Python"]);
        // A short sentence that mentions experience is not a heading.
        assert!(split_sections("Experience with Python, Go").iter().all(|x| x.kind == "intro"));
    }

    #[test]
    fn facts_read_years_sponsorship_clearance_degree() {
        let text = "## Requirements\n- 5+ years of experience building backend systems.\n- 2+ years of experience with Kubernetes.\n- Bachelor's degree in CS or equivalent.\n## Nice to have\n- 10+ years of experience leading teams.\n## Other\nWe are unable to sponsor visas now or in the future. Must be able to obtain a Secret security clearance.";
        let s = split_sections(text);
        let f = facts("Senior Software Engineer", &s, text);
        assert_eq!(f.seniority, Some("senior"));
        assert_eq!(f.years_min, Some(5), "the 10+ years is only preferred");
        assert_eq!(f.sponsorship, Some("not-offered"));
        assert!(f.clearance_text.unwrap().contains("Secret"));
        assert_eq!(f.degree, Some("bachelor"));
        let f2 = facts("Engineer", &[], "Visa sponsorship is available for this role. Three to five years of experience.");
        assert_eq!(f2.sponsorship, Some("offered"));
        assert_eq!(f2.years_min, None, "number words need an experience sentence in the right scope");
        assert_eq!(years_in("At least three years of professional experience"), Some(3));
        assert_eq!(years_in("3 to 5 years of experience"), Some(3));
        assert_eq!(years_in("Founded 10 years ago"), None);
    }

    #[test]
    fn seniority_from_title_words() {
        assert_eq!(seniority("Internal Tools Engineer"), None);
        assert_eq!(seniority("Software Engineering Intern"), Some("intern"));
        assert_eq!(seniority("Staff ML Engineer"), Some("staff"));
        assert_eq!(seniority("Software Engineer II"), Some("mid"));
        assert_eq!(seniority("Sr. Data Scientist"), Some("senior"));
        assert_eq!(seniority("Head of Design"), Some("director"));
    }

    #[test]
    fn salary_from_text_ranges() {
        let s = salary_from_text("The base pay range is $120,000 - $150,000 per year plus equity.").unwrap();
        assert_eq!((s.min, s.max, s.unit.as_deref(), s.currency.as_deref()), (Some(120000.0), Some(150000.0), Some("year"), Some("USD")));
        let s = salary_from_text("Pay: $45.50 – $60/hour").unwrap();
        assert_eq!((s.min, s.max, s.unit.as_deref()), (Some(45.5), Some(60.0), Some("hour")));
        let s = salary_from_text("Salary £60k to £75k").unwrap();
        assert_eq!((s.min, s.max, s.currency.as_deref()), (Some(60000.0), Some(75000.0), Some("GBP")));
        let s = salary_from_text("USD 120-150k annually").unwrap();
        assert_eq!((s.min, s.max), (Some(120000.0), Some(150000.0)));
        assert!(salary_from_text("We raised $50 million and offer a 401(k).").is_none());
    }

    #[test]
    fn jsonld_posting_fields() {
        let ld = r#"{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"X"},{"@type":["JobPosting"],"title":"Backend Engineer &amp; SRE","hiringOrganization":{"@type":"Organization","name":"Acme"},
          "jobLocation":[{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Austin","addressRegion":"TX","addressCountry":{"name":"US"}}},{"@type":"Place","address":"Remote, US"}],
          "jobLocationType":"TELECOMMUTE","employmentType":["FULL_TIME","CONTRACTOR"],"datePosted":"2026-11-02T10:00:00Z",
          "baseSalary":{"@type":"MonetaryAmount","currency":"USD","value":{"@type":"QuantitativeValue","minValue":"140,000","maxValue":180000,"unitText":"YEAR"}},
          "description":"<p>Hello</p>
<h3>Requirements</h3><ul><li>4+ years of experience with Go</li></ul>"}]}"#;
        let input = PageInput { url: "https://acme.com/jobs/1?utm_source=x#top".into(), jsonld: vec![ld.into()], ..Default::default() };
        let p = extract(&input);
        assert_eq!(p.source, "jsonld");
        assert_eq!(p.title, "Backend Engineer & SRE");
        assert_eq!(p.company, "Acme");
        assert_eq!(p.locations, ["Austin, TX, US", "Remote, US"]);
        assert_eq!(p.workplace, Some("remote"));
        assert_eq!(p.employment_type, ["Full-time", "Contract"]);
        assert_eq!(p.date_posted.as_deref(), Some("2026-11-02"));
        let s = p.salary.unwrap();
        assert_eq!((s.min, s.max, s.unit.as_deref()), (Some(140000.0), Some(180000.0), Some("year")));
        assert_eq!(p.facts.years_min, Some(4));
        assert_eq!(p.id, format!("{:016x}", fnv1a("https://acme.com/jobs/1")));
    }

    #[test]
    fn page_fallback_and_listing_count() {
        let input = PageInput {
            url: "https://boards.greenhouse.io/acme/jobs/9".into(),
            doc_title: "Job Application for Data Engineer at Acme".into(),
            h1: "Data Engineer".into(),
            text: "## Responsibilities\n- Build pipelines\n## Qualifications\n- SQL".into(),
            ..Default::default()
        };
        let p = extract(&input);
        assert_eq!((p.source, p.title.as_str(), p.company.as_str()), ("page", "Data Engineer", "Acme"));
        assert_eq!(p.sections.len(), 2);
        let two = r#"[{"@type":"JobPosting","title":"A"},{"@type":"JobPosting","title":"B"}]"#;
        let p = extract(&PageInput { jsonld: vec![two.into()], h1: "B".into(), ..Default::default() });
        assert_eq!((p.postings_on_page, p.title.as_str()), (2, "B"));
    }

    #[test]
    fn canonical_url_drops_tracking() {
        assert_eq!(canonical_url("HTTPS://Jobs.Example.com/a/b/?gh_jid=12&utm_source=li&ref=x#apply"), "https://jobs.example.com/a/b?gh_jid=12");
    }
}
