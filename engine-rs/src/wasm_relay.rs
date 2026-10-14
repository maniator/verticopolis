//! The relayed edit commands behind the binding (#996), on arguments already
//! read off their raw JS values: a number is `Some` only for a JS number and
//! a flag only for a JS boolean (`JsValue::as_f64`, `as_bool`), so a numeric
//! string, `null`, a boolean where a number belongs, a boxed value or a
//! missing argument reaches here as `None`. Every number must be whole and
//! within `Number.isSafeInteger` (`crate::charges::whole`), or the command is
//! refused before anything moves with the answer TypeScript gives: `false`,
//! no rent, or `{ ok: false, reason: INVALID_REQUEST }`. The simulation's own
//! methods keep their `i64` arguments; this is the boundary. Native tests call
//! these directly, since a raw JS value needs a wasm target.
use crate::charges::{whole, INVALID_REQUEST};
use crate::tower::ResizeResult;

use super::{resize_json, Engine};

/// Two whole numbers, or `None` when either is malformed.
fn pair(a: Option<f64>, b: Option<f64>) -> Option<(i64, i64)> {
    Some((a.and_then(whole)?, b.and_then(whole)?))
}

/// The resize refusal for a malformed request, as TypeScript spells it.
fn invalid_resize() -> String {
    resize_json(ResizeResult {
        ok: false,
        reason: Some(INVALID_REQUEST.into()),
        added: 0,
        floor_tiles_created: 0,
    })
}

impl Engine {
    pub(crate) fn sell_at_checked(&mut self, floor: Option<f64>, x: Option<f64>) -> bool {
        pair(floor, x).is_some_and(|(floor, x)| self.sim.sell_at(floor, x))
    }

    /// `dir` must be exactly 1 or -1, as the TypeScript signature types it.
    pub(crate) fn adjust_rent_checked(&mut self, id: Option<f64>, dir: Option<f64>) -> Option<f64> {
        let dir = dir.filter(|d| *d == 1.0 || *d == -1.0)?;
        self.sim.adjust_rent(id.and_then(whole)?, dir as i64)
    }

    pub(crate) fn set_no_rate_checked(&mut self, id: Option<f64>) -> bool {
        id.and_then(whole)
            .is_some_and(|id| self.sim.set_no_rate(id))
    }

    pub(crate) fn set_cars_checked(&mut self, id: Option<f64>, cars: Option<f64>) -> bool {
        pair(id, cars).is_some_and(|(id, cars)| self.sim.set_cars(id, cars))
    }

    pub(crate) fn tower_set_cars_checked(&mut self, id: Option<f64>, cars: Option<f64>) -> bool {
        pair(id, cars).is_some_and(|(id, cars)| self.sim.tower.set_cars(id, cars))
    }

    /// The id is checked before the schedule's JSON is read, as TypeScript
    /// refuses it before looking at the payload; a malformed payload under a
    /// whole id is still an error.
    pub(crate) fn set_schedule_checked(
        &mut self,
        id: Option<f64>,
        schedule: &str,
    ) -> Result<bool, String> {
        let Some(id) = id.and_then(whole) else {
            return Ok(false);
        };
        let raw: serde_json::Value = serde_json::from_str(schedule).map_err(|e| e.to_string())?;
        Ok(self.sim.tower.set_schedule(id, &raw))
    }

    pub(crate) fn resize_checked(
        &mut self,
        id: Option<f64>,
        bottom: Option<f64>,
        top: Option<f64>,
    ) -> String {
        match (id.and_then(whole), pair(bottom, top)) {
            (Some(id), Some((bottom, top))) => {
                resize_json(self.sim.resize_transport(id, bottom, top))
            }
            _ => invalid_resize(),
        }
    }

    pub(crate) fn tower_resize_checked(
        &mut self,
        id: Option<f64>,
        bottom: Option<f64>,
        top: Option<f64>,
    ) -> String {
        match (id.and_then(whole), pair(bottom, top)) {
            (Some(id), Some((bottom, top))) => {
                resize_json(self.sim.tower.resize_transport(id, bottom, top))
            }
            _ => invalid_resize(),
        }
    }

