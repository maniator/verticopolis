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
    step_beside(room, venue.map(|(kind, distance)| (kind, 3 + distance, C)))
}

/// As [`step`], with the venue's lowest story on `floor` at `x`.
fn step_beside(room: Kind, venue: Option<(Kind, i64, i64)>) -> f64 {
    let mut sim: Simulation = lot_tower(5, GameMode::Modern, 12);
    let id = put(&mut sim, room, 3, C);
    seat(&mut sim, id, UnitState::Occupied, 0.5);
    sim.tower.get_unit_mut(id).unwrap().residents = Some(5);
    if let Some((kind, floor, x)) = venue {
        let v = put(&mut sim, kind, floor, x);
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
    assert_eq!(
        halos.len(),
        6,
        "fitness club, nightclub, spa, daycare, aquatic center and party hall"
    );
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
        // Each venue casts one halo: the lookup finds this entry, by source.
        let found = GameMode::Modern.halo_of(h.source).expect("listed");
        assert_eq!(
            (found.source, found.floors, found.max),
            (h.source, h.floors, h.max)
        );
    }
}

#[test]
fn a_family_scaled_halo_fades_over_its_own_reach_from_its_own_maximum() {
    let modern = GameMode::Modern;
    let daycare = *modern.halo_of(Kind::Daycare).expect("listed");
    for d in [0.0, 1.0, 2.5, 3.0, 4.0, 6.0] {
        for family in [1.0, 2.0, 3.0, 5.0] {
            assert_eq!(
                modern.halo_strength(&daycare, d, family),
                modern.daycare_family_bonus(d, family),
                "the table's daycare at d {d}, family {family}"
            );
        }
    }
    let mut wider = daycare;
    wider.floors = 8.0;
    wider.max = 0.07;
    let at = |d: f64, family: f64| modern.halo_strength(&wider, d, family);
    assert!((at(5.0, 5.0) - 0.07 * (1.0 - 5.0 / 8.0)).abs() < 1e-12);
    assert!(
        (at(0.0, 2.0) - 0.07 * 0.4).abs() < 1e-12,
        "the smallest family's share"
    );
    assert_eq!(at(8.0, 5.0), 0.0, "none at its reach");
    assert_eq!(at(0.0, 1.0), 0.0, "none without a family");
    assert_eq!(GameMode::Classic.halo_strength(&wider, 0.0, 5.0), 0.0);
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
        let x = if (floor..floor + kind.floors()).contains(&3) {
            C - 40
        } else {
            C
        };
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

#[test]
fn the_aquatic_center_and_party_hall_lift_homes_and_hotel_rooms() {
    let modern = GameMode::Modern;
    for kind in [Kind::AquaticCenter, Kind::PartyHall] {
        let h = modern.halo_of(kind).expect("listed");
        assert_eq!(h.effect, HaloEffect::Lift, "{kind:?}");
        assert!(!h.open_hours_only, "{kind:?} is felt at every hour");
        for room in [Kind::Condo, Kind::RentalApartment, Kind::HotelSuite] {
            assert!(h.felt_by(room), "{kind:?} lifts {room:?}");
        }
        assert!(!h.felt_by(Kind::Office), "{kind:?} does not lift an office");
    }
    let pool = modern.halo_of(Kind::AquaticCenter).unwrap();
    let hall = modern.halo_of(Kind::PartyHall).unwrap();
    assert!(
        pool.floors > hall.floors && pool.max > hall.max,
        "the pool outdoes the hall"
    );
    let pool_lift = amenity_near(modern, &[(Kind::AquaticCenter, 4)]);
    let hall_lift = amenity_near(modern, &[(Kind::PartyHall, 4)]);
    assert_eq!(pool_lift.map(|a| a.0), Some("aquaticCenter"));
    assert_eq!(hall_lift.map(|a| a.0), Some("partyHall"));
}

/// A two-story venue reaches from its nearer story: a room on either story
/// it fills feels it at full strength, and one a floor above its top story
/// feels it one floor away.
#[test]
fn a_two_story_venue_reaches_from_its_nearer_story() {
    let modern = GameMode::Modern;
    let pool = modern.halo_of(Kind::AquaticCenter).unwrap();
    assert_eq!(Kind::AquaticCenter.floors(), 2);
    assert_eq!(pool.distance(2, 2), 0);
    assert_eq!(pool.distance(2, 3), 0, "its upper story");
    assert_eq!(pool.distance(2, 4), 1);
    assert_eq!(pool.distance(2, 0), 2);
    let gym = modern.halo_of(Kind::FitnessClub).unwrap();
    assert_eq!(gym.distance(2, 3), 1, "a one-story venue");
    // The step agrees: the pool on floors 2 and 3 lifts the condo on 3 as
    // much as a pool whose lowest story is the condo's floor, and more than
    // one on floors 4 and 5.
    let beside = |floor: i64| step_beside(Kind::Condo, Some((Kind::AquaticCenter, floor, C - 40)));
    let (upper, level, above) = (beside(2), beside(3), beside(4));
    assert_eq!(
        upper, level,
        "the upper story counts as the venue's own floor"
    );
    assert!(above < upper, "a pool on floors 4 and 5 is a floor away");
    assert_eq!(
        amenity_near(modern, &[(Kind::AquaticCenter, 2)]),
        Some(("aquaticCenter", crate::rules::AMENITY_CAP_LIFT_MAX))
    );
}
