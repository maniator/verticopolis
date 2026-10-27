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
use crate::brush::{BrushResult, BRUSH_TILE_LIMIT};
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

/// The brush's tiles from their JSON text: an array of at most
/// [`BRUSH_TILE_LIMIT`] whole numbers, or `None`. A JSON copy of a hole, NaN
/// or an infinity is `null`, so it fails like any other value that is not a
/// whole number. Text longer than any brush the host sends is not read.
fn brush_tiles(text: &str) -> Option<Vec<i64>> {
    // The host sends `JSON.stringify` output, which never pads and writes a
    // whole number in the safe range in at most 17 characters
    // ("-9007199254740991"), so 32 tiles, their commas and the brackets stay
    // well under 1,024 characters.
    if text.len() > 1024 {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let tiles = v.as_array()?;
    if tiles.len() > BRUSH_TILE_LIMIT {
        return None;
    }
    tiles.iter().map(|x| x.as_f64().and_then(whole)).collect()
}

/// `BrushResult` as the TypeScript spells it: `{ placed, reason? }`.
pub(crate) fn brush_json(r: &BrushResult) -> String {
    let v = match &r.reason {
        Some(reason) => serde_json::json!({ "placed": r.placed, "reason": reason }),
        None => serde_json::json!({ "placed": r.placed }),
    };
    v.to_string()
}

impl Engine {
    /// `paintBrush(kind, floor, tiles)` with the tiles as JSON text, as the
    /// host relays them: JSON `{ placed, reason? }`. A kind other than floor
    /// or lobby, a floor that is not a whole number, or tiles that are not
    /// text holding an array of at most [`BRUSH_TILE_LIMIT`] whole numbers
    /// lays nothing and answers `INVALID_REQUEST`, as TypeScript's
    /// `paintBrush` does.
    pub(crate) fn paint_brush_checked(
        &mut self,
        kind: Option<String>,
        floor: Option<f64>,
        tiles: Option<String>,
    ) -> String {
        let kind = kind.as_deref().and_then(Kind::parse);
        let tiles = tiles.as_deref().and_then(brush_tiles);
        let r = match (kind, floor.and_then(whole), tiles) {
            (Some(kind), Some(floor), Some(tiles)) => self.sim.paint_brush(kind, floor, &tiles),
            _ => BrushResult::invalid(),
        };
        brush_json(&r)
    }

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

    #[test]
    fn a_malformed_brush_is_refused_and_lays_nothing() {
        let mut e = fixture();
        let save = e.sim.serialize();
        let invalid = serde_json::json!({ "placed": 0, "reason": INVALID_REQUEST });
        let mut brush = |kind: Option<&str>, floor: Option<f64>, tiles: Option<&str>| {
            json(&e.paint_brush_checked(kind.map(String::from), floor, tiles.map(String::from)))
        };
        for kind in [
            None,
            Some(""),
            Some("office"),
            Some("Floor"),
            Some("elevatorExpress"),
        ] {
            assert_eq!(brush(kind, Some(4.0), Some("[150]")), invalid, "{kind:?}");
        }
        let far = 9_007_199_254_740_992.0;
        for floor in [
            None,
            Some(4.5),
            Some(f64::NAN),
            Some(f64::INFINITY),
            Some(far),
        ] {
            assert_eq!(
                brush(Some("floor"), floor, Some("[150]")),
                invalid,
                "{floor:?}"
            );
        }
        let many = format!("[{}]", ["150"; 33].join(","));
        let padded = format!("[{}150]", " ".repeat(1100));
        for tiles in [
            None,
            Some(""),
            Some("null"),
            Some("{}"),
            Some("150"),
            Some("[150.5]"),
            Some("[null]"),
            Some("[\"150\"]"),
            Some("[true]"),
            Some("[[150]]"),
            Some("[1e400]"),
            Some("[9007199254740992]"),
            Some("not json"),
            Some(&many),
            Some(&padded),
        ] {
            assert_eq!(brush(Some("floor"), Some(4.0), tiles), invalid, "{tiles:?}");
        }
        assert_eq!(e.sim.serialize(), save, "a refusal moved nothing");

        let mut brush = |kind: &str, tiles: &str| {
            json(&e.paint_brush_checked(Some(kind.into()), Some(4.0), Some(tiles.into())))
        };
        assert_eq!(brush("floor", "[]"), serde_json::json!({ "placed": 0 }));
        assert_eq!(
            brush("floor", "[150,151,-0]"),
            serde_json::json!({ "placed": 2, "reason": "Floors and lobbies must sit on the story below: no floating overhangs." })
        );
        assert_eq!(
            brush("floor", "[150,151]"),
            serde_json::json!({ "placed": 0 })
        );
    }
}
