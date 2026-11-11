//! Where venue visitors come from, from the retired
//! `venueOrigins.integration.test.ts`: the party hall draws from the street,
//! the condos and the hotel (never the offices), the cinema adds the
//! staffed-office matinee, a room-origin visitor thins their room, and the
//! wedding hall draws street guests at weekend middays only, none to an
//! unreachable hall, with the presence pass keeping its house. The suite
//! counted the option list `pushVenueVisitOptions` builds; the Rust option
//! list is private to `crowd::spawn`, so each row is checked by the visit it
//! spawns (`spawn_venue_visit` returns before any draw for a row the venue
//! lacks or an origin bin that is empty).
use crate::clock::GameMode;
use crate::crowd::spawn_floors::spawn_floors;
use crate::crowd::visits::{spawn_venue_visit, VisitOrigin, WEDDING_ARRIVAL_START};
use crate::facilities::{Kind, MAX_FLOOR};
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::venue_attendance::{attend, party_hall_tower, tally};
use super::{at_time, place_seated, shaft, strip_tower};

const EVENING: i64 = 18;
const MATINEE: i64 = 14;
const SATURDAY: i64 = 5;
/// The wedding hall's width, and the slab the wedding tower lays under it.
const HALL_WIDTH: i64 = 28;
const SLAB_WIDTH: i64 = 32;

/// Spawns one visit to `kind` from `origin` at `hour` on `day` and returns
/// the origin room's kind of the visitor it sent, `Some(None)` for a street
/// visitor and `None` when it sent nobody.
fn visit(
    sim: &mut Simulation,
    kind: Kind,
    origin: VisitOrigin,
    day: i64,
    hour: i64,
) -> Option<Option<Kind>> {
    at_time(sim, day, hour);
    let floors = spawn_floors(&sim.tower, &sim.clock);
    let venues = floors
        .venues_by_kind
        .get(&kind)
        .cloned()
        .unwrap_or_default();
    assert!(!venues.is_empty(), "{kind:?} is listed at {hour}:00");
    let before = sim.crowd.people.len();
    spawn_venue_visit(
        &mut sim.crowd,
        &mut sim.tower,
        kind,
        &venues,
        &floors,
        hour,
        origin,
    );
    let p = sim.crowd.people.get(before)?;
    Some(
        p.origin_unit_id
            .map(|id| sim.tower.get_unit(id).unwrap().kind),
    )
}

#[test]
fn a_party_draws_the_street_the_hotel_and_the_condos_never_the_offices() {
    let (mut sim, _, _) = party_hall_tower();
    place_seated(&mut sim, Kind::Office, 5, 20, UnitState::Occupied, 6);
    let hall = |sim: &mut Simulation, origin| visit(sim, Kind::PartyHall, origin, 0, EVENING);
    assert_eq!(hall(&mut sim, VisitOrigin::Outside), Some(None));
    assert_eq!(
        hall(&mut sim, VisitOrigin::Hotel),
        Some(Some(Kind::HotelSingle))
    );
    assert_eq!(hall(&mut sim, VisitOrigin::Condo), None, "no residents yet");
    assert_eq!(
        hall(&mut sim, VisitOrigin::Office),
        None,
        "not a party-hall row"
    );
    place_seated(&mut sim, Kind::Condo, 5, 0, UnitState::Occupied, 3);
    assert_eq!(hall(&mut sim, VisitOrigin::Condo), Some(Some(Kind::Condo)));
}

/// A Modern strip to floor 3, 60 wide, an elevator at x 56 and a tenanted
/// cinema on floor 2.
fn cinema_tower() -> (Simulation, i64) {
    let mut sim = strip_tower(2024, GameMode::Modern, 60, 3);
    shaft(&mut sim, Kind::ElevatorStandard, 56, 1, 3);
    let cinema = place_seated(&mut sim, Kind::Cinema, 2, 0, UnitState::Occupied, 0);
    (sim, cinema)
}

fn staffed_office(sim: &mut Simulation) -> i64 {
    let staff = Kind::Office.facility().population;
    place_seated(sim, Kind::Office, 3, 40, UnitState::Occupied, staff)
}

#[test]
fn a_matinee_draws_the_street_and_a_staffed_office() {
    let (mut sim, _) = cinema_tower();
    let show = |sim: &mut Simulation, origin| visit(sim, Kind::Cinema, origin, 0, MATINEE);
    assert_eq!(show(&mut sim, VisitOrigin::Outside), Some(None));
    assert_eq!(show(&mut sim, VisitOrigin::Office), None, "no office yet");
    staffed_office(&mut sim);
    assert_eq!(
        show(&mut sim, VisitOrigin::Office),
        Some(Some(Kind::Office))
    );
}

/// Ticks from `hour` until a visitor to `venue` from `room` shows up, and
/// checks the room is thinned while they are out.
fn room_goes_out(sim: &mut Simulation, venue: i64, room: i64, hour: i64) -> bool {
    at_time(sim, 0, hour);
    let out = (0..360).any(|_| {
        sim.tick(1.0);
        sim.crowd
            .people
            .iter()
            .any(|p| p.meal_venue_id == Some(venue) && p.origin_unit_id == Some(room))
    });
    out && sim.tower.get_unit(room).unwrap().out_for_meal.unwrap_or(0) > 0
}

