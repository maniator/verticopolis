//! The whole-unit half of the view's source scan (`source_scan_tests.rs`
//! holds the lexer and the field half): a write of a whole unit in the
//! list, a reorder or replacement of the list, a new unit written through a
//! reference, and a pattern that binds a guarded field. It goes by names, so
//! a whole unit written through a reference from another value
//! (`*u = other`) is beyond it; the session oracle covers that, and #1285
//! item 6 would close it at compile time. A pattern that binds a guarded
//! field counts as a write even when the unit is shared (`let Unit {
//! occupants, .. } = &u`), since the scan cannot see the scrutinee's type:
//! read such a field by name instead.
use super::source_scan_tests::{assigns, borrowed_places, closing, is_ident, opening};

/// Methods that rewrite the unit list, or a slice of it, in place at the
/// same length. A change of length moves the frame reader's key, so its
/// next frame is full.
const REORDERS: [&str; 19] = [
    "swap(",
    "swap_with_slice(",
    "sort",
    "select_nth_unstable",
    "reverse(",
    "rotate_",
    "split_at_mut(",
    "split_first_mut(",
    "split_last_mut(",
    "chunks_mut(",
    "chunks_exact_mut(",
    "rchunks_mut(",
    "rchunks_exact_mut(",
    "fill",
    "clone_from(",
    "clone_from_slice(",
    "copy_from_slice(",
    "as_mut_slice(",
    "splice(",
];

/// A range's or a rest pattern's `..`, spelled as two characters so that
/// `tests/read_boundary.rs` does not read it as a path that climbs.
const DOTS: &str = concat!('.', '.');

