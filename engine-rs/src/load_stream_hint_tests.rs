//! The unit reservation hint (`units_hint`), moved out of the streamed
//! reader's tests to keep that file under the line ceiling.
use super::*;

/// The reservation counts the objects listed directly in the top-level
/// `units`, and nothing else, within what the text's length could hold.
#[test]
fn the_units_count() {
    // Padding keeps these short texts clear of the length bound.
    let hint = |text: &str| units_hint(format!("{text}{}", " ".repeat(4096)).as_bytes());
    assert_eq!(hint(r#"{"units":[]}"#), 0);
    assert_eq!(hint(r#"{"units":[ ]}"#), 0);
    assert_eq!(hint(r#"{"units":[{"k":1}]}"#), 1);
    // An empty object cannot become a unit, so it reserves nothing.
    assert_eq!(hint(r#"{"units":[{},{ },{"k":1},{  }]}"#), 1);
    assert_eq!(hint(r#"{"units":[1,null,"{",[{"k":1}]]}"#), 0);
    assert_eq!(
        hint(r#"{ "units" : [ {"a":[{},2]}, "x,]", null, { "k" : 1 } ] }"#),
        2
    );
    assert_eq!(hint(r#"{"units":["\"],[{", {"b":"\\"}]}"#), 1);
    assert_eq!(
        hint(r#"{"towerName":"units","units":[{"k":1},{"k":2}]}"#),
        2
    );
    assert_eq!(
        hint(r#"{"view":{"units":[{"k":1},{"k":1},{"k":1}]},"units":[{"k":1}]}"#),
        1
    );
    assert_eq!(hint(r#"{"view":{"units":[{"k":1},{"k":1}]}}"#), 0);
    assert_eq!(hint(r#"{"units":{"a":{"k":1}}}"#), 0);
    assert_eq!(hint(r#"{"units":[{"k":1},{""#), 2);
    assert_eq!(hint(r#"{"units"#), 0);
    assert_eq!(hint("[\"units\",[{\"k\":1}]]"), 0);
    let unit = r#"{"kind":"floor","x":12345},"#;
    let many = format!("{{\"units\":[{}{{}}]}}", unit.repeat(UNIT_CAP + 5));
    assert_eq!(units_hint(many.as_bytes()), UNIT_CAP);
    // Short objects cannot reserve more units than their text could hold.
    let short = format!("{{\"units\":[{}{{}}]}}", "{\"k\":1},".repeat(1000));
    assert_eq!(units_hint(short.as_bytes()), short.len() / MIN_UNIT_BYTES);
    // Empty objects reserve nothing, however much space is around them.
    let spaced = format!(
        "{{\"units\":[{}{{}}]}}{}",
        "{ },".repeat(30_000),
        " ".repeat(1 << 21)
    );
    assert_eq!(units_hint(spaced.as_bytes()), 0);
}
