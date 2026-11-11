//! The arrival recheck and the mid-visit teardowns of the attendance
//! tallies (#302, #360). The full-day reconcile, the bulldozed origin, the
//! venue bulldozed under counted visitors and the fire mid-show run on the
//! engine in `attendanceTripwireEngine.integration.test.ts`.
use crate::clock::{CalendarKind, Clock, GameMode};
use crate::crowd::motion::finish;
use crate::crowd::spawn::add;
use crate::crowd::visits::begin_dwell;
use crate::crowd::PState;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// Lobby, floors 2 to 6, one elevator, a tenanted party hall on 2, a fast
/// food and an office on 4 and an asleep hotel single on 5: every tally kind.
fn mixed_tower() -> Simulation {
    let mut sim = Simulation::new_game_with(2024, GameMode::Modern, CalendarKind::RealWorld, false);
    sim.money = 10_000_000.0;
    sim.star = 1;
    for x in 0..40 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=6 {
        for x in 0..40 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 36, 1, 6)
            .ok
    );
    for (kind, floor, x, state, occupants) in [
        (Kind::PartyHall, 2, 0, UnitState::Occupied, None),
        (Kind::FastFood, 4, 0, UnitState::Occupied, None),
        (Kind::Office, 4, 18, UnitState::Occupied, Some(6)),
        (Kind::HotelSingle, 5, 0, UnitState::Asleep, Some(1)),
    ] {
        let id = sim.tower.place(kind, floor, x).unit_id.unwrap();
        let unit = sim.tower.get_unit_mut(id).unwrap();
        unit.state = state;
        if let Some(n) = occupants {
            unit.occupants = n;
        }
    }
    sim
}

fn at_hour(sim: &mut Simulation, hour: i64) {
    sim.clock = Clock::new((hour * 60) as f64, sim.clock.calendar);
}

fn unit_id(sim: &Simulation, kind: Kind) -> i64 {
    sim.tower.units.iter().find(|u| u.kind == kind).unwrap().id
}

fn tally(sim: &Simulation, id: i64) -> i64 {
    sim.tower.get_unit(id).unwrap().customers_in.unwrap_or(0)
}

/// A rider bound for `venue`, whose state is set to `state` before arrival.
fn arrive(sim: &mut Simulation, venue: i64, state: UnitState) -> usize {
    let floor = sim.tower.get_unit(venue).unwrap().floor;
    let i = add(&mut sim.crowd, &sim.tower, 1, floor, None, None).unwrap();
    sim.crowd.people[i].meal_venue_id = Some(venue);
    sim.tower.get_unit_mut(venue).unwrap().state = state;
    begin_dwell(&mut sim.crowd, &mut sim.tower, i);
    i
}

#[test]
fn a_venue_that_vacated_or_burned_before_arrival_takes_no_customer() {
    for state in [UnitState::Empty, UnitState::Fire] {
        let mut sim = mixed_tower();
        at_hour(&mut sim, 12);
        let food = unit_id(&sim, Kind::FastFood);
        let i = arrive(&mut sim, food, state);
        assert_eq!(tally(&sim, food), 0, "{state:?}");
        assert_eq!(sim.crowd.people[i].venue_unit_id, None);
        assert_eq!(sim.crowd.people[i].state, PState::Dwelling);
        // The uncounted dweller's despawn takes nothing back: zero stays zero.
        finish(&mut sim.crowd, i, &mut sim.tower);
        assert_eq!(tally(&sim, food), 0);
        assert_eq!(sim.crowd.people[i].state, PState::Done);
    }
}

#[test]
fn a_vacated_party_hall_seats_no_counted_audience() {
    let mut sim = mixed_tower();
    at_hour(&mut sim, 12);
    let hall = unit_id(&sim, Kind::PartyHall);
    let i = arrive(&mut sim, hall, UnitState::Empty);
    assert_eq!(tally(&sim, hall), 0);
    assert_eq!(sim.tower.get_unit(hall).unwrap().occupants, 0);
    assert_eq!(sim.crowd.people[i].venue_unit_id, None);
}

#[test]
fn a_tenanted_venue_at_arrival_counts_the_customer() {
    let mut sim = mixed_tower();
    at_hour(&mut sim, 12);
    let food = unit_id(&sim, Kind::FastFood);
    let i = arrive(&mut sim, food, UnitState::Occupied);
    assert_eq!(tally(&sim, food), 1);
    assert_eq!(sim.crowd.people[i].venue_unit_id, Some(food));
}

