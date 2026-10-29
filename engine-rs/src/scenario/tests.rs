use super::Scenario;

fn scenario(commands: &str) -> Result<Scenario, String> {
    Scenario::parse(&format!(
        r#"{{"id":"t","description":"t","start":{{"newGame":{{"seed":1,"mode":"classic"}}}},"commands":[{commands}]}}"#
    ))
}

#[test]
fn a_repeated_label_fails_at_the_emit() {
    let s = scenario(
        r#"{"op":"checkpoint","label":"a"},{"op":"checkpoint","label":"a"},{"op":"checkpoint","label":"b"}"#,
    )
    .unwrap();
    let run = super::run_scenario(&s, std::path::Path::new("."));
    let labels: Vec<_> = run.checkpoints.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, ["start", "a"]);
    match run.error {
        Some(super::RunError::Failed { index, what }) => {
            assert_eq!(index, 1);
            assert_eq!(what, "checkpoint label a is taken twice");
        }
        other => panic!("{other:?}"),
    }
    // Inside one command, nothing after the repeated emit runs: a tick
    // whose first checkpoint repeats a label records no later ones.
    let ticked = scenario(
        r#"{"op":"checkpoint","label":"t+60"},{"op":"tick","dt":60,"times":3,"checkpointEvery":1},{"op":"checkpoint","label":"z"}"#,
    )
    .unwrap();
    let run2 = super::run_scenario(&ticked, std::path::Path::new("."));
    let labels: Vec<_> = run2.checkpoints.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, ["start", "t+60"]);
    assert!(matches!(
        run2.error,
        Some(super::RunError::Failed { index: 1, .. })
    ));
    // A repeat on a later tick iteration stops there too, after that
    // iteration's step has already advanced the simulation on both engines.
    let later = scenario(
        r#"{"op":"checkpoint","label":"t+120"},{"op":"tick","dt":60,"times":3,"checkpointEvery":1}"#,
    )
    .unwrap();
    let run3 = super::run_scenario(&later, std::path::Path::new("."));
    let labels: Vec<_> = run3.checkpoints.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, ["start", "t+120", "t+60"]);
    match run3.error {
        Some(super::RunError::Failed { index, what }) => {
            assert_eq!(index, 1);
            assert_eq!(what, "checkpoint label t+120 is taken twice");
        }
        other => panic!("{other:?}"),
    }
    // The first "a" is a stop in its own right; a stop label past the
    // repeat is never reached and the failure is reported instead.
    assert!(super::run_scenario_until(&s, std::path::Path::new("."), "a").is_ok());
    match super::run_scenario_until(&s, std::path::Path::new("."), "b") {
        Err(e) => assert!(e.contains("taken twice")),
        Ok(_) => panic!("a stop label past a repeated label must fail"),
    }
}

#[test]
fn a_charge_op_pins_its_refusal_reason() {
    use crate::charges::ChargeResult;
    let paid = ChargeResult {
        ok: true,
        reason: None,
        delta: -1.0,
    };
    let refused = ChargeResult {
        ok: false,
        reason: Some("Not enough money.".into()),
        delta: 0.0,
    };
    let want = Some("Not enough money.".to_string());
    assert!(super::expect::expect_charge(&paid, &None, "a", -1.0).is_ok());
    assert!(super::expect::expect_charge(&refused, &want, "a", 0.0).is_ok());
    assert!(super::expect::expect_charge(&refused, &None, "a", 0.0)
        .unwrap_err()
        .contains("failed: Not enough money."));
    assert!(super::expect::expect_charge(&paid, &want, "a", -1.0)
        .unwrap_err()
        .contains("expected to fail with Not enough money."));
    assert!(
        super::expect::expect_charge(&refused, &Some("Other.".into()), "a", 0.0)
            .unwrap_err()
            .contains("failed with Not enough money., expected Other.")
    );
    assert!(super::expect::expect_charge(&paid, &None, "a", -2.0)
        .unwrap_err()
        .contains("the balance moved -2 but the command reported -1"));
    let refused_but_billed = ChargeResult {
        delta: -5.0,
        ..refused.clone()
    };
    assert!(
        super::expect::expect_charge(&refused_but_billed, &want, "a", -5.0)
            .unwrap_err()
            .contains("refused but reported a delta of -5")
    );
}

