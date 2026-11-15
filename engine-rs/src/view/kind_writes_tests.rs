//! No engine code writes a room's kind in place, so the frame never has to
//! look for a kind changed under a room it already sent
//! (`marks_guard_tests::the_frame_and_the_census_read_only_marked_fields`).
use super::source_scan_tests::{closing, engine_sources, field_writes, squeeze, Calls};
use super::unit_scan_tests::{new_list_aside, unit_writes};

/// No engine code writes a unit's kind in place (nor any other `kind`, so
/// the scan needs no exemption): a unit's kind is set when it is built, and
/// changes only by a removal and a new unit, which move the revision and
/// send a full frame. `Kind` is `Copy` and its own methods take `self`, so
/// only `clone_from` and the operator traits' `*_assign` can write one
/// through a method.
#[test]
fn no_engine_code_writes_a_kind() {
    const KIND: Calls = Calls::Writing(&["clone_from"]);
    let kind_writes = |rel: &str, code: &str| {
        let mut found = field_writes(code, "kind", &KIND, &|_| false);
        found.extend(new_list_aside(rel, code, unit_writes(code, &["kind"])));
        found
    };
    let mut writers = Vec::new();
    for source in engine_sources() {
        for at in kind_writes(&source.rel, &source.code) {
            writers.push(format!("{}:{}", source.rel, source.line(at)));
        }
        if source.rel == "facilities.rs" {
            let code = &source.code;
            let impls = code.match_indices("impl Kind{").collect::<Vec<_>>();
            assert!(!impls.is_empty());
            for (at, m) in impls {
                let close = closing(code, at + m.len() - 1).unwrap();
                assert!(!code[at..close].contains("&mut self"), "Kind's own methods");
            }
        }
    }
    for (line, writes) in [
        ("u.kind = Kind::Office;", true),
        ("let k = &mut u.kind;", true),
        ("u.kind.clone_from(&k);", true),
        ("u.kind.add_assign(k);", true),
        ("let Unit { kind, .. } = u; *kind = x;", true),
        ("let Unit { kind: k, .. } = u; *k = x;", true),
        ("*u = Unit { kind: k, ..base };", true),
        ("u.kind == Kind::Office", false),
        ("u.kind.is_hotel()", false),
        ("let f = u.kind.facility();", false),
    ] {
        let code = squeeze("x.rs".into(), line).code;
        assert_eq!(!kind_writes("x.rs", &code).is_empty(), writes, "{line}");
    }
    assert!(writers.is_empty(), "{writers:?}");
}
