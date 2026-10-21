//! The `star` a new game opens at: the kinds that unlock above one star are in
//! reach from a new game, and a star outside 1 to 5 is refused.
use crate::scenario::{run_scenario, RunError, Scenario};
use std::path::Path;

fn run(star: &str, expect_fail: bool) -> Option<RunError> {
    let fail = if expect_fail {
        r#","expectFail":true,"reason":"Escalator unlocks at 3★.""#
    } else {
        ""
    };
    let s = Scenario::parse(&format!(
        r#"{{"id":"t","description":"t","start":{{"newGame":{{"seed":1,"mode":"classic"{star}}}}},"commands":[
        {{"op":"setMoney","amount":500000000}},
        {{"op":"buildRow","kind":"lobby","floor":1,"from":167,"to":206}},
        {{"op":"buildRow","kind":"floor","floor":2,"from":168,"to":205}},
        {{"op":"buildTransport","kind":"escalator","x":200,"bottom":1,"top":2{fail}}}]}}"#
    ))
    .unwrap();
    run_scenario(&s, Path::new(".")).error
}

#[test]
fn the_escalator_is_locked_below_three_stars() {
    assert!(run("", true).is_none());
    assert!(run(r#","star":1"#, true).is_none());
    assert!(run(r#","star":2"#, true).is_none());
}

#[test]
fn the_escalator_builds_from_three_stars() {
    assert!(run(r#","star":3"#, false).is_none());
    assert!(run(r#","star":5"#, false).is_none());
    match run(r#","star":3"#, true) {
        Some(RunError::Failed { what, .. }) => assert!(
            what.contains("succeeded but was expected to fail"),
            "{what}"
        ),
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_star_outside_one_to_five_is_refused() {
    for star in ["0", "6", "-1", "2.5", "\"3\"", "null"] {
        let text = format!(
            r#"{{"id":"t","description":"t","start":{{"newGame":{{"seed":1,"mode":"classic","star":{star}}}}},"commands":[]}}"#
        );
        let err = Scenario::parse(&text).unwrap_err();
        assert!(err.contains("star must be star"), "{star}: {err}");
    }
}

#[test]
fn a_reload_at_four_and_five_stars_matches_the_live_game() {
    for star in ["4", "5"] {
        let s = Scenario::parse(&format!(
            r#"{{"id":"t","description":"t","start":{{"newGame":{{"seed":1,"mode":"classic","star":{star}}}}},"commands":[{{"op":"reload"}}]}}"#
        ))
        .unwrap();
        assert!(
            run_scenario(&s, Path::new(".")).error.is_none(),
            "star {star}"
        );
    }
}
