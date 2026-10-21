//! Tests for the `reason` field of `build`, `buildTransport`, `resizeTransport`
//! and `callExterminator`: a refusal is pinned by its reason, not only by the
//! fact that it happened.
use crate::scenario::{run_scenario, RunError, Scenario};
use std::path::Path;

const NO_LOBBY: &str = "Lay a lobby on the ground line first to open your tower.";

fn run(commands: &str) -> Option<RunError> {
    let s = Scenario::parse(&format!(
        r#"{{"id":"t","description":"t","start":{{"newGame":{{"seed":1,"mode":"classic"}}}},"commands":[{commands}]}}"#
    ))
    .unwrap();
    run_scenario(&s, Path::new(".")).error
}

fn failed(commands: &str) -> String {
    match run(commands) {
        Some(RunError::Failed { what, .. }) => what,
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_refusal_with_its_reason_passes() {
    let cmd = format!(
        r#"{{"op":"build","kind":"floor","floor":2,"x":170,"expectFail":true,"reason":"{NO_LOBBY}"}}"#
    );
    assert!(run(&cmd).is_none());
}

#[test]
fn a_refusal_for_another_reason_fails_and_names_both() {
    let what = failed(
        r#"{"op":"build","kind":"floor","floor":2,"x":170,"expectFail":true,"reason":"Not enough money."}"#,
    );
    assert!(what.contains(NO_LOBBY), "{what}");
    assert!(what.contains("Not enough money."), "{what}");
}

#[test]
fn a_reason_needs_expect_fail() {
    let what = failed(r#"{"op":"build","kind":"floor","floor":2,"x":170,"reason":"anything"}"#);
    assert!(what.contains("a reason needs expectFail"), "{what}");
}

#[test]
fn a_command_that_lands_is_not_a_refusal() {
    let what = failed(
        r#"{"op":"build","kind":"lobby","floor":1,"x":170,"expectFail":true,"reason":"Structure already here."}"#,
    );
    assert!(
        what.contains("succeeded but was expected to fail"),
        "{what}"
    );
}

#[test]
fn the_reason_field_is_checked_like_any_other() {
    for (bad, why) in [
        (
            r#"{"op":"build","kind":"office","floor":2,"x":4,"expectFail":true,"reason":""}"#,
            "reason must be str",
        ),
        (
            r#"{"op":"build","kind":"office","floor":2,"x":4,"expectFail":true,"reason":7}"#,
            "reason must be str",
        ),
        (
            r#"{"op":"sell","floor":2,"x":4,"reason":"no"}"#,
            "unknown field reason",
        ),
    ] {
        let err = Scenario::parse(&format!(
            r#"{{"id":"t","description":"t","start":{{"newGame":{{"seed":1,"mode":"classic"}}}},"commands":[{bad}]}}"#
        ))
        .unwrap_err();
        assert!(err.contains(why), "{bad}: {err}");
    }
}
