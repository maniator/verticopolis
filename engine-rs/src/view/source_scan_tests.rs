//! The source scan the view's write guards share (`marks_guard_tests.rs`
//! for the frame fields, `meta_tests.rs` for labels and subtypes), over the
//! code `lexer_tests.rs` reads.
//!
//! What this half finds is a write in place of a named field: an
//! assignment (compound and destructuring included), a method call that is
//! not on the field's list of reads, a `&mut` borrow, a `ref mut` binding,
//! and a write through a binding of the field's own name.
//! `unit_scan_tests.rs` finds the writes of a whole unit. Both go by names,
//! so they catch the ordinary ways to write a field; the session oracle
//! checks every frame against a full compare, and #1285 item 6 would make
//! the fields private to their setters.
pub(super) use super::lexer_tests::{engine_sources, squeeze};

pub(super) fn is_ident(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// The assignment operators, longest first so `<<=` is not read as `<=`.
const ASSIGNS: [&str; 11] = [
    "<<=", ">>=", "+=", "-=", "*=", "/=", "%=", "|=", "&=", "^=", "=",
];

/// How a guarded field's method calls are judged.
pub(super) enum Calls<'a> {
    /// Only these methods read the field; any other call writes it.
    Reading(&'a [&'a str]),
    /// The field's type is `Copy` and its own methods take `self`, so only
    /// these methods, and the operator traits' `*_assign`, write it.
    Writing(&'a [&'a str]),
}

impl Calls<'_> {
    /// Whether `rest`, the code after a place, calls a method that writes
    /// it (`.take()`, `.add_assign(1)`, `.get_or_insert::<..>`).
    fn write(&self, rest: &str) -> bool {
        let Some(call) = rest.strip_prefix('.') else {
            return false;
        };
        let name = &call[..call.len() - call.trim_start_matches(is_ident).len()];
        let after = &call[name.len()..];
        if name.is_empty() || !(after.starts_with('(') || after.starts_with("::")) {
            return false;
        }
        match self {
            Calls::Reading(reads) => !reads.contains(&name),
            Calls::Writing(writes) => writes.contains(&name) || name.ends_with("_assign"),
        }
    }
}

/// Where `code` writes `.field` in place, by byte offset of the field's
/// `.`: an assignment (a destructuring one too), a method call that
/// `calls` counts as a write, a `&mut` borrow of it (`&raw mut` and
/// `addr_of_mut!` too), or a `ref mut` binding of it. `skip` sees the
/// offset and drops a write that is not a room's (a person's `state`, a
/// local probe).
pub(super) fn field_writes(
    code: &str,
    field: &str,
    calls: &Calls,
    skip: &dyn Fn(usize) -> bool,
) -> Vec<usize> {
    let dotted = format!(".{field}");
    // The field's own offsets, so `.state` never matches `.states`.
    let at_field = |s: &str, base: usize| -> Vec<usize> {
        s.match_indices(&dotted)
            .filter(|(i, m)| !s[i + m.len()..].starts_with(is_ident))
            .map(|(i, _)| base + i)
            .collect()
    };
    let mutated = |rest: &str| assigns(rest) || calls.write(rest);
    let mut out = Vec::new();
    for at in at_field(code, 0) {
        // Past any indexing of the field (`u.label[..1].make_ascii_uppercase()`).
        let mut after = at + dotted.len();
        while let Some(close) = code[after..]
            .starts_with('[')
            .then(|| closing(code, after))
            .flatten()
        {
            after = close + 1;
        }
        if mutated(&code[after..]) || in_assigned_tuple(code, after) {
            out.push(at);
        }
    }
    for mac in ["write!(", "writeln!("] {
        // The macros call `write_fmt` on their first argument, a place.
        for (at, m) in code.match_indices(mac) {
            let place = place_at(code, at + m.len());
            if place.ends_with(&dotted) {
                out.push(at + m.len() + place.len() - dotted.len());
            }
        }
    }
    for (at, place) in borrowed_places(code) {
        if place.ends_with(&dotted) {
            out.push(at + place.len() - dotted.len());
        }
    }
    for (at, _) in code.match_indices("ref mut ") {
        // The statement's scrutinee, from its start up to the binding
        // (`match u.field { Some(ref mut n) =>`), or the value after the
        // pattern's `=` (`if let Some(ref mut n) = u.field {`).
        let start = code[..at].rfind(';').map_or(0, |s| s + 1);
        out.extend(at_field(&code[start..at], start));
        if let Some(eq) = code[at..].find('=') {
            let value_at = at + eq + 1;
            let value = place_at(code, value_at);
            if value.ends_with(&dotted) {
                out.push(value_at + value.len() - dotted.len());
            }
        }
    }
    // A write through a binding of the field's name (`*occupants = 0`
    // after `let Unit { occupants, .. } = u`).
    for (at, m) in code.match_indices(&format!("*{field}")) {
        let before = code[..at].ends_with(is_ident);
        let rest = &code[at + m.len()..];
        if !before && !rest.starts_with(is_ident) && mutated(rest) {
            out.push(at);
        }
    }
    out.retain(|&at| !skip(at));
    out.sort_unstable();
    out.dedup();
    out
}