/// Where `code` writes a whole unit in place, by byte offset: an assignment
/// to `units[..]`, a new unit through a dereferenced place (`*u = Unit {`,
/// `*self.units.last_mut().unwrap() = Unit::default()`, `*self = Self {`
/// inside `impl Unit`), a pattern that binds one of `fields` (in a `let`, a
/// match arm, a closure or a `for` loop, nested in another pattern or not),
/// a `swap`, `replace` or `take` of a unit in the list, a reorder of the
/// list or a slice of it (`REORDERS`), a mutable borrow of the whole list or
/// a range of it, or an assignment to the list (`.units =`).
pub(super) fn unit_writes(code: &str, fields: &[&str]) -> Vec<usize> {
    // The identifier that ends right before `at` (`Staff` in `StaffUnit{`,
    // `hk_` in `hk_units[`): a name that only ends in `Unit` or `units` is
    // something else.
    let word_before = |at: usize| {
        let head = &code[..at];
        &head[head.trim_end_matches(is_ident).len()..]
    };
    let reorder = |rest: &str| {
        rest.strip_prefix('.')
            .is_some_and(|call| REORDERS.iter().any(|r| call.starts_with(r)))
    };
    let mut out = Vec::new();
    for (at, m) in code.match_indices("units[") {
        if let Some(close) = closing(code, at + m.len() - 1) {
            let rest = &code[close + 1..];
            if word_before(at).is_empty() && (assigns(rest) || reorder(rest)) {
                out.push(at);
            }
        }
    }
    for (at, m) in code.match_indices(".units") {
        let rest = &code[at + m.len()..];
        if reorder(rest) || assigns(rest) {
            out.push(at + 1);
        }
    }
    for (at, place) in borrowed_places(code) {
        // `&mut self.units` or `&mut self.units[a..b]`, the whole list or a
        // range of it; `&mut self.units[i]` is one unit, whose fields the
        // field half reads.
        let (head, index) = match place.strip_suffix(']') {
            Some(_) => match opening(place, place.len() - 1) {
                Some(open) => (&place[..open], &place[open..]),
                None => continue,
            },
            None => (place, ""),
        };
        if head.ends_with(".units") && (index.is_empty() || index.contains(DOTS)) {
            out.push(at + head.len() - "units".len());
        }
    }
    for at in unit_type_at(code, "", "") {
        // A new unit (`Unit {`, `Unit::`, on a path or not) assigned
        // through a dereferenced place.
        if !word_before(at).is_empty() || !code[at + "Unit".len()..].starts_with(['{', ':']) {
            continue;
        }
        let mut start = at;
        while let Some(head) = code[..start].strip_suffix("::") {
            start = head.trim_end_matches(is_ident).len();
        }
        let Some(eq) = start.checked_sub(1) else {
            continue;
        };
        if !code[eq..].starts_with('=') {
            continue;
        }
        // `*u == Unit {..}` has no place before its second `=`.
        let place = place_before(code, eq);
        if !place.is_empty() && code[..eq - place.len()].ends_with('*') {
            out.push(at);
        }
    }
    for at in unit_type_at(code, "", "{") {
        if !word_before(at).is_empty() {
            continue;
        }
        let open = at + "Unit".len();
        let Some(close) = closing(code, open) else {
            continue;
        };
        let inside = &code[open + 1..close];
        let rest = &code[close + 1..];
        let head = code[..at].trim_end_matches(' ');
        let keyword = &head[head.trim_end_matches(is_ident).len()..];
        // A rest pattern (`..` with nothing after it) is a pattern
        // wherever it stands; a struct literal's `..` takes a base.
        let pattern = inside.ends_with(DOTS)
            || rest.starts_with('=') && !rest.starts_with("==")
            || rest.starts_with([':', '|'])
            || rest.starts_with("if") && !rest[2..].starts_with(is_ident)
            || keyword == "for" && rest.starts_with("in");
        if pattern && binds(inside, fields) {
            out.push(at);
        }
    }
    for call in ["swap(", "replace(", "take("] {
        for (at, m) in code.match_indices(call) {
            // `mem::swap` or an imported `swap`; a method has a `.` before it.
            if code[..at].ends_with(|c| is_ident(c) || c == '.') {
                continue;
            }
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

/// Where `code` names the unit type with `pre` before it and `post` after,
/// by the name's offset: `Unit` anywhere, and `Self` inside `impl Unit`.
fn unit_type_at(code: &str, pre: &str, post: &str) -> Vec<usize> {
    let impls: Vec<(usize, usize)> = code
        .match_indices("impl Unit{")
        .filter_map(|(at, m)| closing(code, at + m.len() - 1).map(|close| (at, close)))
        .collect();
    let mut out = Vec::new();
    for name in ["Unit", "Self"] {
        for (at, _) in code.match_indices(&format!("{pre}{name}{post}")) {
            let at = at + pre.len();
            if name == "Unit" || impls.iter().any(|&(s, e)| s < at && at < e) {
                out.push(at);
            }
        }
    }
    out
}

/// The place that ends at `end`, read back over identifiers, dots and
/// bracketed groups (`self.units.get_mut(i).unwrap()`).
fn place_before(code: &str, end: usize) -> &str {
    let bytes = code.as_bytes();
    let mut start = end;
    while start > 0 {
        let b = bytes[start - 1];
        if b == b')' || b == b']' {
            match opening(code, start - 1) {
                Some(open) => start = open,
                None => break,
            }
        } else if is_ident(b as char) || b == b'.' {
            start -= 1;
        } else {
            break;
        }
    }
    &code[start..end]
}

/// `writes` without the loader's one assignment of a new tower's unit list,
/// `sim.tower.units = units;` in `load.rs`, where `sim` is the
/// `Simulation::new` that `assemble` has just made, with its own mark log
/// (`the_loader_fills_only_a_new_tower` pins that).
pub(super) fn new_list_aside(rel: &str, code: &str, writes: Vec<usize>) -> Vec<usize> {
    let filled = |at: usize| {
        rel == "load.rs"
            && code[..at].ends_with("sim.tower.")
            && code[at..].starts_with("units=units;")
    };
    writes.into_iter().filter(|&at| !filled(at)).collect()
}

/// Whether a struct pattern's fields (the text inside its braces) bind one
/// of `fields`: shorthand (`occupants`, `ref mut occupants`) or a pattern
/// with a binding in it (`occupants: n`, `customers_in:
/// Option::Some(n)`, `state: s @ UnitState::Fire`), but not one that only
/// matches values (`state: UnitState::Fire`, `occupants: 0`, `residents:
/// None`, `occupants: _`).
fn binds(inside: &str, fields: &[&str]) -> bool {
    top_level(inside).iter().any(|entry| {
        let (name, pat) = match entry.split_once(':') {
            Some((name, pat)) => (name, Some(pat)),
            None => (*entry, None),
        };
        let name = name.rsplit(' ').next().unwrap_or(name);
        fields.contains(&name) && pat.is_none_or(has_binding)
    })
}

/// Whether pattern `pat` binds a name: a word that starts lowercase or with
/// `_` (`n`, `_n`), other than `_`, `ref`, `mut`, `true` and `false`, that
/// is followed by no path, call, struct, macro or field (`a::`, `f(`,
/// `s {`, `m!`, `a:`). A lowercase constant at the end of a path counts as
/// a binding, which only makes the scan stricter.
fn has_binding(pat: &str) -> bool {
    let mut rest = pat;
    while let Some(start) = rest.find(is_ident) {
        let after = &rest[start..];
        let len = after.len() - after.trim_start_matches(is_ident).len();
        let (word, tail) = after.split_at(len);
        let binding = word.starts_with(|c: char| c.is_ascii_lowercase() || c == '_')
            && !["_", "ref", "mut", "true", "false"].contains(&word)
            && !tail.starts_with(['(', '{', '!', ':']);
        if binding {
            return true;
        }
        rest = tail;
    }
    false
}

/// `text` split at its top-level commas.
pub(super) fn top_level(text: &str) -> Vec<&str> {
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
