//! The halo table (`GameMode::halos`, which the catalog publishes for the
//! placement range rings) says what the hourly satisfaction step does: for
//! every venue and every room kind, the step moves the room exactly when the
//! table says that kind feels the venue, in the direction and to the reach
//! it names (#1980).
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::rules::HaloEffect;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{lot_tower, put, seat, MID as C};

/// The rooms a tenant lives or works in, which satisfaction is stepped for.
const ROOMS: [Kind; 9] = [
    Kind::Condo,
    Kind::RentalApartment,
    Kind::RentalStudio,
    Kind::HotelSingle,
    Kind::HotelDouble,
    Kind::HotelSuite,
    Kind::Office,
    Kind::FitnessClub,
    Kind::Clinic,
];

/// A content room of `room` on floor 3 at 22:00 (every venue open), with
/// `venue` on the floor `distance` floors above when given. Returns the
/// room's satisfaction after one step from 0.5.
fn step(room: Kind, venue: Option<(Kind, i64)>) -> f64 {
    let mut sim: Simulation = lot_tower(5, GameMode::Modern, 12);
    let id = put(&mut sim, room, 3, C);
    seat(&mut sim, id, UnitState::Occupied, 0.5);
    sim.tower.get_unit_mut(id).unwrap().residents = Some(5);
    if let Some((kind, distance)) = venue {
        let v = put(&mut sim, kind, 3 + distance, C);
        seat(&mut sim, v, UnitState::Occupied, 1.0);
    }
    sim.clock.minutes = 22.0 * 60.0;
    let mut ctx = sim.build_satisfaction_context(false);
    let u = sim.tower.get_unit(id).unwrap().clone();
    sim.satisfaction_step(&u, 0.5, &mut ctx).next
}

#[test]
fn the_step_moves_a_room_exactly_as_the_halo_table_says() {
    let halos = GameMode::Modern.halos();
    assert_eq!(halos.len(), 4, "fitness club, spa, daycare and nightclub");
    for room in ROOMS {
        let alone = step(room, None);
        for h in halos {
            let near = step(room, Some((h.source, 1))) - alone;
            if !h.felt_by(room) {
                assert_eq!(near, 0.0, "{:?} is not felt by {room:?}", h.source);
                continue;
            }
            match h.effect {
                HaloEffect::Lift => assert!(near > 0.0, "{:?} lifts {room:?}: {near}", h.source),
                HaloEffect::Drain => assert!(near < 0.0, "{:?} drains {room:?}: {near}", h.source),
            }
            let edge = step(room, Some((h.source, h.floors as i64))) - alone;
            assert_eq!(edge, 0.0, "{:?} stops at {} floors", h.source, h.floors);
        }
    }
}

#[test]
fn classic_has_no_halos() {
    assert!(GameMode::Classic.halos().is_empty());
    for h in GameMode::Modern.halos() {
        assert!(GameMode::Classic.halo_of(h.source).is_none());
        assert!(std::ptr::eq(GameMode::Modern.halo_of(h.source).unwrap(), h));
    }
}

/// A content condo of five on floor 3 with each `(venue, floor)` built and
/// open: its inspector's amenity fact.
fn amenity_near(mode: GameMode, venues: &[(Kind, i64)]) -> Option<(&'static str, f64)> {
    amenity_in(mode, UnitState::Occupied, venues)
}

/// As [`amenity_near`], with the condo in `state`.
fn amenity_in(
    mode: GameMode,
    state: UnitState,
    venues: &[(Kind, i64)],
) -> Option<(&'static str, f64)> {
    let mut sim = lot_tower(5, mode, 12);
    let condo = put(&mut sim, Kind::Condo, 3, C);
    seat(&mut sim, condo, state, 1.0);
    sim.tower.get_unit_mut(condo).unwrap().residents = Some(5);
    for &(kind, floor) in venues {
        // A venue on the condo's own floor stands further along it.
        let x = if floor == 3 { C - 40 } else { C };
        let v = put(&mut sim, kind, floor, x);
        seat(&mut sim, v, UnitState::Occupied, 1.0);
    }
    let a = sim.diagnostic_facts(condo).unwrap().amenity?;
    Some((a.kind, a.lift))
}

#[test]
fn the_inspector_names_the_amenity_that_lifts_a_room_most() {
    use crate::rules::AMENITY_CAP_LIFT_MAX as LIFT;
    let one_floor = |floors: f64| LIFT * (1.0 - 1.0 / floors);
    let gym = GameMode::Modern.halo_of(Kind::FitnessClub).unwrap();
    let modern = GameMode::Modern;
    assert_eq!(
        amenity_near(modern, &[(Kind::FitnessClub, 4)]),
        Some(("fitnessClub", one_floor(gym.floors)))
    );
    // The daycare's own floor beats the gym a floor up (a family of five
    // gets the daycare at full strength).
    assert_eq!(
        amenity_near(modern, &[(Kind::FitnessClub, 4), (Kind::Daycare, 3)]),
        Some(("daycare", LIFT))
    );
    assert_eq!(
        amenity_near(modern, &[(Kind::FitnessClub, 3 + gym.floors as i64)]),
        None,
        "out of reach"
    );
    assert_eq!(
        amenity_near(modern, &[(Kind::Spa, 4)]),
        None,
        "the spa helps hotels"
    );
    assert_eq!(
        amenity_near(modern, &[(Kind::Nightclub, 4)]),
        None,
        "a drain"
    );
    assert_eq!(amenity_near(GameMode::Classic, &[]), None);
    let gutted = amenity_in(modern, UnitState::Gutted, &[(Kind::FitnessClub, 4)]);
    assert_eq!(gutted, None, "a gutted room has no tenant to help");
}
