//! The command answers the Rust-backed facade reads (slice 6d, #1216): the
//! exterminator booking with its `cost` and `rooms`, the rent batch preview,
//! an unknown facility kind refused instead of thrown, and the shaft
//! validation behind the transport drag preview. Each answer is the one the
//! TypeScript instance gives today, in the JSON shape its result type has.
//!
//! Arguments arrive already read off their raw JS values, as in
//! `wasm_relay.rs`. A kind is a string the catalog knows; anything else is
//! unknown, and the shaft calls answer `UNKNOWN_FACILITY` while the rent batch
//! calls answer `None` (TypeScript's `null`). Once the kind is known, a
//! coordinate must be a JS number that is whole within `Number.isSafeInteger`
//! (`crate::charges::whole`) or the shaft call is refused with
//! `INVALID_REQUEST` before the tower is read. Native tests call these
//! directly, since a raw JS value needs a wasm target.
use crate::charges::{whole, INVALID_REQUEST};
use crate::facilities::Kind;
use crate::services::ExterminatorRefusal;

use super::{batch_result_json, outcome, parse_batch_target, Engine};

/// The reason TypeScript gives for a kind the catalog does not hold.
pub(crate) const UNKNOWN_FACILITY: &str = "Unknown facility.";

/// `{ ok: false, reason: "Unknown facility." }`, the refusal in place of a throw.
pub(crate) fn unknown_facility() -> String {
    outcome(false, Some(UNKNOWN_FACILITY))
}

/// `ExterminatorResult` as the TypeScript spells it: `cost` and `rooms` ride on
/// a booking and on the `funds` refusal; the other refusals carry the reason alone.
pub(crate) fn exterminator_json(r: &Result<(f64, usize), ExterminatorRefusal>) -> String {
    let v = match r {
        Ok((cost, rooms)) => serde_json::json!({ "ok": true, "cost": cost, "rooms": rooms }),
        Err(ExterminatorRefusal::Funds { cost, rooms }) => {
            serde_json::json!({ "ok": false, "reason": "funds", "cost": cost, "rooms": rooms })
        }
        Err(other) => serde_json::json!({ "ok": false, "reason": other.reason() }),
    };
    v.to_string()
}

impl Engine {
    /// `previewRentBatch(kind, target, { onlyDefaultPriced })`: the counters
    /// `applyRentBatch` would report, with nothing written. `None` where
    /// TypeScript answers `null`: an unknown or unpriced kind, a No Rate
    /// target off the ladder, or a target that is not `"default"`,
    /// `"noRate"` or a finite number.
    pub(crate) fn preview_rent_batch_named(
        &mut self,
        kind: &str,
        target: &str,
        only_default_priced: bool,
    ) -> Option<String> {
        let kind = Kind::parse(kind)?;
        let target = parse_batch_target(target).ok()?;
        self.sim
            .compute_batch(kind, target, only_default_priced, false)
            .map(|r| batch_result_json(&r))
    }

    /// `applyRentBatch`, answering `None` (TypeScript's `null`) for a kind or
    /// target it does not apply to, where the binding used to throw.
    pub(crate) fn apply_rent_batch_named(
        &mut self,
        kind: &str,
        target: &str,
        only_default_priced: bool,
    ) -> Option<String> {
        let kind = Kind::parse(kind)?;
        let target = parse_batch_target(target).ok()?;
        self.sim
            .apply_rent_batch(kind, target, only_default_priced)
            .map(|r| batch_result_json(&r))
    }

    /// `tower.validateTransport(kind, x, bottom, top)`: `(ok, reason)`, nothing written.
    pub(crate) fn validate_transport_checked(
        &self,
        kind: &str,
        x: Option<f64>,
        bottom: Option<f64>,
        top: Option<f64>,
    ) -> (bool, Option<String>) {
        let Some(kind) = Kind::parse(kind) else {
            return (false, Some(UNKNOWN_FACILITY.into()));
        };
        let (Some(x), Some(bottom), Some(top)) = (
            x.and_then(whole),
            bottom.and_then(whole),
            top.and_then(whole),
        ) else {
            return (false, Some(INVALID_REQUEST.into()));
        };
        let r = self.sim.tower.validate_transport(kind, x, bottom, top);
        (r.ok, r.reason)
    }

