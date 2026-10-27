//! The source scan the view's write guards share (`marks_tests.rs` for the
//! frame fields, `meta_tests.rs` for labels and subtypes). It reads every
//! engine source under `src/` as code only: comments, whitespace and inline
//! test modules removed, so a statement that rustfmt splits across lines
//! reads as one. The test files (`*_tests.rs`, `tests*.rs`) are left out.
//!
//! What it finds is a write in place: an assignment (compound included), a
//! mutating method, a `&mut` borrow, a `ref mut` binding or a destructuring
//! pattern that binds the field, and a write of a whole unit. A new unit's
//! struct literal is not a write in place; the session oracle covers it.
use std::path::Path;

/// One source file as code only, with the line each byte came from.
pub(super) struct Source {
    pub(super) rel: String,
    pub(super) code: String,
    line_of: Vec<usize>,
}

impl Source {
    /// The source line of byte `at` of `code`.
    pub(super) fn line(&self, at: usize) -> usize {
        self.line_of[at]
    }
}

/// Every engine source file under `src/`, test files aside, as code only.
pub(super) fn engine_sources() -> Vec<Source> {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut stack = vec![src.clone()];
    let mut out = Vec::new();
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let rel = path
                .strip_prefix(&src)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let name = rel.rsplit('/').next().unwrap();
            let test = name.ends_with("_tests.rs") || name.starts_with("tests");
            if !rel.ends_with(".rs") || test {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            out.push(squeeze(rel, &text));
        }
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    out
}

/// `text` as code only: line comments cut, whitespace dropped, and
/// everything from an inline `#[cfg(test)] mod name {` on left out (the test
/// module ends a file in this crate; a `mod name;` declaration is kept).
pub(super) fn squeeze(rel: String, text: &str) -> Source {
    let mut code = String::new();
    let mut line_of = Vec::new();
    for (n, line) in text.replace("\r\n", "\n").lines().enumerate() {
        let line = line.split("//").next().unwrap();
        for c in line.chars().filter(|c| !c.is_whitespace()) {
            code.push(c);
            line_of.extend(std::iter::repeat_n(n + 1, c.len_utf8()));
        }
    }
    if let Some(at) = inline_test_module(&code) {
        code.truncate(at);
        line_of.truncate(at);
    }
    Source { rel, code, line_of }
}

/// Where the first inline test module (`#[cfg(test)]mod name{`) starts.
fn inline_test_module(code: &str) -> Option<usize> {
    code.match_indices("#[cfg(test)]mod").find_map(|(at, m)| {
        let rest = &code[at + m.len()..];
        let name = rest.len() - rest.trim_start_matches(is_ident).len();
        (name > 0 && rest[name..].starts_with('{')).then_some(at)
    })
}

