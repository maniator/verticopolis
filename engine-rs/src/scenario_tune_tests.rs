//! Tests for `expectFail` on the tuning ops (`sell`, `adjustRent`,
//! `setNoRate`, `setCars`, `setSchedule`, `startFire`): a command the engine
//! refuses is a result the scenario can pin, and a bad address is still an
//! error.
use crate::scenario::{run_scenario, RunError, Scenario};
use std::path::Path;

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
fn a_refused_sell_is_a_result_with_expect_fail_and_an_error_without() {
    assert!(run(r#"{"op":"sell","floor":2,"x":170,"expectFail":true}"#).is_none());
    assert!(failed(r#"{"op":"sell","floor":2,"x":170}"#).contains("sell @ 2,170 failed"));
}

#[test]
fn a_fire_that_catches_nothing_is_a_refusal() {
    assert!(run(r#"{"op":"startFire","expectFail":true}"#).is_none());
    assert!(failed(r#"{"op":"startFire"}"#).contains("startFire"));
}

#[test]
fn a_sell_that_lands_is_not_a_refusal() {
    let what = failed(
        r#"{"op":"setMoney","amount":500000000},{"op":"buildRow","kind":"lobby","floor":1,"from":167,"to":206},{"op":"buildRow","kind":"floor","floor":2,"from":168,"to":205},{"op":"build","kind":"office","floor":2,"x":170},{"op":"sell","floor":2,"x":170,"expectFail":true}"#,
    );
    assert!(
        what.contains("succeeded but was expected to fail"),
        "{what}"
    );
}

#[test]
fn a_bad_address_is_an_error_even_with_expect_fail() {
    for cmd in [
        r#"{"op":"adjustRent","floor":2,"x":170,"dir":1,"expectFail":true}"#,
        r#"{"op":"setNoRate","floor":2,"x":170,"expectFail":true}"#,
        r#"{"op":"setCars","floor":2,"x":170,"cars":2,"expectFail":true}"#,
        r#"{"op":"setSchedule","floor":2,"x":170,"schedule":{},"expectFail":true}"#,
    ] {
        let what = failed(cmd);
        assert!(
            what.contains("no unit at") || what.contains("no transport at"),
            "{cmd}: {what}"
        );
    }
}

#[test]
fn the_tuning_ops_take_a_boolean_expect_fail_only() {
    let err = Scenario::parse(
        r#"{"id":"t","description":"t","start":{"newGame":{"seed":1,"mode":"classic"}},"commands":[{"op":"sell","floor":2,"x":4,"expectFail":"yes"}]}"#,
    )
    .unwrap_err();
    assert!(err.contains("expectFail must be bool"), "{err}");
}
