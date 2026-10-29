//! The player's edit commands, each checked against the catalog.

use super::{check, ELEVATOR_X};
use serde_json::Value;
use verticopolis_engine::catalog::catalog;
use verticopolis_engine::charges::ExtendEnd;
use verticopolis_engine::facilities::Kind;
use verticopolis_engine::gameplay::RemovalMethod;
use verticopolis_engine::load::deserialize;
use verticopolis_engine::rent::BatchTarget;
use verticopolis_engine::sim::Simulation;
use verticopolis_engine::{export_tdt, import_tdt};

/// The player's edit commands on a founded tower, each checked for the
/// money it moves against the catalog: cars, an elevator extension, rent,
/// sales, the choice and bridging calls, and a `.TDT` round trip.
pub fn edit(sim: &mut Simulation) -> Result<(), String> {
    let cat = catalog(sim.mode);
    let elevator = sim
        .tower
        .transport_at(1, ELEVATOR_X)
        .map(|t| t.id)
        .ok_or("no elevator at the lobby")?;
    let r = sim.add_car(elevator);
    check(
        r.ok && r.delta == -cat.economy.add_car_cost,
        "add_car charges the quoted price",
    )?;
    let r = sim.remove_car(elevator);
    check(
        r.ok && r.delta == cat.economy.car_resale_refund,
        "remove_car refunds the quoted refund",
    )?;
    let r = sim.remove_car(elevator);
    check(!r.ok && r.delta == 0.0, "the last car stays")?;

    let tiles: Vec<i64> = (ELEVATOR_X..ELEVATOR_X + 6).collect();
    let r = sim.paint_brush(Kind::Floor, 4, &tiles);
    check(
        r.placed == 6 && r.reason.is_none(),
        "the brush lays floor tiles on floor 4",
    )?;
    let r = sim.extend_transport(elevator, ExtendEnd::Up, 4);
    check(
        r.charge.ok && r.top == 4 && r.added == 1,
        "the elevator extends one floor",
    )?;
    check(
        r.charge.delta == -cat.economy.transport_floor_cost,
        "an extension charges the quoted floor cost",
    )?;

    let office = |sim: &Simulation, x| sim.tower.unit_at(2, x).map(|u| u.id);
    let a = office(sim, 106).ok_or("no office at 2,106")?;
    let b = office(sim, 115).ok_or("no office at 2,115")?;
    check(sim.adjust_rent(a, 1).is_some(), "adjust_rent on an office")?;
    check(sim.set_no_rate(b), "set_no_rate on an office")?;
    let price = sim.price_unit(b, 10_000.0);
    check(price.is_some(), "price_unit on an office")?;
    let batch = sim
        .apply_rent_batch(Kind::Office, BatchTarget::Default, false)
        .ok_or("apply_rent_batch on offices")?;
    check(batch.matched == 4, "the batch sees the four offices")?;

    let before = sim.money;
    let sold = sim
        .tower
        .unit_at(3, 115)
        .map(|u| u.id)
        .ok_or("no office at 3,115")?;
    let r = sim.remove_facility(sold, RemovalMethod::Sell);
    check(
        r.ok && r.delta > 0.0 && sim.money == before + r.delta,
        "selling refunds",
    )?;
    let before = sim.money;
    check(
        sim.sell_at(3, 106) && sim.money > before,
        "sell_at sells the office on the tile",
    )?;
    check(
        sim.tower
            .unit_at(3, 106)
            .is_none_or(|u| u.kind.is_structural()),
        "sell_at removed the office it sold",
    )?;

    // `toggle_auto_bridge` returns the setting after the call. Classic
    // always bridges, so it stays on; with no emergency pending, resolving a
    // choice changes nothing. A host may call both at any time.
    check(
        sim.toggle_auto_bridge() && sim.auto_bridge,
        "Classic always bridges",
    )?;
    let money = sim.money;
    sim.resolve_choice(false);
    check(sim.money == money, "resolving no choice changes nothing")?;
    check(
        sim.set_film_policy(a, "auto").is_none(),
        "an office has no film policy",
    )?;

    let tdt = export_tdt(&sim.serialize().to_string())?;
    let (save, _warnings) = import_tdt(&tdt, "SMOKE.TDT")?;
    let save: Value = serde_json::from_str(&save).map_err(|e| e.to_string())?;
    let from_tdt = deserialize(&save)?;
    // The 1994 format stores floors its own way and orders units by floor,
    // so compare the rooms as a set.
    let rooms = |sim: &Simulation| {
        let mut v: Vec<_> = sim
            .tower
            .units
            .iter()
            .filter(|u| !u.kind.is_structural())
            .map(|u| (u.kind.as_str(), u.floor, u.x))
            .collect();
        v.sort();
        v
    };
    check(
        rooms(&from_tdt) == rooms(sim),
        "a .TDT round trip keeps every room where it stood",
    )?;
    Ok(())
}