fn is_ident(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// The assignment operators, longest first so `<<=` is not read as `<=`.
const ASSIGNS: [&str; 11] = [
    "<<=", ">>=", "+=", "-=", "*=", "/=", "%=", "|=", "&=", "^=", "=",
];

/// Where `code` writes `.field` in place, by byte offset of the field's
/// `.`: an assignment, a call of one of `methods` on the field, a `&mut`
/// borrow of it, or a `ref mut` binding of it. `skip` sees the offset and
/// drops a write that is not a room's (a person's `state`, a local probe).
pub(super) fn field_writes(
    code: &str,
    field: &str,
    methods: &[&str],
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
    let mut out = Vec::new();
    for at in at_field(code, 0) {
        let rest = &code[at + dotted.len()..];
        let mutates = methods
            .iter()
            .any(|name| rest.starts_with(&format!(".{name}")));
        if assigns(rest) || mutates {
            out.push(at);
        }
    }
    for (at, m) in code.match_indices("&mut") {
        let rest = &code[at + m.len()..];
        let place = rest.split([')', ',', ';', '{', '}', '=']).next().unwrap();
        if place.ends_with(&dotted) {
            out.push(at + m.len() + place.len() - dotted.len());
        }
    }
    for (at, _) in code.match_indices("refmut") {
        // The statement's scrutinee, from its start up to the binding
        // (`match u.field { Some(ref mut n) =>`), or the value after the
        // pattern's `=` (`if let Some(ref mut n) = u.field {`).
        let start = code[..at].rfind(';').map_or(0, |s| s + 1);
        out.extend(at_field(&code[start..at], start));
        if let Some(eq) = code[at..].find('=') {
            let value_at = at + eq + 1;
            let value = code[value_at..].split(['{', ';', ')', ',']).next().unwrap();
            if value.ends_with(&dotted) {
                out.push(value_at + value.len() - dotted.len());
            }
        }
    }
    // A write through a binding of the field's name (`*occupants = 0`
    // after `let Unit { occupants, .. } = u`).
    for (at, m) in code.match_indices(&format!("*{field}")) {
        let rest = &code[at + m.len()..];
        if rest.starts_with(is_ident) {
            continue;
        }
        let mutates = methods
            .iter()
            .any(|name| rest.starts_with(&format!(".{name}")));
        if assigns(rest) || mutates {
            out.push(at);
        }
    }
    out.retain(|&at| !skip(at));
    out.sort_unstable();
    out.dedup();
    out
}

/// Whether `rest`, the code after a place, starts with an assignment.
fn assigns(rest: &str) -> bool {
    ASSIGNS.iter().any(|op| rest.starts_with(op))
        && !rest.starts_with("==")
        && !rest.starts_with("=>")
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

/// Where `code` writes a whole unit in place, by byte offset: an assignment
/// to `units[..]` or through a dereferenced binding (`*u = Unit {`), a
/// destructuring `let Unit { .. } =` that binds one of `fields`, or a
/// `mem::swap`, `mem::replace` or `mem::take` of a unit in the list.
pub(super) fn unit_writes(code: &str, fields: &[&str]) -> Vec<usize> {
    // A name that only ends in `units` or `Unit` (`hk_units`, `StaffUnit`)
    // is something else.
    let starts_word = |at: usize| at == 0 || !code[..at].ends_with(is_ident);
    let mut out = Vec::new();
    for (at, m) in code.match_indices("units[") {
        if let Some(close) = closing(code, at + m.len() - 1) {
            if starts_word(at) && assigns(&code[close + 1..]) {
                out.push(at);
            }
        }
    }
    for (at, m) in code.match_indices("=Unit{") {
        let start = code[..at].rfind([';', '{', '}']).map_or(0, |s| s + 1);
        if code[start..at].starts_with('*') {
            out.push(at + m.len() - 6);
        }
    }
    for (at, m) in code.match_indices("Unit{") {
        let Some(close) = closing(code, at + m.len() - 1) else {
            continue;
        };
        if !starts_word(at) {
            continue;
        }
        let pattern = assigns(&code[close + 1..]) && code[close + 1..].starts_with('=');
        let inside = &code[at + m.len()..close];
        let binds = inside
            .split([',', ':'])
            .any(|name| fields.contains(&name.trim_start_matches("refmut")));
        if pattern && binds {
            out.push(at);
        }
    }
    for call in ["mem::swap(", "mem::replace(", "mem::take("] {
        for (at, m) in code.match_indices(call) {
            if let Some(close) = closing(code, at + m.len() - 1) {
                let args = &code[at + m.len()..close];
                if args
                    .split(',')
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

/// The offset of the bracket that closes the one at `open`.
fn closing(code: &str, open: usize) -> Option<usize> {
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

#[test]
fn the_scan_reads_code_only() {
    let s = squeeze(
        "x.rs".into(),
        "let a = 1; // u.state = x\nlet b = self\n    .tower\n    .units[i]\n    .occupants;\n#[cfg(test)]\nmod tests;\nfn f() {}\n#[cfg(test)]\nmod tests {\n    u.state = x;\n}\n",
    );
    assert_eq!(
        s.code,
        "leta=1;letb=self.tower.units[i].occupants;#[cfg(test)]modtests;fnf(){}"
    );
    assert_eq!(s.line(s.code.find(".occupants").unwrap()), 5);
}
