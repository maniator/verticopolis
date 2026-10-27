//! The source scan the view's write guards share (`marks_guard_tests.rs`
//! for the frame fields, `meta_tests.rs` for labels and subtypes). It reads
//! every engine source under `src/` as code only: comments, whitespace,
//! the text inside string and character literals, and inline test modules
//! removed, so a statement that rustfmt splits across lines reads as one.
//! The test files (`*_tests.rs`, `tests*.rs`) are left out.
//!
//! What this half finds is a write in place of a named field: an
//! assignment (compound and destructuring included), a mutating method, a
//! `&mut` borrow, a `ref mut` binding, and a write through a binding of the
//! field's own name. `unit_scan_tests.rs` finds the writes of a whole unit.
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

/// `text` as code only: line and block comments cut, a string or character
/// literal kept as its empty quotes (`"a//b"` reads `""`), whitespace
/// dropped, and every inline `#[cfg(test)] mod name { .. }` cut out (a
/// `mod name;` declaration is kept).
pub(super) fn squeeze(rel: String, text: &str) -> Source {
    let c: Vec<char> = text.replace("\r\n", "\n").chars().collect();
    let mut code = String::new();
    let mut line_of = Vec::new();
    let mut line = 1;
    let mut push = |ch: char, line: usize| {
        code.push(ch);
        line_of.extend(std::iter::repeat_n(line, ch.len_utf8()));
    };
    // Skip to `end` (exclusive), counting the lines passed.
    let skip = |from: usize, end: usize, line: &mut usize| {
        *line += c[from..end.min(c.len())]
            .iter()
            .filter(|&&ch| ch == '\n')
            .count();
        end
    };
    let at = |i: usize| c.get(i).copied().unwrap_or('\0');
    // The `b` that opens a raw byte string (`br".."`) after no name.
    let byte_prefix = |i: usize| c[i - 1] == 'b' && (i < 2 || !is_ident(c[i - 2]));
    let mut i = 0;
    while i < c.len() {
        let ch = c[i];
        let after_ident = i > 0 && is_ident(c[i - 1]);
        if ch == '/' && at(i + 1) == '/' {
            let end = (i..c.len()).find(|&j| c[j] == '\n').unwrap_or(c.len());
            i = skip(i, end, &mut line);
        } else if ch == '/' && at(i + 1) == '*' {
            let (mut depth, mut j) = (0usize, i);
            while j < c.len() {
                if c[j] == '/' && at(j + 1) == '*' {
                    depth += 1;
                    j += 2;
                } else if c[j] == '*' && at(j + 1) == '/' {
                    depth -= 1;
                    j += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    j += 1;
                }
            }
            i = skip(i, j, &mut line);
        } else if ch == 'r' && (!after_ident || byte_prefix(i)) && matches!(at(i + 1), '"' | '#') {
            // A raw string: r"...", r#"..."# or br"...", as many hashes as
            // it opens with.
            let hashes = (i + 1..c.len()).take_while(|&j| c[j] == '#').count();
            if at(i + 1 + hashes) != '"' {
                push(ch, line);
                i += 1;
                continue;
            }
            let body = i + 2 + hashes;
            let close = (body..c.len())
                .find(|&j| c[j] == '"' && (1..=hashes).all(|k| at(j + k) == '#'))
                .unwrap_or(c.len());
            push('"', line);
            push('"', line);
            i = skip(i, close + 1 + hashes, &mut line);
        } else if ch == '"' {
            let mut j = i + 1;
            while j < c.len() && c[j] != '"' {
                j += if c[j] == '\\' { 2 } else { 1 };
            }
            push('"', line);
            push('"', line);
            i = skip(i, j + 1, &mut line);
        } else if ch == '\'' && (at(i + 1) == '\\' || at(i + 2) == '\'') {
            // A character literal; a lifetime or a label has no closing quote
            // two characters on.
            let from = if at(i + 1) == '\\' { i + 3 } else { i + 2 };
            let close = (from..c.len()).find(|&j| c[j] == '\'').unwrap_or(c.len());
            push('\'', line);
            push('\'', line);
            i = skip(i, close + 1, &mut line);
        } else {
            if ch == '\n' {
                line += 1;
            } else if !ch.is_whitespace() {
                push(ch, line);
            }
            i += 1;
        }
    }
    while let Some((at, close)) = inline_test_module(&code) {
        code.replace_range(at..=close, "");
        line_of.drain(at..=close);
    }
    Source { rel, code, line_of }
}

/// Where the first inline test module (`#[cfg(test)]mod name{ .. }`)
/// starts, and the offset of its closing brace.
fn inline_test_module(code: &str) -> Option<(usize, usize)> {
    code.match_indices("#[cfg(test)]mod").find_map(|(at, m)| {
        let rest = &code[at + m.len()..];
        let name = rest.len() - rest.trim_start_matches(is_ident).len();
        let open = at + m.len() + name;
        let body = name > 0 && rest[name..].starts_with('{');
        body.then(|| closing(code, open).map(|close| (at, close)))?
    })
}

