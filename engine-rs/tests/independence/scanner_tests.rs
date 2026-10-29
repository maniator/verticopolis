//! Checks of the source scanner itself.

use super::{
    conditional_path, host_services, imports_include_macro, included, library, module_declarations,
    path_attributes, strip_tests, MODULE_DIR,
};

#[test]
fn the_scanner_sees_through_comments_strings_and_test_items() {
    let src = r##"
// std::env in a comment
/* std::process in a block /* nested */ comment */
fn a() { let s = "std::net in a string"; let c = '{'; let q = '\''; let r = r#"std::time"#; }
fn bytes() -> &'static [u8] { br#"{"a":"}"# }
#[cfg(test)]
mod tests { fn t() { let _ = std::env::var("X"); let b = '}'; } }
#[cfg(test)]
fn sized() -> [u8; 4] { [0; 4] }
#[cfg(test)]
#[path = "x_tests.rs"]
mod x_tests;
fn b<'a>(x: &'a str) -> &'a str { x }
fn c() { std::fs::read("y"); }
"##;
    let (lib, paths) = library("sample", src);
    assert_eq!(paths, vec!["x_tests.rs".to_string()]);
    let (services, reads) = host_services(&lib.code);
    assert!(
        services.is_empty(),
        "comments, strings and test items: {services:?}"
    );
    assert!(reads, "code after the test items is kept");
    assert!(lib.code.contains("fn b<'a>"));
    assert!(
        !lib.code.contains("sized"),
        "a [T; N] return type does not end the item"
    );
    assert!(
        lib.src.contains("\"std::net in a string\""),
        "strings stay in src"
    );
}

#[test]
fn the_scanner_finds_every_spelling_of_a_host_service() {
    for (src, want) in [
        ("use std::{env, fs};", "std::{env}"),
        (
            "use std::{collections::HashMap, process};",
            "std::{process}",
        ),
        ("use std::{time::Instant};", "std::{time}"),
        ("use std::{io::{stdout, Write}};", "std::{io::std*}"),
        (
            "use std::io::{stdout, Write}; fn f() { stdout().flush(); }",
            "stdout(",
        ),
        ("use std::io; fn f() { io::stderr(); }", "io::stderr"),
        ("fn f() { std :: thread :: sleep(d); }", "std::thread"),
        ("fn f() { println!(\"x\"); }", "println!"),
        ("fn f() { println!{\"x\"} }", "println!"),
        ("fn f() { let t = Instant::now(); }", "Instant::now"),
        ("use std::os::unix::net::UnixStream;", "std::os"),
        ("use std::{os::unix::net::UnixStream};", "std::{os}"),
        ("extern \"C\" { fn open(p: *const u8) -> i32; }", "extern{"),
        ("pub extern \"C\" fn hook() {}", "extern fn"),
    ] {
        let (lib, _) = library("sample", src);
        let (services, _) = host_services(&lib.code);
        assert!(services.contains(&want.to_string()), "{src}: {services:?}");
    }
    for src in [
        "use std::{io, fs};",
        "use std::{fs::File, io::Read};",
        "use std::path::Path; fn f(p: &str) -> bool { Path::new(p).exists() }",
        "use std::{path::Path};",
    ] {
        let (lib, _) = library("sample", src);
        assert!(host_services(&lib.code).1, "{src} reads files");
    }
    let (lib, _) = library(
        "sample",
        "use std::{io::Read, collections::HashMap}; fn refs(a: u8, refs: u8) {} \
         macro_rules! blueprint { () => {} } fn g() { blueprint!(); my_env!(); }",
    );
    assert_eq!(
        host_services(&lib.code),
        (vec![], false),
        "in-memory IO and look-alike names"
    );
}

