//! The commands that act on the simulation alone. The runner handles the
//! three that also touch its checkpoint state (`checkpoint`, `tick`, `reload`).

use super::expect::{expect_charge, expect_ok, expect_outcome, transport_id_at, unit_id_at};
use super::{Command, RunError};
use crate::econ::rent_of;
use crate::facilities::Kind;
use crate::sim::Simulation;
use serde_json::Value;

/// Run one command against `sim`; `i` is its index, for the error it raises.
pub(super) fn apply(sim: &mut Simulation, c: &Command, i: usize) -> Result<(), RunError> {
    let failed = |what: String| RunError::Failed { index: i, what };
    let kind_of = |k: &str| {
        Kind::parse(k).ok_or_else(|| RunError::Failed {
            index: i,
            what: format!("unknown kind {k}"),
        })
    };
    match c {
        Command::SetMoney { amount } => sim.money = *amount,
        Command::Build {
            kind,
            floor,
            x,
            expect_fail,
            reason,
        } => {
            let r = sim.build(kind_of(kind)?, *floor, *x);
            expect_outcome(
                r.ok,
                r.reason.as_deref(),
                expect_fail,
                reason,
                &format!("build {kind} @ {floor},{x}"),
            )
            .map_err(failed)?;
        }
        Command::BuildRow {
            kind,
            floor,
            from,
            to,
        } => {
            let k = kind_of(kind)?;
            for x in *from..=*to {
                let r = sim.build(k, *floor, x);
                expect_ok(
                    r.ok,
                    false,
                    &format!("build {kind} @ {floor},{x}"),
                    r.reason.as_deref(),
                )
                .map_err(failed)?;
            }
        }
        Command::BuildTransport {
            kind,
            x,
            bottom,
            top,
            expect_fail,
            reason,
        } => {
            let r = sim.build_transport(kind_of(kind)?, *x, *bottom, *top);
            expect_outcome(
                r.ok,
                r.reason.as_deref(),
                expect_fail,
                reason,
                &format!("buildTransport {kind} @ x{x} {bottom}-{top}"),
            )
            .map_err(failed)?;
        }
        Command::Sell {
            floor,
            x,
            kind,
            expect_fail,
        } => {
            if let Some(kind) = kind {
                let here = sim
                    .tower
                    .unit_at(*floor, *x)
                    .map(|u| u.kind)
                    .or_else(|| sim.tower.transport_at(*floor, *x).map(|t| t.kind));
                if here.map(|k| k.as_str()) != Some(kind.as_str()) {
                    return Err(failed(format!(
                        "sell @ {floor},{x}: expected {kind}, found {}",
                        here.map(|k| k.as_str()).unwrap_or("nothing")
                    )));
                }
            }
            // A refusal needs something on the tile to refuse: a sell at
            // a bare tile is a bad address, as for the ops that look up
            // a unit first.
            if expect_fail.unwrap_or(false)
                && sim.tower.unit_at(*floor, *x).is_none()
                && sim.tower.transport_at(*floor, *x).is_none()
            {
                return Err(failed(format!(
                    "no unit or transport at floor {floor}, x {x}"
                )));
            }
            expect_ok(
                sim.sell_at(*floor, *x),
                expect_fail.unwrap_or(false),
                &format!("sell @ {floor},{x}"),
                None,
            )
            .map_err(failed)?;
        }
        Command::SetSchedule {
            floor,
            x,
            schedule,
            expect_fail,
        } => {
            let id = sim
                .tower
                .transport_at(*floor, *x)
                .map(|t| t.id)
                .ok_or_else(|| failed(format!("no transport at floor {floor}, x {x}")))?;
            expect_ok(
                sim.tower.set_schedule(id, schedule),
                expect_fail.unwrap_or(false),
                &format!("setSchedule @ {floor},{x}"),
                Some("not an elevator"),
            )
            .map_err(failed)?;
        }
        Command::SetCars {
            floor,
            x,
            cars,
            expect_fail,
        } => {
            let id = sim
                .tower
                .transport_at(*floor, *x)
                .map(|t| t.id)
                .ok_or_else(|| failed(format!("no transport at floor {floor}, x {x}")))?;
            let ok = sim.set_cars(id, *cars);
            let landed = sim
                .tower
                .transports
                .iter()
                .find(|t| t.id == id)
                .map(|t| t.cars)
                == Some(*cars);
            expect_ok(
                ok && landed,
                expect_fail.unwrap_or(false),
                &format!("setCars {cars} @ {floor},{x}"),
                None,
            )
            .map_err(failed)?;
        }
        Command::AddCar { floor, x, reason } => {
            let id = transport_id_at(sim, *floor, *x).map_err(failed)?;
            let before = sim.money;
            let r = sim.add_car(id);
            expect_charge(
                &r,
                reason,
                &format!("addCar @ {floor},{x}"),
                sim.money - before,
            )
            .map_err(failed)?;
        }
        Command::RemoveCar { floor, x, reason } => {
            let id = transport_id_at(sim, *floor, *x).map_err(failed)?;
            let before = sim.money;
            let r = sim.remove_car(id);
            expect_charge(
                &r,
                reason,
                &format!("removeCar @ {floor},{x}"),
                sim.money - before,
            )
            .map_err(failed)?;
        }
        Command::ExtendTransport {
            floor,
            x,
            end,
            target_floor,
            reason,
        } => {
            let id = transport_id_at(sim, *floor, *x).map_err(failed)?;
            let side = crate::charges::ExtendEnd::parse(end)
                .ok_or_else(|| failed(format!("unknown end {end}")))?;
            let before = sim.money;
            let r = sim.extend_transport(id, side, *target_floor);
            expect_charge(
                &r.charge,
                reason,
                &format!("extendTransport {end} to {target_floor} @ {floor},{x}"),
                sim.money - before,
            )
            .map_err(failed)?;
        }
        Command::RemoveFacility {
            floor,
            x,
            method,
            shaft,
            reason,
        } => {
            let id = if shaft.unwrap_or(false) {
                transport_id_at(sim, *floor, *x)
            } else {
                unit_id_at(sim, *floor, *x)
            }
            .map_err(failed)?;
            let how = crate::gameplay::RemovalMethod::parse(method)
                .ok_or_else(|| failed(format!("unknown method {method}")))?;
            let before = sim.money;
            let r = sim.remove_facility(id, how);
            expect_charge(
                &r,
                reason,
                &format!("removeFacility {method} @ {floor},{x}"),
                sim.money - before,
            )
            .map_err(failed)?;
        }
        Command::AdjustRent {
            floor,
            x,
            dir,
            expect_fail,
        } => {
            if *dir != 1 && *dir != -1 {
                return Err(failed(format!("adjustRent dir {dir} is not 1 or -1")));
            }
            let (id, kind, rent, no_rate) = sim
                .tower
                .unit_at(*floor, *x)
                .map(|u| (u.id, u.kind, u.rent, u.no_rate))
                .ok_or_else(|| failed(format!("no unit at floor {floor}, x {x}")))?;
            let before = rent_of(kind, rent, no_rate);
            let moved = sim.adjust_rent(id, *dir).is_some() && {
                let u = sim.tower.get_unit(id).unwrap();
                rent_of(u.kind, u.rent, u.no_rate) != before
            };
            expect_ok(
                moved,
                expect_fail.unwrap_or(false),
                &format!("adjustRent {dir} @ {floor},{x}"),
                Some("rent did not move"),
            )
            .map_err(failed)?;
        }
        Command::SetNoRate {
            floor,
            x,
            expect_fail,
        } => {
            let id = sim
                .tower
                .unit_at(*floor, *x)
                .map(|u| u.id)
                .ok_or_else(|| failed(format!("no unit at floor {floor}, x {x}")))?;
            expect_ok(
                sim.set_no_rate(id),
                expect_fail.unwrap_or(false),
                &format!("setNoRate @ {floor},{x}"),
                None,
            )
            .map_err(failed)?;
        }
        Command::StartFire { expect_fail } => {
            let before = sim.events.count();
            sim.start_fire();
            expect_ok(
                sim.events.count() > before,
                expect_fail.unwrap_or(false),
                "startFire",
                Some("nothing caught fire"),
            )
            .map_err(failed)?;
        }
        Command::BeginExtend { floor, x } => {
            let id = transport_id_at(sim, *floor, *x).map_err(failed)?;
            expect_ok(
                sim.begin_extend(id),
                false,
                "beginExtend",
                Some("no elevator there"),
            )
            .map_err(failed)?;
        }
        Command::EndExtend => sim.end_extend(),
        Command::BombThreat => sim.bomb_threat(),
        Command::EvaluateStar => sim.evaluate_star(),
        Command::ToggleAutoBridge => {
            // The toggle is a Modern control; a Classic scenario that
            // asks for it is wrong.
            let before = sim.auto_bridge;
            expect_ok(
                sim.toggle_auto_bridge() != before,
                false,
                "toggleAutoBridge",
                Some("bridging is not toggleable in this mode"),
            )
            .map_err(failed)?;
        }
        Command::SetFilmPolicy { floor, x, policy } => {
            let id = unit_id_at(sim, *floor, *x).map_err(failed)?;
            expect_ok(
                sim.set_film_policy(id, policy).is_some(),
                false,
                &format!("setFilmPolicy {policy} @ {floor},{x}"),
                Some("not a cinema"),
            )
            .map_err(failed)?;
        }
        Command::RerollSubtype { floor, x } => {
            let id = unit_id_at(sim, *floor, *x).map_err(failed)?;
            expect_ok(
                sim.reroll_subtype(id).is_some(),
                false,
                &format!("rerollSubtype @ {floor},{x}"),
                Some("no subtype to draw"),
            )
            .map_err(failed)?;
        }
        Command::ResizeTransport {
            floor,
            x,
            bottom,
            top,
            expect_fail,
            reason,
        } => {
            let id = transport_id_at(sim, *floor, *x).map_err(failed)?;
            let r = sim.resize_transport(id, *bottom, *top);
            expect_outcome(
                r.ok,
                r.reason.as_deref(),
                expect_fail,
                reason,
                &format!("resizeTransport @ {floor},{x} to {bottom}-{top}"),
            )
            .map_err(failed)?;
        }
        Command::ClearStops { floor, x } => {
            let id = transport_id_at(sim, *floor, *x).map_err(failed)?;
            expect_ok(
                sim.tower.clear_stops(id),
                false,
                &format!("clearStops @ {floor},{x}"),
                None,
            )
            .map_err(failed)?;
        }
        Command::SetStop {
            floor,
            x,
            stop_floor,
            stop,
        } => {
            let id = transport_id_at(sim, *floor, *x).map_err(failed)?;
            expect_ok(
                sim.tower.set_stop(id, *stop_floor, *stop),
                false,
                &format!("setStop {stop_floor} {stop} @ {floor},{x}"),
                Some("outside the span, or an express stop off a lobby"),
            )
            .map_err(failed)?;
        }
        Command::PriceUnit { floor, x, target } => {
            let id = unit_id_at(sim, *floor, *x).map_err(failed)?;
            expect_ok(
                sim.price_unit(id, *target).is_some(),
                false,
                &format!("priceUnit {target} @ {floor},{x}"),
                Some("not repriceable"),
            )
            .map_err(failed)?;
        }
        Command::ApplyRentBatch {
            kind,
            target,
            only_default_priced,
        } => {
            let kind = Kind::parse(kind).expect("checked at load");
            let target = match target {
                Value::String(s) if s == "default" => crate::rent::BatchTarget::Default,
                Value::String(s) if s == "noRate" => crate::rent::BatchTarget::NoRate,
                v => crate::rent::BatchTarget::Price(v.as_f64().expect("checked at load")),
            };
            let r = sim.apply_rent_batch(kind, target, only_default_priced.unwrap_or(false));
            // A batch that matched nothing changes nothing, so the
            // scenario must point at units that exist.
            expect_ok(
                r.as_ref().is_some_and(|r| r.matched > 0),
                false,
                &format!("applyRentBatch {}", kind.as_str()),
                Some(if r.is_none() {
                    "not a priced kind or target"
                } else {
                    "no unit of that kind"
                }),
            )
            .map_err(failed)?;
        }
        Command::ResolveChoice { accept, kind } => {
            // The answer must land on a real pending choice of the
            // kind the scenario names, and an accept must be payable,
            // as in the TypeScript runner.
            let Some(p) = sim.events.pending.as_ref() else {
                return Err(failed("resolveChoice: no pending choice".into()));
            };
            if let Some(k) = kind {
                if p.kind != *k {
                    return Err(failed(format!(
                        "resolveChoice: expected {k}, found {}",
                        p.kind
                    )));
                }
            }
            if *accept && sim.money < p.cost {
                return Err(failed(format!("resolveChoice: cannot pay {}", p.cost)));
            }
            sim.resolve_choice(*accept);
        }
        Command::CallExterminator {
            expect_fail,
            reason,
        } => {
            let r = sim.call_exterminator();
            expect_outcome(
                r.is_ok(),
                r.err().map(|e| e.reason()),
                expect_fail,
                reason,
                "callExterminator",
            )
            .map_err(failed)?;
        }
        Command::Checkpoint { .. } | Command::Tick { .. } | Command::Reload => {
            unreachable!("the runner handles {c:?}")
        }
    }
    Ok(())
}