#[test]
fn a_hotel_guest_counted_at_a_bulldozed_venue_still_balances_its_room() {
    let mut sim = mixed_tower();
    at_hour(&mut sim, 12);
    let food = unit_id(&sim, Kind::FastFood);
    let room = unit_id(&sim, Kind::HotelSingle);
    let (room_floor, food_floor) = (sim.tower.get_unit(room).unwrap().floor, 4);
    let i = add(
        &mut sim.crowd,
        &sim.tower,
        room_floor,
        food_floor,
        None,
        None,
    )
    .unwrap();
    sim.crowd.people[i].meal_venue_id = Some(food);
    sim.crowd.people[i].origin_unit_id = Some(room);
    sim.tower.get_unit_mut(room).unwrap().out_for_meal = Some(1);
    begin_dwell(&mut sim.crowd, &mut sim.tower, i);
    let venue = sim.tower.get_unit(food).unwrap();
    assert_eq!(
        (venue.customers_in, venue.hotel_customers_in),
        (Some(1), Some(1))
    );
    assert!(sim.crowd.people[i].counted_hotel_guest);
    assert!(sim.tower.remove_unit(food).is_some());
    finish(&mut sim.crowd, i, &mut sim.tower);
    assert_eq!(sim.crowd.people[i].state, PState::Done);
    assert_eq!(
        sim.tower.get_unit(room).unwrap().out_for_meal.unwrap_or(0),
        0
    );
}

#[test]
fn a_load_mid_visit_starts_every_tally_at_zero_forged_saves_included() {
    let mut sim = mixed_tower();
    at_hour(&mut sim, 18);
    let hall = unit_id(&sim, Kind::PartyHall);
    for _ in 0..450 {
        if tally(&sim, hall) > 0 {
            break;
        }
        sim.tick(1.0);
    }
    for _ in 0..480 {
        if sim
            .tower
            .units
            .iter()
            .any(|u| u.out_for_meal.unwrap_or(0) > 0)
        {
            break;
        }
        sim.tick(1.0);
    }
    assert!(tally(&sim, hall) > 0, "the save carries a counted audience");
    assert!(sim
        .tower
        .units
        .iter()
        .any(|u| u.out_for_meal.unwrap_or(0) > 0));
    let mut save = sim.serialize();
    for unit in save["units"].as_array_mut().unwrap() {
        unit["customersIn"] = 999.into();
        unit["hotelCustomersIn"] = 999.into();
        unit["outForMeal"] = 999.into();
    }
    for raw in [sim.serialize(), save] {
        let loaded = deserialize(&raw).unwrap();
        assert!(loaded.crowd.people.is_empty());
        for u in &loaded.tower.units {
            assert_eq!(u.customers_in.unwrap_or(0), 0, "{:?}", u.kind);
            assert_eq!(u.hotel_customers_in.unwrap_or(0), 0, "{:?}", u.kind);
            assert_eq!(u.out_for_meal.unwrap_or(0), 0, "{:?}", u.kind);
        }
    }
}

#[test]
fn the_only_despawn_in_the_crowd_is_inside_finish() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src/crowd");
    let mut hits = Vec::new();
    let mut stack = vec![std::path::PathBuf::from(dir)];
    while let Some(path) = stack.pop() {
        if path.is_dir() {
            stack.extend(std::fs::read_dir(&path).unwrap().map(|e| e.unwrap().path()));
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        for (n, line) in text.lines().enumerate() {
            if line.contains(".state = PState::Done") {
                hits.push((path.file_name().unwrap().to_string_lossy().into_owned(), n));
            }
        }
    }
    assert_eq!(hits.len(), 1, "{hits:?}");
    let motion = std::fs::read_to_string(format!("{dir}/motion.rs")).unwrap();
    let start = motion.find("pub fn finish(").unwrap();
    let end = start + motion[start..].find("\n}\n").unwrap();
    assert!(motion[start..end].contains(".state = PState::Done"));
}

#[test]
fn every_tally_drains_to_zero_once_the_tower_quiets_down() {
    let mut sim = mixed_tower();
    at_hour(&mut sim, 18);
    let mut peak = 0;
    for _ in 0..420 {
        sim.tick(1.0);
        peak = peak.max(
            sim.tower
                .units
                .iter()
                .map(|u| u.customers_in.unwrap_or(0))
                .sum(),
        );
    }
    assert!(peak > 0);
    let drained = |sim: &Simulation| {
        sim.tower.units.iter().all(|u| {
            u.customers_in.unwrap_or(0) == 0
                && u.hotel_customers_in.unwrap_or(0) == 0
                && u.out_for_meal.unwrap_or(0) == 0
        })
    };
    for _ in 0..290 {
        if drained(&sim) {
            break;
        }
        sim.tick(1.0);
    }
    assert!(drained(&sim));
    assert!(sim
        .crowd
        .people
        .iter()
        .all(|p| p.state == PState::Done || p.venue_unit_id.is_none()));
}