/// Every place `code` borrows mutably, with its offset: `&mut place`,
/// `&raw mut place` and `addr_of_mut!(place)`, a place in parentheses read
/// inside them (`&mut (u.occupants)`).
pub(super) fn borrowed_places(code: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    for borrow in ["&mut", "&raw mut", "addr_of_mut!("] {
        for (at, m) in code.match_indices(borrow) {
            let mut start = at + m.len();
            if borrow.ends_with('t') {
                // `&mut x`, `&mut(x)` or `&mut[..]`, never `&mutable`.
                match code[start..].chars().next() {
                    Some(' ') => start += 1,
                    Some('(' | '[') => {}
                    _ => continue,
                }
            }
            let mut place = place_at(code, start);
            while place.starts_with('(') && closing(code, start) == Some(start + place.len() - 1) {
                start += 1;
                place = place_at(code, start);
            }
            out.push((start, place));
        }
    }
    out
}

/// Whether `rest`, the code after a place, starts with an assignment.
pub(super) fn assigns(rest: &str) -> bool {
    ASSIGNS.iter().any(|op| rest.starts_with(op))
        && !rest.starts_with("==")
        && !rest.starts_with("=>")
}

/// Whether the place ending at `after` sits in a tuple, an array or a
/// struct that is assigned to (`(u.occupants, n) = (0, 1)`, `[u.occupants,
/// n] = ..`, `S { a: u.occupants, .. } = s`), however deeply nested.
fn in_assigned_tuple(code: &str, after: usize) -> bool {
    let bytes = code.as_bytes();
    let mut depth = 0usize;
    let mut i = after;
    while i < bytes.len() {
        match bytes[i] {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' if depth > 0 => depth -= 1,
            // An index (`a[u.kind as usize] += 1`) is no array.
            b']' if opening(code, i).is_some_and(|o| code[..o].ends_with(is_place_end)) => {
                return false;
            }
            b')' | b']' | b'}' => {
                let rest = &code[i + 1..];
                if assigns(rest) {
                    return true;
                }
                if !rest.starts_with([',', ')', ']', '}']) {
                    return false;
                }
            }
            b';' if depth == 0 => return false,
            _ => {}
        }
        i += 1;
    }
    false
}

/// The place that starts at `start`: identifiers, dots and `?`, with any
/// brackets or call parentheses in it read whole (`self.units[pos(id)]
/// .occupants`, `self.get_unit_mut(id)?.occupants`). It ends at a space, so a keyword after it (`else`, `as`)
/// is not part of it.
pub(super) fn place_at(code: &str, start: usize) -> &str {
    let bytes = code.as_bytes();
    let mut i = start;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'[' || b == b'(' {
            match closing(code, i) {
                Some(close) => i = close + 1,
                None => break,
            }
        } else if is_ident(b as char)
            || b == b'.'
            || b == b'?' && i > start
            || b == b'*' && i == start
        {
            i += 1;
        } else {
            break;
        }
    }
    &code[start..i]
}

/// The receiver of the field at `dot`: the place before it, as far back as
/// identifiers, dots and indexing reach (`crowd.people[i]` for
/// `crowd.people[i].state`).
pub(super) fn receiver(code: &str, dot: usize) -> &str {
    let bytes = code.as_bytes();
    let mut start = dot;
    while start > 0 {
        let b = bytes[start - 1];
        if b == b']' {
            let mut depth = 0usize;
            let mut i = start;
            while i > 0 {
                i -= 1;
                match bytes[i] {
                    b']' => depth += 1,
                    b'[' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    _ => {}
                }
            }
            start = i;
        } else if b.is_ascii_alphanumeric() || b == b'_' || b == b'.' {
            start -= 1;
        } else {
            break;
        }
    }
    &code[start..dot]
}

/// The value assigned to the place that ends at `after`, up to the end of
/// its statement, or `None` when no assignment follows the place.
pub(super) fn assigned_value(code: &str, after: usize) -> Option<&str> {
    let rest = &code[after..];
    if !assigns(rest) {
        return None;
    }
    let op = ASSIGNS.iter().find(|op| rest.starts_with(*op))?;
    let start = after + op.len();
    let bytes = code.as_bytes();
    let mut depth = 0usize;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        match b {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' if depth == 0 => return Some(&code[start..i]),
            b')' | b']' | b'}' => depth -= 1,
            b';' | b',' if depth == 0 => return Some(&code[start..i]),
            _ => {}
        }
    }
    Some(&code[start..])
}

/// Whether `c` can end a place, so a `[` after it indexes the place.
fn is_place_end(c: char) -> bool {
    is_ident(c) || matches!(c, ')' | ']' | '?')
}

/// The offset of the bracket that opens the one that closes at `close`.
pub(super) fn opening(code: &str, close: usize) -> Option<usize> {
    let bytes = code.as_bytes();
    let (o, c) = match bytes[close] {
        b')' => (b'(', b')'),
        b']' => (b'[', b']'),
        b'}' => (b'{', b'}'),
        _ => return None,
    };
    let mut depth = 0usize;
    for i in (0..=close).rev() {
        if bytes[i] == c {
            depth += 1;
        } else if bytes[i] == o {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
    }
    None
}

/// The offset of the bracket that closes the one at `open`.
pub(super) fn closing(code: &str, open: usize) -> Option<usize> {
    let bytes = code.as_bytes();
    let (o, c) = match bytes[open] {
        b'[' => (b'[', b']'),
        b'{' => (b'{', b'}'),
        b'(' => (b'(', b')'),
        _ => return None,
    };
    let mut depth = 0usize;
    for (i, &b) in bytes.iter().enumerate().skip(open) {
        if b == o {
            depth += 1;
        } else if b == c {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
    }
    None
}
