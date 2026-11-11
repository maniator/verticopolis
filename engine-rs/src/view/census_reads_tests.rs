//! The census tally's predicates read nothing but the marked fields and the
//! kind (`tally.rs`). `marks_guard_tests.rs` changes every other field once
//! and checks the predicates' answers stand, which a threshold or a change
//! that keeps an `Option` filled could slip past; this reads their bodies,
//! and the tally's own `share`, and refuses a body that hands its unit on
//! whole or a reader that takes anything but its unit.
use super::marks_guard_tests::FIELDS;
use super::source_scan_tests::{closing, engine_sources, is_ident};

/// The census share, whether a recycling center works, and what they call.
const PREDICATES: [&str; 6] = [
    "census_share",
    "is_present",
    "census_count",
    "live_load",
    "resident_count",
    "is_operational",
];

/// The body of `fn name` in the squeezed `code`, braces included, when it
/// takes its unit alone under the name `unit`: `(&self)` for a method,
/// `(u: &Unit)` for the tally's `share`. Another parameter, a pattern or
/// another name would leave the scan nothing to find, so it gets no body.
fn body_of<'a>(code: &'a str, name: &str, unit: &str) -> Option<&'a str> {
    let head = if unit == "self" {
        format!("fn {name}(&self)->")
    } else {
        format!("fn {name}({unit}:&Unit)->")
    };
    let at = code.find(&head)?;
    let open = at + code[at..].find('{')?;
    Some(&code[open..=closing(code, open)?])
}

/// How many times `fn name(` is defined across `sources`: a second
/// definition (another type's method, a trait's declaration) could stand in
/// for the reader the scan means to read.
fn definitions(sources: &[String], name: &str) -> usize {
    sources
        .iter()
        .map(|code| code.matches(&format!("fn {name}(")).count())
        .sum()
}

/// What `body` reads of the unit `unit` names (`self` in a method, `u` in
/// the tally's `share`) that no setter marks: a field outside the marked ones
/// and the kind, a call to anything but a census predicate (a method named
/// like a marked field included), or the unit
/// handed on whole (`helper(self)`, `matches!(self, ..)` or
/// `let Unit { .. } = self`), which this scan cannot follow.
fn unmarked_reads(body: &str, unit: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (at, _) in body.match_indices(unit) {
        let before = body[..at].chars().next_back();
        let after = &body[at + unit.len()..];
        if before.is_some_and(is_ident) || after.chars().next().is_some_and(is_ident) {
            continue; // part of a longer word, such as `itself`
        }
        let Some(rest) = after.strip_prefix('.') else {
            out.push(format!("{unit}, handed on whole"));
            continue;
        };
        let read: String = rest.chars().take_while(|&c| is_ident(c)).collect();
        let call = rest[read.len()..].starts_with('(') || rest[read.len()..].starts_with("::");
        let marked = !call && (read == "kind" || FIELDS.contains(&read.as_str()));
        if !(marked || call && PREDICATES.contains(&read.as_str())) {
            out.push(format!("{unit}.{read}"));
        }
    }
    out
}

#[test]
fn the_census_predicates_read_only_marked_fields_and_the_kind() {
    let sources: Vec<String> = engine_sources()
        .into_iter()
        .filter(|s| {
            ["tower_query_state.rs", "view/marks.rs", "view/tally.rs"].contains(&s.rel.as_str())
        })
        .map(|s| s.code)
        .collect();
    assert_eq!(sources.len(), 3, "the predicates' files moved");
    let reads = PREDICATES
        .iter()
        .map(|&name| (name, "self"))
        .chain([("share", "u")]);
    for (name, unit) in reads {
        let defined = definitions(&sources, name);
        assert_eq!(defined, 1, "fn {name} is defined {defined} times");
        let body = sources
            .iter()
            .find_map(|code| body_of(code, name, unit))
            .unwrap_or_else(|| panic!("no fn {name} taking its unit alone as `{unit}`"));
        assert_eq!(
            unmarked_reads(body, unit),
            Vec::<String>::new(),
            "{name} reads what no setter marks"
        );
    }
}

#[test]
fn the_scan_refuses_an_unmarked_field_and_a_self_handed_on() {
    let state = FIELDS[0];
    let ok = format!("{{ self.kind == K && self.{state} != S && self.is_present() }}");
    assert_eq!(unmarked_reads(&ok, "self"), Vec::<String>::new());
    // A word that ends in "self" is no read.
    assert_eq!(
        unmarked_reads("{ /* checks itself */ true }", "self"),
        Vec::<String>::new()
    );
    assert_eq!(
        unmarked_reads("{ self.extras.is_some() }", "self"),
        ["self.extras"]
    );
    assert_eq!(
        unmarked_reads("{ self.floor_of() > 0 }", "self"),
        ["self.floor_of"]
    );
    // A method named like a marked field is a call, which the scan cannot
    // follow.
    assert_eq!(
        unmarked_reads(&format!("{{ self.{state}() == S }}"), "self"),
        [format!("self.{state}")]
    );
    assert_eq!(
        unmarked_reads("{ self.kind() == K }", "self"),
        ["self.kind"]
    );
    assert_eq!(
        unmarked_reads(&format!("{{ self.{state}::<u8>() == S }}"), "self"),
        [format!("self.{state}")]
    );
    // A predicate's name read as a field is not a call to it.
    assert_eq!(
        unmarked_reads("{ self.is_present }", "self"),
        ["self.is_present"]
    );
    for whole in [
        "{ helper(self) }",
        "{ matches!(self, Unit { .. }) }",
        "{ let Unit { extras, .. } = self; extras }",
    ] {
        assert_eq!(
            unmarked_reads(whole, "self"),
            ["self, handed on whole"],
            "{whole}"
        );
    }
    // The tally's own reader names its unit `u`.
    assert_eq!(
        unmarked_reads("{ u.kind == K && u.is_operational() }", "u"),
        Vec::<String>::new()
    );
    assert_eq!(
        unmarked_reads("{ u.extras.len() + menu(u) }", "u"),
        ["u.extras", "u, handed on whole"]
    );
}

#[test]
fn a_reader_that_takes_more_than_its_unit_has_no_body() {
    let share =
        |head: &str| body_of(&format!("{head}->Share{{u.kind}}"), "share", "u").map(str::to_string);
    assert_eq!(share("fn share(u:&Unit)").as_deref(), Some("{u.kind}"));
    for head in [
        "fn share(unit:&Unit)",
        "fn share(u:&Unit,t:&Tower)",
        "fn share(Unit{kind,extras,..}:&Unit)",
    ] {
        assert_eq!(share(head), None, "{head}");
    }
    let present = |head: &str| {
        body_of(&format!("pub {head}->bool{{true}}"), "is_present", "self").map(str::to_string)
    };
    assert_eq!(present("fn is_present(&self)").as_deref(), Some("{true}"));
    assert_eq!(present("fn is_present(&self,at:i64)"), None);
}

#[test]
fn a_reader_defined_twice_is_counted_twice() {
    // In two files, and twice in one file.
    let twice = [
        "impl Other{fn is_present(&self)->bool{true}}".to_string(),
        "impl Unit{pub fn is_present(&self)->bool{self.is_operational()}}".to_string(),
    ];
    assert_eq!(definitions(&twice, "is_present"), 2);
    assert_eq!(definitions(&twice[1..], "is_present"), 1);
    assert_eq!(definitions(&[twice.concat()], "is_present"), 2);
}