#[test]
fn office_workers_catch_a_matinee_and_thin_the_office() {
    let (mut sim, cinema) = cinema_tower();
    let office = staffed_office(&mut sim);
    assert!(room_goes_out(&mut sim, cinema, office, 13));
}

#[test]
fn residents_go_to_the_party_and_thin_their_home() {
    let (mut sim, hall, _) = party_hall_tower();
    let home = place_seated(&mut sim, Kind::Condo, 5, 0, UnitState::Occupied, 3);
    assert!(room_goes_out(&mut sim, hall, home, EVENING));
}

/// A lobby, a slab to floor 100 under the hall, the wedding hall on floor
/// 100 (never tenanted) and, when `served`, an express to the top.
fn wedding_tower(served: bool) -> (Simulation, i64) {
    let mut sim = strip_tower(2024, GameMode::Modern, 40, 1);
    for floor in 2..=MAX_FLOOR {
        for x in 0..SLAB_WIDTH {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok, "{floor} {x}");
        }
    }
    if served {
        shaft(&mut sim, Kind::ElevatorExpress, HALL_WIDTH, 1, MAX_FLOOR);
    }
    let hall = sim.tower.place(Kind::WeddingHall, MAX_FLOOR, 0);
    assert!(hall.ok, "{:?}", hall.reason);
    (sim, hall.unit_id.unwrap())
}

#[test]
fn a_weekday_midday_brings_no_wedding_guests() {
    let (mut sim, hall) = wedding_tower(true);
    at_time(&mut sim, 0, WEDDING_ARRIVAL_START);
    for _ in 0..180 {
        sim.tick(1.0);
        assert!(!sim
            .crowd
            .people
            .iter()
            .any(|p| p.meal_venue_id == Some(hall)));
    }
    assert_eq!(tally(&sim, hall), 0);
}

#[test]
fn a_weekend_midday_brings_guests_to_the_hall() {
    let (mut sim, hall) = wedding_tower(true);
    at_time(&mut sim, SATURDAY, WEDDING_ARRIVAL_START);
    let (mut trip, mut attended) = (false, false);
    for _ in 0..300 {
        sim.tick(1.0);
        trip |= sim
            .crowd
            .people
            .iter()
            .any(|p| p.meal_venue_id == Some(hall));
        let house = tally(&sim, hall);
        if house > 0 {
            attended = true;
            assert_eq!(sim.tower.get_unit(hall).unwrap().occupants, house);
            assert!(house <= Kind::WeddingHall.attendance_cap().unwrap());
            break;
        }
    }
    assert!(trip && attended);
}

#[test]
fn wedding_guests_come_from_the_street_only() {
    let (mut sim, _) = wedding_tower(true);
    place_seated(&mut sim, Kind::Condo, 2, 0, UnitState::Occupied, 3);
    let guests = Kind::HotelSingle.facility().population;
    place_seated(&mut sim, Kind::HotelSingle, 3, 0, UnitState::Asleep, guests);
    // A local down to the lobby, so the residents and guests could reach the
    // hall: only the missing rows keep them home.
    shaft(&mut sim, Kind::ElevatorStandard, 20, 1, 3);
    for floor in [2, 3] {
        let home = sim
            .crowd
            .route(&sim.tower, floor, MAX_FLOOR, Some(2.0), Some(4.0));
        assert!(home.is_some(), "floor {floor} reaches the hall");
    }
    at_time(&mut sim, SATURDAY, WEDDING_ARRIVAL_START);
    let floors = spawn_floors(&sim.tower, &sim.clock);
    assert!(!floors.condo_floors.is_empty() && !floors.hotel_floors.is_empty());
    let wed = |sim: &mut Simulation, origin| {
        visit(
            sim,
            Kind::WeddingHall,
            origin,
            SATURDAY,
            WEDDING_ARRIVAL_START,
        )
    };
    assert_eq!(wed(&mut sim, VisitOrigin::Condo), None);
    assert_eq!(wed(&mut sim, VisitOrigin::Hotel), None);
    assert_eq!(wed(&mut sim, VisitOrigin::Outside), Some(None));
}

#[test]
fn an_unreachable_wedding_hall_receives_nobody() {
    let (mut sim, hall) = wedding_tower(false);
    let sent = visit(
        &mut sim,
        Kind::WeddingHall,
        VisitOrigin::Outside,
        SATURDAY,
        WEDDING_ARRIVAL_START,
    );
    assert_eq!(sent, None, "listed, but no route");
    assert_eq!(tally(&sim, hall), 0);
}

#[test]
fn the_presence_pass_keeps_a_wedding_house_on_the_untenanted_hall() {
    let (mut sim, hall) = wedding_tower(true);
    assert_eq!(sim.tower.get_unit(hall).unwrap().state, UnitState::Empty);
    attend(&mut sim, hall, 6);
    at_time(&mut sim, SATURDAY, 12);
    sim.update_presence();
    assert_eq!(sim.tower.get_unit(hall).unwrap().occupants, 6);
}
