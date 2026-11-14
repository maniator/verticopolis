//! A venue's visitors keep its opening hours (owner's report, 2026-11-14:
//! people standing in a closed cinema at 00:46). Everyone inside leaves
//! when it closes, someone who arrives after closing turns back, and nobody
//! sets out for a show in its last hour.
use crate::clock::{CalendarKind, Clock, GameMode};
use crate::crowd::spawn::{add, open_for_visits, spawn_floors};
use crate::crowd::visits::{begin_dwell, spawn_venue_visit, VisitOrigin};
use crate::crowd::PState;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// A lobby, floors 2 to 4, one elevator and a tenanted party hall on 2
/// (open 17:00 to midnight).
fn hall_tower() -> (Simulation, i64) {
    let mut sim = Simulation::new_game_with(2024, GameMode::Modern, CalendarKind::RealWorld, false);
    sim.money = 10_000_000.0;
    for x in 0..40 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=4 {
        for x in 0..40 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 36, 1, 4)
            .ok
    );
    let hall = sim.tower.place(Kind::PartyHall, 2, 0).unit_id.unwrap();
    sim.tower.get_unit_mut(hall).unwrap().state = UnitState::Occupied;
    (sim, hall)
}

fn at(sim: &mut Simulation, minutes: f64) {
    sim.clock = Clock::new(minutes, sim.clock.calendar);
    sim.last_hour = sim.clock.hour();
}

/// A visitor from the lobby who reaches `hall` now.
fn arrive(sim: &mut Simulation, hall: i64) -> usize {
    sim.crowd.hour = Some(sim.clock.hour());
    let i = add(&mut sim.crowd, &sim.tower, 1, 2, None, None).unwrap();
    sim.crowd.people[i].meal_venue_id = Some(hall);
    begin_dwell(&mut sim.crowd, &mut sim.tower, i);
    i
}

fn inside(sim: &Simulation, hall: i64) -> i64 {
    sim.tower.get_unit(hall).unwrap().customers_in.unwrap_or(0)
}

#[test]
fn the_audience_leaves_when_the_venue_closes() {
    let (mut sim, hall) = hall_tower();
    at(&mut sim, 23.0 * 60.0 + 50.0);
    let i = arrive(&mut sim, hall);
    assert_eq!(inside(&sim, hall), 1);
    assert_eq!(sim.crowd.people[i].state, PState::Dwelling);
    // A party lasts an hour or more, so only closing ends this one by 00:10.
    assert!(sim.crowd.people[i].dwell_seconds_left.unwrap() >= 120.0);
    sim.tick(20.0);
    assert_eq!(sim.clock.hour(), 0);
    assert_eq!(inside(&sim, hall), 0);
    assert_eq!(sim.tower.get_unit(hall).unwrap().occupants, 0);
    let still_inside = sim
        .crowd
        .people
        .iter()
        .filter(|p| p.state == PState::Dwelling)
        .count();
    assert_eq!(still_inside, 0);
}

#[test]
fn someone_who_arrives_after_closing_turns_back() {
    let (mut sim, hall) = hall_tower();
    at(&mut sim, 60.0 + 5.0);
    let i = arrive(&mut sim, hall);
    assert_eq!(inside(&sim, hall), 0);
    assert_eq!(sim.crowd.people[i].venue_unit_id, None);
    assert_eq!(sim.crowd.people[i].dwell_seconds_left, Some(0.0));
}

#[test]
fn an_open_venue_keeps_its_audience() {
    let (mut sim, hall) = hall_tower();
    at(&mut sim, 20.0 * 60.0);
    let i = arrive(&mut sim, hall);
    sim.tick(10.0);
    assert_eq!(sim.crowd.people[i].state, PState::Dwelling);
    // The crowd brings more guests while it is open.
    assert!(inside(&sim, hall) >= 1);
}

#[test]
fn nobody_sets_out_for_a_show_in_its_last_hour() {
    for (kind, last, earlier) in [
        (Kind::Cinema, 23, 22),
        (Kind::PartyHall, 23, 22),
        (Kind::AquaticCenter, 21, 20),
    ] {
        assert!(!open_for_visits(kind, last), "{kind:?} at {last}");
        assert!(open_for_visits(kind, earlier), "{kind:?} at {earlier}");
    }
    // A meal fits in a restaurant's last hour; a closed one takes nobody.
    for (kind, last, closed) in [(Kind::Restaurant, 13, 14), (Kind::FastFood, 21, 22)] {
        assert!(open_for_visits(kind, last), "{kind:?} at {last}");
        assert!(!open_for_visits(kind, closed), "{kind:?} at {closed}");
    }
    let (mut sim, _) = hall_tower();
    at(&mut sim, 23.0 * 60.0 + 10.0);
    let floors = spawn_floors(&sim.tower, &sim.clock);
    let before = sim.crowd.people.len();
    for _ in 0..20 {
        spawn_venue_visit(
            &mut sim.crowd,
            &mut sim.tower,
            Kind::PartyHall,
            &[2],
            &floors,
            23,
            VisitOrigin::Outside,
        );
    }
    assert_eq!(sim.crowd.people.len(), before);
}
