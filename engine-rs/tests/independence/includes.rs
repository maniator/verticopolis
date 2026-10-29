//! Reading what a library file compiles in.

use super::scan::{is_ident, Part};
use super::{path_attributes, squeeze, Library};

/// Whether `code` imports an include macro from `std` or `core`, by path or
/// in a group.
pub(super) fn imports_include_macro(code: &str) -> bool {
    let c = squeeze(code);
    ["std::", "core::"].iter().any(|root| {
        c.match_indices(root).any(|(i, _)| {
            let rest = &c[i + root.len()..];
            if rest.starts_with("include") {
                return true;
            }
            rest.strip_prefix('{').is_some_and(|g| {
                let group = &g[..g.find('}').unwrap_or(g.len())];
                group
                    .split([',', '{'])
                    .any(|h| h.trim().starts_with("include"))
            })
        })
    })
}

/// Whether any `cfg_attr` in `code` (literals blanked) sets a `path`.
pub(super) fn conditional_path(code: &str) -> bool {
    let c = squeeze(code);
    c.match_indices("cfg_attr(").any(|(at, _)| {
        let mut depth = 0;
        for (i, ch) in c[at + 8..].char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        let args = &c[at + 8..at + 8 + i];
                        return args.match_indices("path").any(|(j, _)| {
                            (j == 0 || !is_ident(args.as_bytes()[j - 1]))
                                && args[j + 4..].starts_with('=')
                        });
                    }
                }
                _ => {}
            }
        }
        false
    })
}

/// The files a library source compiles in: the path of every `include!`,
/// `include_str!` and `include_bytes!` and of every `#[path]` module, or
/// `Err` for an argument that is not a plain string literal without escapes.
pub(super) fn included(lib: &Library) -> Vec<Result<String, String>> {
    includes(lib, &["include!", "include_str!", "include_bytes!"], true)
}

/// The files compiled in as code: `include!` and `#[path]` targets, whatever
/// their extension.
pub(super) fn included_code(lib: &Library) -> Vec<String> {
    includes(lib, &["include!"], true)
        .into_iter()
        .filter_map(Result::ok)
        .collect()
}

pub(super) fn includes(
    lib: &Library,
    macros: &[&str],
    with_path_modules: bool,
) -> Vec<Result<String, String>> {
    let b = lib.src.as_bytes();
    let skip = |mut i: usize| {
        while i < b.len() && (lib.parts[i] == Part::Comment || b[i].is_ascii_whitespace()) {
            i += 1;
        }
        i
    };
    let mut out = Vec::new();
    for &mac in macros {
        let mut from = 0;
        while let Some(off) = lib.code[from..].find(mac) {
            let at = from + off;
            from = at + mac.len();
            if at > 0 && is_ident(b[at - 1]) {
                continue;
            }
            let open = skip(from);
            if b.get(open) != Some(&b'(') {
                out.push(Err(format!("{mac} at byte {at} has no argument list")));
                continue;
            }
            let arg = skip(open + 1);
            if lib.parts.get(arg) != Some(&Part::Literal) {
                out.push(Err(format!("{mac} at byte {at} takes a computed path")));
                continue;
            }
            let end = (arg..b.len())
                .find(|i| lib.parts[*i] != Part::Literal)
                .unwrap_or(b.len());
            let lit = &lib.src[arg..end];
            let raw = lit.starts_with('r') || lit.starts_with("br");
            let value = lit
                .trim_start_matches('b')
                .trim_start_matches('r')
                .trim_matches('#');
            let value = value
                .strip_prefix('"')
                .and_then(|v| v.strip_suffix('"'))
                .unwrap_or(value);
            if !raw && value.contains('\\') {
                out.push(Err(format!("{mac} at byte {at} escapes its path")));
            } else {
                out.push(Ok(value.to_string()));
            }
        }
    }
    if with_path_modules {
        out.extend(
            path_attributes(&lib.src, &lib.parts, 0, lib.src.len())
                .into_iter()
                .map(Ok),
        );
    }
    out
}
