//! The undo's in-place merge, `merge_appended` in `tower/undoing.rs`, moves
//! units that are already in the list, which the view's source scan counts
//! as a reorder (`unit_writes`). Its one call puts back the units an undo
//! step returns, inside `insert_units_at`, and that function moves the
//! revision after it, so every frame reader's next frame is full and no
//! index logged before the move is read against the list after it.
use super::source_scan_tests::{closing, engine_sources, squeeze};
use super::unit_scan_tests::{new_list_aside, unit_writes};

#[test]
fn the_undo_merge_moves_the_revision() {
    const UNDOING: &str = "tower/undoing.rs";
    const MERGE: &str = "merge_appended(&mut self.units,old_len,&lands);";
    let sources = engine_sources();
    let callers: Vec<&str> = sources
        .iter()
        .filter(|s| s.code.contains("merge_appended("))
        .map(|s| s.rel.as_str())
        .collect();
    assert_eq!(callers, [UNDOING]);
    let code = &sources.iter().find(|s| s.rel == UNDOING).unwrap().code;
    assert_eq!(code.matches("merge_appended(").count(), 1, "one call");
    let at = code.find("fn insert_units_at(").unwrap();
    let open = at + code[at..].find('{').unwrap();
    let body = &code[open..=closing(code, open).unwrap()];
    let merge = body.find(MERGE).expect("the call is in insert_units_at");
    assert!(
        body.starts_with("{if inserts.is_empty(){return;}"),
        "{body}"
    );
    let after = &body[merge..];
    assert!(after.contains("self.reindex_from(first);"), "{after}");
    assert!(
        after.contains("self.revision+=lands.len()as i64;"),
        "{after}"
    );
    // Only that statement, in that file, counts as the merge.
    let flagged = |rel: &str, line: &str| {
        let code = squeeze(rel.into(), line).code;
        !new_list_aside(rel, &code, unit_writes(&code, &[])).is_empty()
    };
    let call = "merge_appended(&mut self.units, old_len, &lands);";
    assert!(!flagged(UNDOING, call));
    assert!(flagged("x.rs", call));
    assert!(flagged(
        UNDOING,
        "merge_appended(&mut self.units, 0, &lands);"
    ));
    assert!(flagged(
        UNDOING,
        "shuffle(&mut self.units, old_len, &lands);"
    ));
}
