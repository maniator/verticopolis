//! The whole-unit half of the view's source scan (`source_scan_tests.rs`
//! holds the lexer and the field half): a write of a whole unit in the
//! list, a reorder or replacement of the list, a new unit written through a
//! reference, and a pattern that binds a frame field. It goes by names, so
//! a whole unit written through a reference from another value
//! (`*u = other`) is beyond it. The session oracle covers that, and making
//! the frame fields private to their setters would close it (#1285 item 6).
use super::source_scan_tests::{assigns, closing, is_ident};

/// Keywords that can stand right before a pattern (`let Unit {`, squeezed
/// to `letUnit{`).
const PATTERN_KEYWORDS: [&str; 6] = ["let", "iflet", "whilelet", "elseiflet", "for", "mut"];

/// Methods that rewrite the unit list in place at the same length. A change
/// of length moves the frame reader's key, so its next frame is full.
const REORDERS: [&str; 13] = [
    "swap(",
    "swap_with_slice(",
    "sort",
    "reverse(",
    "rotate_",
    "split_at_mut(",
    "split_first_mut(",
    "split_last_mut(",
    "chunks",
    "fill",
    "clone_from_slice(",
    "copy_from_slice(",
    "as_mut_slice(",
];

/// Where `code` writes a whole unit in place, by byte offset: an assignment
/// to `units[..]`, a new unit through a dereferenced binding (`*u = Unit {`
/// or `*u = Unit::`), a pattern that binds one of `fields` (`let`, a match
/// arm, a closure or a `for` loop), a `clone_from` into a unit in the list,
/// a `mem::swap`, `mem::replace` or `mem::take` of one, a reorder of the
/// list (`REORDERS`), or an assignment to the list (`.units =`).
pub(super) fn unit_writes(code: &str, fields: &[&str]) -> Vec<usize> {
    // The identifier that ends right before `at` (`let` in `letUnit{`).
    let word_before = |at: usize| {
        let head = &code[..at];
        &head[head.trim_end_matches(is_ident).len()..]
    };
    // A name that only ends in `units` or `Unit` (`hk_units`, `StaffUnit`)
    // is something else.
    let starts_word = |at: usize| word_before(at).is_empty();
    let mut out = Vec::new();
    for (at, m) in code.match_indices("units[") {
        if let Some(close) = closing(code, at + m.len() - 1) {
            let rest = &code[close + 1..];
            if starts_word(at) && (assigns(rest) || rest.starts_with(".clone_from(")) {
                out.push(at);
            }
        }
    }
    for (at, m) in code.match_indices(".units") {
        let rest = &code[at + m.len()..];
        let reorder = rest
            .strip_prefix('.')
            .is_some_and(|call| REORDERS.iter().any(|r| call.starts_with(r)));
        if reorder || assigns(rest) {
            out.push(at + 1);
        }
    }
    for (at, m) in code.match_indices("=Unit") {
        let place = word_before(at);
        let new = code[at + m.len()..].starts_with(['{', ':']);
        if new && !place.is_empty() && code[..at - place.len()].ends_with('*') {
            out.push(at + 1);
        }
    }
    for (at, m) in code.match_indices("Unit{") {
        let word = word_before(at);
        if !(word.is_empty() || PATTERN_KEYWORDS.contains(&word)) {
            continue;
        }
        let Some(close) = closing(code, at + m.len() - 1) else {
            continue;
        };
        let statement = code[..at].rfind([';', '{', '}']).map_or(0, |s| s + 1);
        if code[statement..at].starts_with("impl") {
            continue;
        }
        let rest = &code[close + 1..];
        let pattern = rest.starts_with('=') && !rest.starts_with("==")
            || rest.starts_with([':', '|'])
            || word == "for" && rest.starts_with("in");
        if pattern && binds(&code[at + m.len()..close], fields) {
            out.push(at);
        }
    }
    for call in ["mem::swap(", "mem::replace(", "mem::take("] {
        for (at, m) in code.match_indices(call) {
            if let Some(close) = closing(code, at + m.len() - 1) {
                let args = top_level(&code[at + m.len()..close]);
                if args
                    .iter()
                    .any(|a| a.contains("units[") && a.ends_with(']'))
                {
                    out.push(at);
                }
            }
        }
    }
    out.sort_unstable();
    out
}

/// `writes` without the loader's assignment of a new tower's unit list
/// (`load.rs` fills a tower it has just made, with its own mark log).
pub(super) fn new_list_aside(rel: &str, code: &str, writes: Vec<usize>) -> Vec<usize> {
    let filled = |at: usize| rel == "load.rs" && code[at..].starts_with("units=");
    writes.into_iter().filter(|&at| !filled(at)).collect()
}

/// Whether a struct pattern's fields (the text inside its braces) bind one
/// of `fields`: shorthand (`occupants`, `ref mut occupants`) or a binding
/// pattern (`occupants: n`, `customers_in: Some(n)`), but not a value it
/// matches (`state: UnitState::Fire`, `occupants: 0`, `residents: None`).
fn binds(inside: &str, fields: &[&str]) -> bool {
    top_level(inside).iter().any(|entry| {
        let (name, pat) = entry.split_once(':').unwrap_or((entry, ""));
        let name = name.trim_start_matches("ref").trim_start_matches("mut");
        let value = pat.starts_with(|c: char| c.is_ascii_digit() || c.is_ascii_uppercase())
            && !pat.contains('(')
            || pat.contains("::")
            || pat == "_";
        fields.contains(&name) && !value
    })
}

/// `text` split at its top-level commas.
fn top_level(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut depth = 0usize;
    let mut start = 0;
    for (i, b) in text.bytes().enumerate() {
        match b {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            b',' if depth == 0 => {
                out.push(&text[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(&text[start..]);
    out
}