    /// `validateTransport` as JSON `{ ok, reason? }`.
    pub(crate) fn validate_transport_json(
        &self,
        kind: &str,
        x: Option<f64>,
        bottom: Option<f64>,
        top: Option<f64>,
    ) -> String {
        let (ok, reason) = self.validate_transport_checked(kind, x, bottom, top);
        outcome(ok, reason.as_deref())
    }

    /// `tower.placeTransportDryRun`: whether the shaft would be accepted.
    pub(crate) fn place_transport_dry_run_checked(
        &self,
        kind: &str,
        x: Option<f64>,
        bottom: Option<f64>,
        top: Option<f64>,
    ) -> bool {
        self.validate_transport_checked(kind, x, bottom, top).0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameMode;
    use crate::sim::Simulation;
    use serde_json::Value;

    fn json(text: &str) -> Value {
        serde_json::from_str(text).expect("the answer is JSON")
    }

    /// A Modern tower with a lobby run, two floor runs, an office and a
    /// hotel room, plenty of money; the shaft checks need structure to stand on.
    fn fixture() -> Engine {
        let mut e = Engine {
            sim: Simulation::new_game(7, GameMode::Modern),
        };
        e.sim.money = 1e9;
        for x in 150..200 {
            assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
            assert!(e.sim.tower.place(Kind::Floor, 2, x).ok);
            assert!(e.sim.tower.place(Kind::Floor, 3, x).ok);
        }
        assert!(e.sim.tower.place(Kind::Office, 2, 160).ok);
        assert!(e.sim.tower.place(Kind::HotelSingle, 3, 170).ok);
        e.sim.gameplay.drain();
        e
    }

    #[test]
    fn exterminator_answers_carry_cost_and_rooms_where_typescript_does() {
        assert_eq!(
            json(&exterminator_json(&Ok((11000.0, 3)))),
            serde_json::json!({ "ok": true, "cost": 11000.0, "rooms": 3 })
        );
        assert_eq!(
            json(&exterminator_json(&Err(ExterminatorRefusal::Funds {
                cost: 7000.0,
                rooms: 1
            }))),
            serde_json::json!({ "ok": false, "reason": "funds", "cost": 7000.0, "rooms": 1 })
        );
        for (refusal, reason) in [
            (ExterminatorRefusal::Unavailable, "unavailable"),
            (ExterminatorRefusal::Pending, "pending"),
            (ExterminatorRefusal::None, "none"),
        ] {
            assert_eq!(
                json(&exterminator_json(&Err(refusal))),
                serde_json::json!({ "ok": false, "reason": reason })
            );
        }
    }

    #[test]
    fn an_unknown_kind_is_refused_with_a_reason_and_never_thrown() {
        assert_eq!(
            json(&unknown_facility()),
            serde_json::json!({ "ok": false, "reason": "Unknown facility." })
        );
        let mut e = fixture();
        for kind in ["", "ofice", "OFFICE", " office", "__proto__", "constructor"] {
            assert_eq!(e.preview_rent_batch_named(kind, "\"default\"", false), None);
            assert_eq!(e.apply_rent_batch_named(kind, "\"default\"", false), None);
            let (ok, reason) =
                e.validate_transport_checked(kind, Some(150.0), Some(1.0), Some(2.0));
            assert!(!ok, "{kind}");
            assert_eq!(reason.as_deref(), Some(UNKNOWN_FACILITY), "{kind}");
        }
    }

    #[test]
    fn a_batch_target_that_does_not_apply_answers_null_in_both_calls() {
        let mut e = fixture();
        for target in ["null", "\"cheap\"", "[1]", "{}", "true", "not json", ""] {
            assert_eq!(
                e.preview_rent_batch_named("office", target, false),
                None,
                "{target}"
            );
            assert_eq!(
                e.apply_rent_batch_named("office", target, false),
                None,
                "{target}"
            );
        }
        // A kind with no price and a No Rate target off the ladder are null too.
        assert_eq!(
            e.preview_rent_batch_named("lobby", "\"default\"", false),
            None
        );
        assert_eq!(
            e.preview_rent_batch_named("office", "\"noRate\"", false),
            None
        );
    }

    #[test]
    fn a_preview_gives_the_apply_counters_and_writes_nothing() {
        let mut e = fixture();
        let before = e.serialize();
        let money = e.sim.money;
        for target in ["\"default\"", "1", "100000"] {
            let preview = e
                .preview_rent_batch_named("office", target, false)
                .expect("office is priced");
            assert_eq!(
                e.serialize(),
                before,
                "a preview moved the tower ({target})"
            );
            assert_eq!(e.sim.money, money);
            assert!(
                e.sim.gameplay.drain().is_empty(),
                "a preview emitted an event"
            );
            let mut applied = fixture();
            let counters = applied
                .apply_rent_batch_named("office", target, false)
                .expect("office is priced");
            assert_eq!(preview, counters, "{target}");
        }
    }

    #[test]
    fn the_shaft_check_matches_the_tower_and_refuses_malformed_arguments() {
        let e = fixture();
        let check = |kind: &str, x, b, t| e.validate_transport_checked(kind, x, b, t);
        // A shaft on built floors is accepted; the dry run says the same.
        assert_eq!(
            check("elevatorStandard", Some(180.0), Some(1.0), Some(3.0)),
            (true, None)
        );
        assert!(e.place_transport_dry_run_checked(
            "elevatorStandard",
            Some(180.0),
            Some(1.0),
            Some(3.0)
        ));
        // Not a transport, no height and off the lot keep the tower's reasons.
        assert_eq!(
            check("office", Some(180.0), Some(1.0), Some(3.0))
                .1
                .as_deref(),
            Some("Not a transport.")
        );
        assert_eq!(
            check("elevatorStandard", Some(180.0), Some(3.0), Some(3.0))
                .1
                .as_deref(),
            Some("Transport needs height.")
        );
        assert_eq!(
            check("elevatorStandard", Some(-1.0), Some(1.0), Some(3.0))
                .1
                .as_deref(),
            Some("Off the edge of the lot.")
        );
        // Malformed: fractions, NaN, infinities, past the safe range, missing.
        let far = 9_007_199_254_740_992.0;
        for bad in [
            Some(0.5),
            Some(f64::NAN),
            Some(f64::INFINITY),
            Some(f64::NEG_INFINITY),
            Some(far),
            None,
        ] {
            for args in [
                (bad, Some(1.0), Some(3.0)),
                (Some(180.0), bad, Some(3.0)),
                (Some(180.0), Some(1.0), bad),
            ] {
                assert_eq!(
                    check("elevatorStandard", args.0, args.1, args.2),
                    (false, Some(INVALID_REQUEST.into())),
                    "{args:?}"
                );
                assert!(!e.place_transport_dry_run_checked(
                    "elevatorStandard",
                    args.0,
                    args.1,
                    args.2
                ));
            }
        }
        // The edges of the safe range name nothing and never overflow.
        let max = 9_007_199_254_740_991.0;
        for v in [Some(max), Some(-max)] {
            for args in [
                (v, Some(1.0), Some(3.0)),
                (Some(180.0), v, v),
                (Some(180.0), Some(1.0), v),
                (Some(180.0), v, Some(3.0)),
            ] {
                assert!(
                    !check("elevatorExpress", args.0, args.1, args.2).0,
                    "{args:?}"
                );
            }
        }
        let json = e.validate_transport_json("elevatorStandard", Some(180.0), Some(1.0), Some(3.0));
        assert_eq!(json, r#"{"ok":true}"#);
    }
}