#[test]
fn whole_floats_count_as_integers() {
    let s = scenario(r#"{"op":"tick","dt":60.0,"times":2.0}"#).unwrap();
    assert_eq!(s.commands.len(), 1);
    assert!(scenario(r#"{"op":"tick","dt":60.5}"#).is_err());
}

#[test]
fn load_time_checks_match_the_typescript_runner() {
    assert!(
        scenario(r#"{"op":"buildRow","kind":"office","floor":2,"from":5,"to":4}"#)
            .unwrap_err()
            .contains("from must not be past to")
    );
    assert!(
        scenario(r#"{"op":"build","kind":"elevator","floor":2,"x":4}"#)
            .unwrap_err()
            .contains("kind must be place")
    );
    assert!(
        scenario(r#"{"op":"buildTransport","kind":"office","x":4,"bottom":1,"top":3}"#)
            .unwrap_err()
            .contains("kind must be shaft")
    );
    assert!(scenario(r#"{"op":"build","kind":"office","floor":2,"x":4}"#).is_ok());
    for (bad, why) in [
        (r#"{"op":"checkpoint","label":""}"#, "label must be str"),
        (r#"{"op":"tick","dt":0}"#, "dt must be count"),
        (
            r#"{"op":"tick","dt":60,"times":null}"#,
            "times must be count",
        ),
        (
            r#"{"op":"build","kind":"office","floor":2,"x":4,"expectFail":null}"#,
            "expectFail must be bool",
        ),
        (
            r#"{"op":"adjustRent","floor":2,"x":4,"dir":2}"#,
            "dir must be dir",
        ),
        (
            r#"{"op":"resolveChoice","accept":true,"kind":"fireRescu"}"#,
            "kind must be choice",
        ),
        (
            r#"{"op":"setCars","floor":2,"x":4,"cars":0}"#,
            "cars must be count",
        ),
        (
            r#"{"op":"sell","floor":2,"x":4,"extra":1}"#,
            "unknown field extra",
        ),
        (r#"{"op":"nope"}"#, "unknown op"),
        (
            r#"{"op":"extendTransport","floor":1,"x":4,"end":"left","targetFloor":3}"#,
            "end must be end",
        ),
        (
            r#"{"op":"extendTransport","floor":1,"x":4,"end":"up","targetFloor":3,"hwmTop":3}"#,
            "unknown field hwmTop",
        ),
        (
            r#"{"op":"removeFacility","floor":1,"x":4,"method":"burn"}"#,
            "method must be method",
        ),
        (
            r#"{"op":"addCar","floor":1,"x":4,"reason":""}"#,
            "reason must be str",
        ),
        (
            r#"{"op":"build","kind":"office","floor":1e300,"x":4}"#,
            "floor must be int",
        ),
    ] {
        assert!(scenario(bad).unwrap_err().contains(why), "{bad}");
    }
    assert!(scenario(r#"{"op":"build","kind":"office","floor":2.0,"x":4}"#).is_ok());
    assert!(Scenario::parse(
        r#"{"id":"t","description":"t","start":{"newGame":{"seed":1,"mode":"classic"},"fixture":"x"},"commands":[]}"#
    )
    .unwrap_err()
    .contains("unknown field fixture"));
    assert!(Scenario::parse(
        r#"{"id":"t","description":"t","extra":1,"start":{"newGame":{"seed":1,"mode":"classic"}},"commands":[]}"#
    )
    .unwrap_err()
    .contains("unknown field extra"));
    let bad_start = Scenario::parse(
        r#"{"id":"t","description":"t","start":{"newGame":{"seed":-1,"mode":"classic"}},"commands":[]}"#,
    );
    assert!(bad_start.unwrap_err().contains("seed must be u32"));
    let bad_mode = Scenario::parse(
        r#"{"id":"t","description":"t","start":{"fixture":"x","mode":"foo"},"commands":[]}"#,
    );
    assert!(bad_mode.unwrap_err().contains("mode must be mode"));
}