    pub(crate) fn set_stop_checked(
        &mut self,
        id: Option<f64>,
        floor: Option<f64>,
        stop: Option<bool>,
    ) -> bool {
        match (pair(id, floor), stop) {
            (Some((id, floor)), Some(stop)) => self.sim.tower.set_stop(id, floor, stop),
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameMode;
    use crate::facilities::Kind;
    use crate::sim::Simulation;
    use serde_json::Value;

    /// A lobby, floors 2 and 3, an office on 2 and an elevator on 1..3, with
    /// money to spend: the shaft's id, the office's id and the office's column.
    fn fixture() -> (Engine, i64, i64) {
        let mut sim = Simulation::new_game(1, GameMode::Classic);
        for x in 10..40 {
            assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        }
        for fl in 2..=3 {
            for x in 10..40 {
                assert!(sim.tower.place(Kind::Floor, fl, x).ok);
            }
        }
        let office = sim.tower.place(Kind::Office, 2, 20).unit_id.unwrap();
        assert!(sim.build_transport(Kind::ElevatorStandard, 10, 1, 3).ok);
        let lift = sim.tower.transport_at(1, 10).unwrap().id;
        sim.money = 1_000_000.0;
        sim.gameplay.drain();
        (Engine { sim }, lift, office)
    }

    fn invalid(text: String) {
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "ok": false, "reason": INVALID_REQUEST }),
            "{text}"
        );
    }

    /// Every malformed numeric argument of every relayed command is refused
    /// with that command's answer and moves nothing, with no event.
    #[test]
    fn a_malformed_relayed_command_is_refused_and_moves_nothing() {
        let (mut e, lift, office) = fixture();
        let before = e.serialize();
        let id = Some(lift as f64);
        let unit = Some(office as f64);
        // A non-number (a numeric string, null, a boolean, a boxed number, a
        // missing argument) reaches the checked call as None.
        let bad = [
            None,
            Some(lift as f64 + 0.5),
            Some(f64::NAN),
            Some(f64::INFINITY),
            Some(f64::NEG_INFINITY),
            Some(9_007_199_254_740_992.0),
            Some(-9_007_199_254_740_992.0),
        ];
        for v in bad {
            assert!(!e.sell_at_checked(v, Some(20.0)), "sellAt floor {v:?}");
            assert!(!e.sell_at_checked(Some(2.0), v), "sellAt x {v:?}");
            assert_eq!(
                e.adjust_rent_checked(v, Some(1.0)),
                None,
                "adjustRent {v:?}"
            );
            assert_eq!(e.adjust_rent_checked(unit, v), None, "adjustRent dir {v:?}");
            assert!(!e.set_no_rate_checked(v), "setNoRate {v:?}");
            assert!(!e.set_cars_checked(v, Some(2.0)), "setCars id {v:?}");
            assert!(!e.set_cars_checked(id, v), "setCars cars {v:?}");
            assert!(
                !e.tower_set_cars_checked(v, Some(2.0)),
                "towerSetCars {v:?}"
            );
            assert!(!e.tower_set_cars_checked(id, v), "towerSetCars cars {v:?}");
            assert_eq!(
                e.set_schedule_checked(v, "null"),
                Ok(false),
                "setSchedule {v:?}"
            );
            invalid(e.resize_checked(v, Some(1.0), Some(2.0)));
            invalid(e.resize_checked(id, v, Some(3.0)));
            invalid(e.resize_checked(id, Some(1.0), v));
            invalid(e.tower_resize_checked(v, Some(1.0), Some(2.0)));
            invalid(e.tower_resize_checked(id, v, Some(3.0)));
            invalid(e.tower_resize_checked(id, Some(1.0), v));
            assert!(
                !e.set_stop_checked(v, Some(2.0), Some(false)),
                "setStop id {v:?}"
            );
            assert!(
                !e.set_stop_checked(id, v, Some(false)),
                "setStop floor {v:?}"
            );
        }
        // A stop that is not a JS boolean, and a dir other than exactly 1 or -1.
        assert!(!e.set_stop_checked(id, Some(2.0), None));
        for dir in [0.0, -0.0, 2.0, -2.0, 0.5] {
            assert_eq!(e.adjust_rent_checked(unit, Some(dir)), None, "dir {dir}");
        }
        // The schedule's JSON is not read under a malformed id.
        assert_eq!(e.set_schedule_checked(None, "not json"), Ok(false));
        assert!(e.set_schedule_checked(id, "not json").is_err());
        assert_eq!(e.serialize(), before, "a refusal moved the tower");
        assert!(
            e.sim.gameplay.drain().is_empty(),
            "a refusal emitted an event"
        );
    }

    /// The old `i32` arguments truncated an id or floor plus 2^32 to the real
    /// one; the whole safe range now reaches the engine, which finds nothing
    /// there and answers with its own refusal.
    #[test]
    fn ids_and_floors_past_32_bits_no_longer_alias() {
        let (mut e, lift, office) = fixture();
        let before = e.serialize();
        let far = 4_294_967_296.0;
        let max = 9_007_199_254_740_991.0;
        for id in [lift as f64 + far, lift as f64 - far, max, -max] {
            assert!(!e.set_cars_checked(Some(id), Some(2.0)), "setCars {id}");
            assert!(
                !e.tower_set_cars_checked(Some(id), Some(2.0)),
                "towerSetCars {id}"
            );
            assert!(
                !e.set_stop_checked(Some(id), Some(2.0), Some(false)),
                "setStop {id}"
            );
            assert_eq!(e.set_schedule_checked(Some(id), "null"), Ok(false));
            let v: Value =
                serde_json::from_str(&e.resize_checked(Some(id), Some(1.0), Some(2.0))).unwrap();
            assert_eq!(
                v,
                serde_json::json!({ "ok": false, "reason": "No such transport." })
            );
        }
        for id in [office as f64 + far, office as f64 - far, max, -max] {
            assert_eq!(
                e.adjust_rent_checked(Some(id), Some(1.0)),
                None,
                "adjustRent {id}"
            );
            assert!(!e.set_no_rate_checked(Some(id)), "setNoRate {id}");
        }
        assert!(!e.sell_at_checked(Some(2.0 + far), Some(20.0)));
        assert!(!e.sell_at_checked(Some(2.0), Some(20.0 + far)));
        assert!(!e.set_stop_checked(Some(lift as f64), Some(2.0 + far), Some(false)));
        let v: Value =
            serde_json::from_str(&e.resize_checked(Some(lift as f64), Some(1.0), Some(max)))
                .unwrap();
        assert_eq!(v["ok"], false);
        assert_ne!(v["reason"], INVALID_REQUEST);
        assert_eq!(e.serialize(), before, "an accepted edge moved the tower");
        assert!(e.sim.gameplay.drain().is_empty());
    }

    /// Well-formed calls still land.
    #[test]
    fn well_formed_relayed_commands_land() {
        let (mut e, lift, office) = fixture();
        let id = Some(lift as f64);
        assert!(e.set_cars_checked(id, Some(2.0)));
        assert!(e.tower_set_cars_checked(id, Some(3.0)));
        assert!(e.set_stop_checked(id, Some(2.0), Some(false)));
        assert_eq!(e.set_schedule_checked(id, "null"), Ok(true));
        let v: Value = serde_json::from_str(&e.resize_checked(id, Some(1.0), Some(2.0))).unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "ok": true, "added": -1, "floorTilesCreated": 0 })
        );
        let v: Value =
            serde_json::from_str(&e.tower_resize_checked(id, Some(1.0), Some(3.0))).unwrap();
        assert_eq!(v["ok"], true);
        assert!(e
            .adjust_rent_checked(Some(office as f64), Some(1.0))
            .is_some());
        assert!(e
            .adjust_rent_checked(Some(office as f64), Some(-1.0))
            .is_some());
        assert!(e.set_no_rate_checked(Some(office as f64)));
        assert!(e.sell_at_checked(Some(2.0), Some(20.0)));
        assert!(e.sim.tower.get_unit(office).is_none());
    }

    /// Whole numbers at the edge of the safe range name nothing in the
    /// tower: each command answers as it does for any missing id or floor,
    /// without overflowing on the way (a debug build panics on overflow).
    #[test]
    fn the_safe_range_edges_name_nothing_and_never_overflow() {
        let (mut e, lift, _) = fixture();
        let id = Some(lift as f64);
        let max = 9_007_199_254_740_991.0;
        for v in [Some(max), Some(-max)] {
            assert!(!e.sell_at_checked(v, Some(20.0)));
            assert!(!e.sell_at_checked(Some(2.0), v));
            assert_eq!(e.adjust_rent_checked(v, Some(1.0)), None);
            assert!(!e.set_no_rate_checked(v));
            assert!(!e.set_cars_checked(v, Some(2.0)));
            assert!(!e.tower_set_cars_checked(v, Some(2.0)));
            for (b, t) in [(v, Some(3.0)), (Some(1.0), v), (v, v)] {
                let r: Value = serde_json::from_str(&e.resize_checked(id, b, t)).unwrap();
                assert_eq!(r["ok"], false, "resize {b:?} {t:?}");
                let r: Value = serde_json::from_str(&e.tower_resize_checked(id, b, t)).unwrap();
                assert_eq!(r["ok"], false, "towerResize {b:?} {t:?}");
            }
            let r: Value =
                serde_json::from_str(&e.resize_checked(v, Some(1.0), Some(3.0))).unwrap();
            assert_eq!(r["ok"], false);
            let r: Value =
                serde_json::from_str(&e.tower_resize_checked(v, Some(1.0), Some(3.0))).unwrap();
            assert_eq!(r["ok"], false);
            assert!(!e.set_stop_checked(v, Some(2.0), Some(true)));
            assert!(!e.set_stop_checked(id, v, Some(true)));
        }
        // A car count past either end is clamped, never wrapped.
        let cars = |e: &Engine| e.sim.tower.get_transport(lift).unwrap().cars;
        assert!(e.set_cars_checked(id, Some(max)));
        assert_eq!(cars(&e), Kind::ElevatorStandard.max_cars());
        assert!(e.set_cars_checked(id, Some(-max)));
        assert_eq!(cars(&e), 1);
    }
}