#[test]
fn the_scanner_reads_every_include_form() {
    // The macro names are spelled at run time (INC is replaced below), so
    // this file holds no include call a tool reading the source would follow.
    let src = r##"
// floors 30–60 → a comment with multibyte characters before the includes
const A: &str = INC_str!("../../conformance/a.json");
const B: &str = INC_str!(
    "../../src/b.ts"
);
const C: &[u8] = INC_bytes! (r#"../../src/c.bin"#);
const D: &str = INC_str!(concat!("x", "y"));
const E: &str = "INC_str!(\"in a string ×";
const F: &str = INC_str!("..\x2f..\x2fsrc/f.ts");
INC!("../../src/e.rs");
#[path = "../../src/g.rs"]
mod g;
// #[path = "../../src/not_this.rs"]
"##
    .replace("INC", "include");
    let (lib, _) = library("sample", &src);
    let got = included(&lib);
    for want in [
        "../../conformance/a.json",
        "../../src/b.ts",
        "../../src/c.bin",
        "../../src/e.rs",
        "../../src/g.rs",
    ] {
        assert!(got.contains(&Ok(want.into())), "{want}: {got:?}");
    }
    assert_eq!(got.iter().filter(|r| r.is_err()).count(), 2, "{got:?}");
    for src in [
        "#[cfg_attr(all(), path = \"../outside.rs\")]\nmod outside;",
        "#[cfg_attr(\n    feature = \"x\",\n    path = \"a.rs\"\n)]\nmod a;",
    ] {
        assert!(conditional_path(&library("sample", src).0.code), "{src}");
    }
    for src in [
        "use std::include as inc;",
        "use core::{include_str as s, fmt};",
        "use ::std::include_bytes;",
    ] {
        assert!(
            imports_include_macro(&library("sample", src).0.code),
            "{src}"
        );
    }
    assert!(!imports_include_macro(
        &library("sample", "use std::{fmt, io::Read};").0.code
    ));
    assert!(!conditional_path(
        &library(
            "sample",
            "#[cfg_attr(test, allow(dead_code))]\nfn classpath() {}"
        )
        .0
        .code
    ));
    assert_eq!(
        got.len(),
        7,
        "the string and the comment are not includes: {got:?}"
    );
}

#[test]
fn a_file_the_library_also_loads_stays_library_code() {
    let src = "#[cfg(test)]\n#[path = \"shared.rs\"]\nmod shared_tests;\n#[path = \"shared.rs\"]\nmod shared;\npub(crate) mod plain;\n";
    let (lib, test_paths) = library("sample", src);
    assert_eq!(test_paths, vec!["shared.rs".to_string()]);
    assert_eq!(
        path_attributes(&lib.src, &lib.parts, 0, lib.src.len()),
        vec!["shared.rs".to_string()]
    );
    assert_eq!(
        module_declarations(&lib.code),
        vec!["shared".to_string(), "plain".to_string()]
    );
}

#[test]
fn a_cfg_test_on_anything_but_an_item_stops_the_scan() {
    for src in [
        "struct S { a: u8, #[cfg(test)] b: u8 }\nfn f() {}",
        "fn f(x: u8) { match x { #[cfg(test)] 0 => g(), _ => { h() } } }",
    ] {
        let r = std::panic::catch_unwind(|| strip_tests("sample", src));
        assert!(
            r.is_err(),
            "{src}: a misread attribute must not strip library code"
        );
    }
    let (lib, _) = library(
        "sample",
        "fn kept() { std::env::var(\"X\"); } #[cfg(test)] mod t {}",
    );
    assert_eq!(
        host_services(&lib.code).0,
        vec!["std::env".to_string()],
        "code before the attribute on its line stays scanned"
    );
    let (_, paths) = strip_tests(
        "sample",
        "#[cfg(test)]\n// helpers for the tests below\n#[allow(dead_code)]\npub(crate) mod helpers;\n#[cfg(test)]\nmod tests { }\n#[path = \"above_tests.rs\"]\n#[allow(clippy::float_cmp)]\n#[cfg(test)]\nmod above;",
    );
    assert_eq!(
        paths,
        vec![
            format!("{MODULE_DIR}helpers.rs"),
            format!("{MODULE_DIR}helpers/mod.rs"),
            "above_tests.rs".to_string()
        ]
    );
}