pub(super) fn is_ident(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// The assignment operators, longest first so `<<=` is not read as `<=`.
const ASSIGNS: [&str; 11] = [
    "<<=", ">>=", "+=", "-=", "*=", "/=", "%=", "|=", "&=", "^=", "=",
];

/// Where `code` writes `.field` in place, by byte offset of the field's
/// `.`: an assignment (a destructuring one too), a call of one of `methods`
/// on the field, a `&mut` borrow of it, or a `ref mut` binding of it. `skip`
/// sees the offset and drops a write that is not a room's (a person's
/// `state`, a local probe).
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
    let mutated = |rest: &str| {
        assigns(rest)
            || methods
                .iter()
                .any(|name| rest.starts_with(&format!(".{name}")))
    };
    let mut out = Vec::new();
    for at in at_field(code, 0) {
        let after = at + dotted.len();
        if mutated(&code[after..]) || in_assigned_tuple(code, after) {
            out.push(at);
        }
    }
    for borrow in ["&mut", "&rawmut"] {
        for (at, m) in code.match_indices(borrow) {
            let start = at + m.len();
            let place = place_at(code, start);
            if place.ends_with(&dotted) {
                out.push(start + place.len() - dotted.len());
            }
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
            let value = place_at(code, value_at);
            if value.ends_with(&dotted) {
                out.push(value_at + value.len() - dotted.len());
            }
        }
    }
    // A write through a binding of the field's name (`*occupants = 0`
    // after `let Unit { occupants, .. } = u`).
    for (at, m) in code.match_indices(&format!("*{field}")) {
        if !code[at + m.len()..].starts_with(is_ident) && mutated(&code[at + m.len()..]) {
            out.push(at);
        }
    }
    out.retain(|&at| !skip(at));
    out.sort_unstable();
    out.dedup();
    out
}

/// Whether `rest`, the code after a place, starts with an assignment.
pub(super) fn assigns(rest: &str) -> bool {
    ASSIGNS.iter().any(|op| rest.starts_with(op))
        && !rest.starts_with("==")
        && !rest.starts_with("=>")
}

/// Whether the place ending at `after` sits in a tuple that is assigned to
/// (`(u.occupants, n) = (0, 1)`), however deeply nested.
fn in_assigned_tuple(code: &str, after: usize) -> bool {
    let bytes = code.as_bytes();
    let mut depth = 0usize;
    let mut i = after;
    while i < bytes.len() {
        match bytes[i] {
            b'(' | b'[' | b'{' => depth += 1,
            b']' | b'}' if depth == 0 => return false,
            b']' | b'}' => depth -= 1,
            b')' if depth > 0 => depth -= 1,
            b')' => {
                let rest = &code[i + 1..];
                if assigns(rest) {
                    return true;
                }
                if !rest.starts_with([',', ')']) {
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

/// The place that starts at `start`: identifiers and dots, with any
/// brackets or call parentheses in it read whole (`self.units[pos(id)]
/// .occupants`). A keyword the squeeze joined to its end is left off
/// (`u.customers_in else {` reads `u.customers_inelse{`).
pub(super) fn place_at(code: &str, start: usize) -> &str {
    let place = joined_place(code, start);
    ["else", "as"]
        .iter()
        .find_map(|word| place.strip_suffix(word))
        .unwrap_or(place)
}

fn joined_place(code: &str, start: usize) -> &str {
    let bytes = code.as_bytes();
    let mut i = start;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'[' || b == b'(' {
            match closing(code, i) {
                Some(close) => i = close + 1,
                None => break,
            }
        } else if b.is_ascii_alphanumeric() || b == b'_' || b == b'.' || (b == b'*' && i == start) {
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

/// The top-level blocks of `value`, by their insides (`a` and `b` for
/// `if c { a } else { b }`).
pub(super) fn blocks(value: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut i = 0;
    while let Some(open) = value[i..].find('{').map(|o| i + o) {
        let Some(close) = closing(value, open) else {
            break;
        };
        out.push(&value[open + 1..close]);
        i = close + 1;
    }
    out
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

#[test]
fn the_scan_reads_code_only() {
    let s = squeeze(
        "x.rs".into(),
        "let a = 1; // u.state = x\nlet b = self\n    .tower\n    .units[i]\n    .occupants;\n\
         #[cfg(test)]\nmod tests;\nfn f() {}\n#[cfg(test)]\nmod tests {\n    u.state = x;\n}\n\
         let url = \"https://x/*y*/\"; /* u.state = x; /* nested */ */\n\
         let q = '\"'; let e = '\\''; fn g<'a>(s: &'a str) {}\nlet r = r#\"u.state = \"x\"\"#; let b = br\"\\\";\n",
    );
    assert_eq!(
        s.code,
        "leta=1;letb=self.tower.units[i].occupants;#[cfg(test)]modtests;fnf(){}\
         leturl=\"\";letq='';lete='';fng<'a>(s:&'astr){}letr=\"\";letb=b\"\";"
    );
    assert_eq!(s.line(s.code.find(".occupants").unwrap()), 5);
    assert_eq!(s.line(s.code.find("leturl").unwrap()), 13);
    assert_eq!(s.line(s.code.find("letr").unwrap()), 15);
}
