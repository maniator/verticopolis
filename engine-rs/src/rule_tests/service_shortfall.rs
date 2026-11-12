//! Service shortfalls lower ratings from three stars (#1970): too little
//! recycling sinks every rated tenant in Classic and holds them at Good in
//! Modern until it is more than one center short; Classic offices sink when
//! no parking is left for them, Modern parks the lowest offices first and
//! holds or sinks the rest by coverage; the move-in gate, and the inspector's
//! won't-lease line, count the newcomer.
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH as W};
use crate::satisfaction::shortfall::{PARKING_CAUSE, SHORTFALL_CAP, TRASH_CAUSE};
use crate::satisfaction::VACATE_RESCIND;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::stocked_services::{lay_basement, stock_parking, stock_recycling};
use super::{lay_row, seat, unit};

const OFFICE_STEP: i64 = 11;

/// Floors 2..=top with an elevator every 40 tiles and every office slot
/// filled and content, at `star`. Answers the offices floor by floor.
fn office_tower(mode: GameMode, star: i64, top: i64) -> (Simulation, Vec<i64>) {
    let mut sim = Simulation::new_game(41, mode);
    sim.money = 1e12;
    sim.star = star;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=top {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    for x in (10..W - 10).step_by(40) {
        assert!(sim.build_transport(Kind::ElevatorStandard, x, 1, top).ok);
    }
    let mut offices = Vec::new();
    for floor in 2..=top {
        for x in (14..=W - 49).step_by(OFFICE_STEP as usize) {
            if let Some(id) = sim.tower.place(Kind::Office, floor, x).unit_id {
                seat(&mut sim, id, UnitState::Occupied, 1.0);
                offices.push(id);
            }
        }
    }
    lay_basement(&mut sim, -3);
    (sim, offices)
}

/// `id`'s satisfaction after `hours` hourly steps from content.
fn after_hours(sim: &mut Simulation, id: i64, hours: usize) -> f64 {
    let mut ctx = sim.build_satisfaction_context(false);
    let u = unit(sim, id).clone();
    let mut s = 1.0;
    for _ in 0..hours {
        s = sim.satisfaction_step(&u, s, &mut ctx).next;
    }
    s
}

/// The shortfall binding `id` this hour, as its cause and whether it sinks.
fn binding(sim: &mut Simulation, id: i64) -> Option<(&'static str, bool)> {
    let u = unit(sim, id).clone();
    sim.service_shortfalls()
        .binding_for(&u, true)
        .map(|s| (s.cause, s.sinks))
}

#[test]
fn nothing_is_demanded_below_three_stars() {
    let (mut sim, offices) = office_tower(GameMode::Classic, 2, 3);
    assert_eq!(binding(&mut sim, offices[0]), None);
    assert_eq!(after_hours(&mut sim, offices[0], 24), 1.0);
}

#[test]
fn classic_sinks_every_rated_tenant_on_any_trash_shortfall() {
    let (mut sim, offices) = office_tower(GameMode::Classic, 3, 3);
    stock_parking(&mut sim, W / 2, 0);
    // A condo and two hotel rooms in the free tiles past the last office.
    let mut rated = vec![offices[0]];
    for (kind, floor, x) in [
        (Kind::Condo, 2, W - 38),
        (Kind::HotelSingle, 3, W - 38),
        (Kind::HotelDouble, 3, W - 30),
    ] {
        let id = sim.tower.place(kind, floor, x).unit_id;
        let id = id.unwrap_or_else(|| panic!("{kind:?} fits at {x}"));
        seat(&mut sim, id, UnitState::Occupied, 1.0);
        rated.push(id);
    }
    assert!(sim.tower.total_population() < 2_500, "one center would do");
    for &id in &rated {
        let kind = unit(&sim, id).kind;
        assert_eq!(binding(&mut sim, id), Some((TRASH_CAUSE, true)), "{kind:?}");
        assert!(after_hours(&mut sim, id, 24) < VACATE_RESCIND, "{kind:?}");
    }
    stock_recycling(&mut sim, -3, 0, 1);
    // Served, each settles where its own placement puts it (a hotel room
    // beside an office hears it), well clear of notice.
    for &id in &rated {
        assert_eq!(binding(&mut sim, id), None);
        assert!(after_hours(&mut sim, id, 24) > VACATE_RESCIND);
    }
    assert_eq!(after_hours(&mut sim, offices[0], 24), 1.0);
}

#[test]
fn modern_holds_at_good_until_more_than_one_center_short() {
    let (mut small, offices) = office_tower(GameMode::Modern, 3, 3);
    stock_parking(&mut small, W / 2, 0);
    assert_eq!(binding(&mut small, offices[0]), Some((TRASH_CAUSE, false)));
    let held = after_hours(&mut small, offices[0], 48);
    assert_eq!(held, SHORTFALL_CAP, "held at the Good line, never evicted");

    let (mut big, offices) = office_tower(GameMode::Modern, 3, 18);
    stock_parking(&mut big, W / 2, -3);
    assert!(
        big.tower.total_population() > 2_500,
        "more than a center short"
    );
    assert_eq!(binding(&mut big, offices[0]), Some((TRASH_CAUSE, true)));
    assert!(after_hours(&mut big, offices[0], 24) < VACATE_RESCIND);
}

#[test]
fn classic_offices_sink_only_when_no_parking_is_left_for_them() {
    let (mut sim, offices) = office_tower(GameMode::Classic, 3, 3);
    stock_recycling(&mut sim, -3, 0, 1);
    let first = offices[0];
    assert_eq!(binding(&mut sim, first), Some((PARKING_CAUSE, true)));
    assert!(after_hours(&mut sim, first, 24) < VACATE_RESCIND);

    // One free space parks every office: Classic counts no ratio.
    assert!(sim.tower.place(Kind::ParkingRamp, 0, W / 2).ok);
    assert!(sim.tower.place(Kind::Parking, 0, W / 2 + 16).ok);
    assert_eq!(binding(&mut sim, first), None);

    // A hotel guest takes it; an empty suite does not.
    let suite = sim.tower.place(Kind::HotelSuite, 3, 0);
    let suite = suite
        .unit_id
        .unwrap_or_else(|| panic!("{:?}", suite.reason));
    assert_eq!(binding(&mut sim, first), None, "an empty suite");
    seat(&mut sim, suite, UnitState::Asleep, 1.0);
    assert_eq!(binding(&mut sim, first), Some((PARKING_CAUSE, true)));
}

#[test]
fn modern_parks_the_lowest_offices_first() {
    let (mut sim, offices) = office_tower(GameMode::Modern, 3, 3);
    stock_recycling(&mut sim, -3, 0, 1);
    let per_floor = offices.len() / 2;
    // Spaces for floor 2's workers and a few more: floor 3 is mostly short,
    // yet coverage stays over half, so it is held at Good.
    let spaces = (per_floor as f64 * 6.0 / 24.0).ceil() as i64 + 2;
    assert!(sim.tower.place(Kind::ParkingRamp, 0, 0).ok);
    for i in 0..spaces {
        assert!(sim.tower.place(Kind::Parking, 0, 16 + i * 4).ok);
    }
    let low = offices[0];
    let high = *offices.last().unwrap();
    assert_eq!(unit(&sim, low).floor, 2);
    assert_eq!(unit(&sim, high).floor, 3);
    assert_eq!(binding(&mut sim, low), None);
    assert_eq!(binding(&mut sim, high), Some((PARKING_CAUSE, false)));
    assert_eq!(after_hours(&mut sim, high, 48), SHORTFALL_CAP);
}

#[test]
fn the_move_in_gate_holds_an_office_with_nowhere_to_park() {
    let (mut sim, offices) = office_tower(GameMode::Classic, 3, 3);
    stock_recycling(&mut sim, -3, 0, 1);
    let empty = offices[0];
    for &id in &offices {
        seat(&mut sim, id, UnitState::Empty, 1.0);
    }
    let probe = unit(&sim, empty).clone();
    let mut ctx = sim.build_satisfaction_context(true);
    assert!(sim.would_evict_fresh_tenant(&probe, &mut ctx));
    // The inspector's "won't lease" line names the cause the gate held it
    // for, counting the newcomer as the gate did.
    let held = sim.diagnostic_facts(empty).unwrap().wont_lease.unwrap();
    let g = held.gripe.unwrap();
    assert_eq!((g.cause, g.coverage), (PARKING_CAUSE, Some(0.0)));
    stock_parking(&mut sim, W / 2, 0);
    let mut ctx = sim.build_satisfaction_context(true);
    assert!(!sim.would_evict_fresh_tenant(&probe, &mut ctx));
}

#[test]
fn the_inspector_names_the_trash_and_its_coverage() {
    let (mut sim, offices) = office_tower(GameMode::Classic, 3, 3);
    stock_parking(&mut sim, W / 2, 0);
    sim.tower.get_unit_mut(offices[0]).unwrap().satisfaction = 0.3;
    let g = sim.diagnostic_facts(offices[0]).unwrap().gripe.unwrap();
    assert_eq!(g.cause, TRASH_CAUSE);
    assert_eq!(g.coverage, Some(0.0));
}

#[test]
fn each_mode_names_its_shortfall_rules() {
    use crate::rules::OfficeParking;
    use crate::satisfaction::shortfall::{SHORTFALL_SINK_COVERAGE, TRASH_SINK_MISSING_CAPACITY};
    let (classic, modern) = (GameMode::Classic, GameMode::Modern);
    assert!(classic.trash_shortfall_sinks(1.0));
    assert!(!classic.trash_shortfall_sinks(0.0));
    assert!(!modern.trash_shortfall_sinks(TRASH_SINK_MISSING_CAPACITY));
    assert!(modern.trash_shortfall_sinks(TRASH_SINK_MISSING_CAPACITY + 1.0));
    assert!(classic.office_parking_shortfall_sinks(0.99));
    assert!(!modern.office_parking_shortfall_sinks(SHORTFALL_SINK_COVERAGE));
    assert!(modern.office_parking_shortfall_sinks(SHORTFALL_SINK_COVERAGE - 0.01));
    assert_eq!(classic.office_parking(), OfficeParking::AnyFreeSpace);
    assert_eq!(
        modern.office_parking(),
        OfficeParking::WorkersPerSpace(crate::services::PARKING_WORKERS_PER_SPACE)
    );
}

#[test]
fn modern_parks_the_leftmost_offices_of_a_floor_first() {
    let (mut sim, offices) = office_tower(GameMode::Modern, 3, 2);
    stock_recycling(&mut sim, -3, 0, 1);
    // One space parks four offices (24 workers); the rest of floor 2 waits.
    assert!(sim.tower.place(Kind::ParkingRamp, 0, 0).ok);
    assert!(sim.tower.place(Kind::Parking, 0, 16).ok);
    let mut by_x = offices.clone();
    by_x.sort_by_key(|&id| unit(&sim, id).x);
    for &id in &by_x[..4] {
        assert_eq!(binding(&mut sim, id), None, "office {id} parks");
    }
    for &id in &by_x[4..] {
        assert_eq!(binding(&mut sim, id).map(|b| b.0), Some(PARKING_CAUSE));
    }
}

#[test]
fn a_shortfall_vacate_reason_survives_a_save() {
    let (mut sim, offices) = office_tower(GameMode::Classic, 3, 2);
    for (id, reason) in [(offices[0], TRASH_CAUSE), (offices[1], PARKING_CAUSE)] {
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.state = UnitState::Vacating;
        u.extras_mut().vacate_reason = Some(reason);
    }
    let back = crate::load::deserialize(&sim.serialize()).expect("the save loads");
    for (id, reason) in [(offices[0], TRASH_CAUSE), (offices[1], PARKING_CAUSE)] {
        let u = back.tower.get_unit(id).unwrap();
        assert_eq!(u.extras().vacate_reason, Some(reason));
    }
}
