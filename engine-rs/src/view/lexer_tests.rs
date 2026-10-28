//! The lexer of the view's source scan (`source_scan_tests.rs`): every
//! engine source under `src/` as code only, with comments, the text inside
//! string and character literals, and inline test modules removed, and
//! whitespace kept only as one space between two words (`let u`, `ref mut
//! n`), so a statement that rustfmt splits across lines reads as one and a
//! keyword stays a word of its own. The test files (`*_tests.rs`,
//! `tests*.rs`) are left out.
use std::path::Path;

use super::source_scan_tests::{closing, is_ident};

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
/// literal kept as its empty quotes (`"a//b"` reads `""`), whitespace and
/// comments read as one space between two words and dropped anywhere else,
/// and every inline `#[cfg(test)] mod name { .. }` cut out (a `mod name;`
/// declaration is kept).
pub(super) fn squeeze(rel: String, text: &str) -> Source {
    let c: Vec<char> = text.replace("\r\n", "\n").chars().collect();
    let mut code = String::new();
    let mut line_of = Vec::new();
    let mut line = 1;
    // Whether whitespace or a comment came since the last char kept.
    let mut gap = false;
    let mut push = |ch: char, line: usize, gap: &mut bool| {
        if std::mem::take(gap) && is_ident(ch) && code.ends_with(is_ident) {
            code.push(' ');
            line_of.push(line);
        }
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
    // The `b` or `c` that opens a raw byte or C string (`br".."`, `cr".."`)
    // after no name.
    let byte_prefix = |i: usize| matches!(c[i - 1], 'b' | 'c') && (i < 2 || !is_ident(c[i - 2]));
    let mut i = 0;
    while i < c.len() {
        let ch = c[i];
        let after_ident = i > 0 && is_ident(c[i - 1]);
        if ch == '/' && at(i + 1) == '/' {
            let end = (i..c.len()).find(|&j| c[j] == '\n').unwrap_or(c.len());
            i = skip(i, end, &mut line);
            gap = true;
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
            gap = true;
        } else if ch == 'r' && (!after_ident || byte_prefix(i)) && matches!(at(i + 1), '"' | '#') {
            // A raw string: r"...", r#"..."# or br"...", as many hashes as
            // it opens with.
            let hashes = (i + 1..c.len()).take_while(|&j| c[j] == '#').count();
            if at(i + 1 + hashes) != '"' {
                push(ch, line, &mut gap);
                i += 1;
                continue;
            }
            let body = i + 2 + hashes;
            let close = (body..c.len())
                .find(|&j| c[j] == '"' && (1..=hashes).all(|k| at(j + k) == '#'))
                .unwrap_or(c.len());
            push('"', line, &mut gap);
            push('"', line, &mut gap);
            i = skip(i, close + 1 + hashes, &mut line);
        } else if ch == '"' {
            let mut j = i + 1;
            while j < c.len() && c[j] != '"' {
                j += if c[j] == '\\' { 2 } else { 1 };
            }
            push('"', line, &mut gap);
            push('"', line, &mut gap);
            i = skip(i, j + 1, &mut line);
        } else if ch == '\'' && (at(i + 1) == '\\' || at(i + 2) == '\'') {
            // A character literal; a lifetime or a label has no closing quote
            // two characters on.
            let from = if at(i + 1) == '\\' { i + 3 } else { i + 2 };
            let close = (from..c.len()).find(|&j| c[j] == '\'').unwrap_or(c.len());
            push('\'', line, &mut gap);
            push('\'', line, &mut gap);
            i = skip(i, close + 1, &mut line);
        } else {
            if ch == '\n' {
                line += 1;
            }
            if ch.is_whitespace() {
                gap = true;
            } else {
                push(ch, line, &mut gap);
            }
            i += 1;
        }
    }
    while let Some((at, close)) = inline_test_module(&code) {
        // Two words the module stood between stay two words.
        let words = code[..at].ends_with(is_ident) && code[close + 1..].starts_with(is_ident);
        let line = line_of[at];
        code.replace_range(at..=close, if words { " " } else { "" });
        line_of.splice(at..=close, words.then_some(line));
    }
    Source { rel, code, line_of }
}

/// Where the first inline test module (`#[cfg(test)]mod name{ .. }`)
/// starts, and the offset of its closing brace.
fn inline_test_module(code: &str) -> Option<(usize, usize)> {
    code.match_indices("#[cfg(test)]mod ").find_map(|(at, m)| {
        let rest = &code[at + m.len()..];
        let name = rest.len() - rest.trim_start_matches(is_ident).len();
        let open = at + m.len() + name;
        let body = name > 0 && rest[name..].starts_with('{');
        body.then(|| closing(code, open).map(|close| (at, close)))?
    })
}

#[test]
fn the_scan_reads_code_only() {
    let s = squeeze(
        "x.rs".into(),
        "let a = 1; // u.state = x\nlet b = self\n    .tower\n    .units[i]\n    .occupants;\n\
         #[cfg(test)]\nmod tests;\nfn f() {}\n#[cfg(test)]\nmod tests {\n    u.state = x;\n}\n\
         let url = \"https://x/*y*/\"; /* u.state = x; /* nested */ */\n\
         let q = '\"'; let e = '\\''; fn g<'a>(s: &'a str) {}\nlet r = r#\"u.state = \"x\"\"#; let b = br\"\\\";\n\
         let c = cr\"\\\"; ref/* x */mut n\n#[cfg(test)]\nmod more {\n    u.occupants = 0;\n}\n\
         let m = \"x\\\"y\nz\"; let z = 2;\n",
    );
    assert_eq!(
        s.code,
        "let a=1;let b=self.tower.units[i].occupants;#[cfg(test)]mod tests;fn f(){}\
         let url=\"\";let q='';let e='';fn g<'a>(s:&'a str){}let r=\"\";let b=b\"\";\
         let c=c\"\";ref mut n let m=\"\";let z=2;"
    );
    assert_eq!(s.line(s.code.find(".occupants").unwrap()), 5);
    assert_eq!(s.line(s.code.find("let url").unwrap()), 13);
    assert_eq!(s.line(s.code.find("let r").unwrap()), 15);
    assert_eq!(s.line(s.code.find("let m").unwrap()), 21);
    assert_eq!(s.line(s.code.find("let z").unwrap()), 22);
}
