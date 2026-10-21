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

const WITH_LOBBY: &str = r#"{"op":"setMoney","amount":500000000},{"op":"buildRow","kind":"lobby","floor":1,"from":167,"to":206},{"op":"buildRow","kind":"floor","floor":2,"from":168,"to":205}"#;
const STAIRS: &str = r#"{"op":"buildTransport","kind":"stairs","x":200,"bottom":1,"top":2}"#;

fn with(prefix: &[&str], cmd: &str) -> String {
    let mut all: Vec<&str> = prefix.to_vec();
    all.push(cmd);
    all.join(",")
}

#[test]
fn a_refused_sell_is_a_result_with_expect_fail_and_an_error_without() {
    // The ground lobby is permanent, so the engine refuses to sell it.
    let refused = with(
        &[WITH_LOBBY],
        r#"{"op":"sell","floor":1,"x":170,"expectFail":true}"#,
    );
    assert!(run(&refused).is_none());
    let landed = with(&[WITH_LOBBY], r#"{"op":"sell","floor":1,"x":170}"#);
    assert!(failed(&landed).contains("sell @ 1,170 failed"));
}

#[test]
fn a_sell_at_a_bare_tile_is_an_error_even_with_expect_fail() {
    let what = failed(r#"{"op":"sell","floor":2,"x":170,"expectFail":true}"#);
    assert!(
        what.contains("no unit or transport at floor 2, x 170"),
        "{what}"
    );
}

#[test]
fn a_schedule_and_a_car_count_on_stairs_are_refusals() {
    for (cmd, label) in [
        (
            r#"{"op":"setSchedule","floor":1,"x":200,"schedule":{},"expectFail":true}"#,
            "setSchedule @ 1,200 failed",
        ),
        (
            r#"{"op":"setCars","floor":1,"x":200,"cars":2,"expectFail":true}"#,
            "setCars 2 @ 1,200 failed",
        ),
    ] {
        assert!(run(&with(&[WITH_LOBBY, STAIRS], cmd)).is_none(), "{cmd}");
        let plain = cmd.replace(r#","expectFail":true"#, "");
        assert!(
            failed(&with(&[WITH_LOBBY, STAIRS], &plain)).contains(label),
            "{plain}"
        );
    }
}

#[test]
fn a_rent_change_and_a_no_rate_mark_on_a_lobby_are_refusals() {
    for (cmd, label) in [
        (
            r#"{"op":"adjustRent","floor":1,"x":170,"dir":1,"expectFail":true}"#,
            "adjustRent 1 @ 1,170 failed",
        ),
        (
            r#"{"op":"setNoRate","floor":1,"x":170,"expectFail":true}"#,
            "setNoRate @ 1,170 failed",
        ),
    ] {
        assert!(run(&with(&[WITH_LOBBY], cmd)).is_none(), "{cmd}");
        let plain = cmd.replace(r#","expectFail":true"#, "");
        assert!(
            failed(&with(&[WITH_LOBBY], &plain)).contains(label),
            "{plain}"
        );
    }
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
