//! Routed attendance at the entertainment venues, from the retired
//! `venueAttendance.integration.test.ts`: the attendance tally never
//! reaches the census, the rating census, floor congestion or the
//! statistical elevator demand; its occupants mirror reads 0 on a ruin,
//! survives the presence pass and loads at 0; the catalog caps and the
//! dwell spans; a party hall's evening crowd (lobby and hotel guests) fills
//! and drains, survives a bulldozed hall or a lost elevator, and stays away
//! from a closed, full or unreachable hall; a cinema's matinee house; and a
//! blockbuster drawing more visits than an ordinary film.
use crate::clock::GameMode;
use crate::crowd::spawn::spawn_trips;
use crate::crowd::spawn_floors::spawn_floors;
use crate::crowd::visits::{booked_cinema_floors, spawn_venue_visit, VisitOrigin};
use crate::crowd::{
    dwell_seconds_range, CROWD_SECONDS_PER_MINUTE, EAT_SECONDS_MAX, EAT_SECONDS_MIN,
};
use crate::facilities::{Kind, FACILITIES};
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{at_time, place_seated, shaft, strip_tower};

const HALL_FLOOR: i64 = 2;
const EVENING: i64 = 18;
const LOBBY: i64 = 1;

/// A Modern strip to floor 5, an elevator at x 36, a tenanted two-story
/// party hall on floor 2 and an asleep hotel single (one guest) on floor 4.
/// Returns the sim, the hall and the hotel room.
pub(super) fn party_hall_tower() -> (Simulation, i64, i64) {
    let mut sim = strip_tower(2024, GameMode::Modern, 40, 5);
    shaft(&mut sim, Kind::ElevatorStandard, 36, 1, 5);
    let hall = place_seated(
        &mut sim,
        Kind::PartyHall,
        HALL_FLOOR,
        0,
        UnitState::Occupied,
        0,
    );
    let guests = Kind::HotelSingle.facility().population;
    let room = place_seated(&mut sim, Kind::HotelSingle, 4, 0, UnitState::Asleep, guests);
    (sim, hall, room)
}

/// Sets a venue's attendance tally and syncs its occupants mirror.
pub(super) fn attend(sim: &mut Simulation, id: i64, n: i64) {
    let (u, at) = sim.tower.marked_by_id(id).unwrap();
    u.customers_in = Some(n);
    u.sync_visitor_occupants(at);
}

pub(super) fn tally(sim: &Simulation, id: i64) -> i64 {
    sim.tower.get_unit(id).unwrap().customers_in.unwrap_or(0)
}

fn occupants(sim: &Simulation, id: i64) -> i64 {
    sim.tower.get_unit(id).unwrap().occupants
}

/// Ticks from 18:00 until the hall holds an audience.
fn until_attended(sim: &mut Simulation, hall: i64) {
    at_time(sim, 0, EVENING);
    let attended = (0..360).any(|_| {
        sim.tick(1.0);
        tally(sim, hall) > 0
    });
    assert!(attended, "nobody reached the hall");
}

#[test]
fn the_attendance_tally_stays_out_of_the_census_and_congestion() {
    let (mut sim, hall, _) = party_hall_tower();
    let population = sim.tower.total_population();
    let rating = sim.rating_population();
    let congestion = sim.spatial_congestion_by_floor();
    attend(&mut sim, hall, 5);
    assert_eq!(occupants(&sim, hall), 5, "the mirror follows the tally");
    assert_eq!(sim.tower.get_unit(hall).unwrap().census_count(), 0);
    assert_eq!(sim.tower.total_population(), population);
    assert_eq!(sim.rating_population(), rating);
    assert_eq!(sim.spatial_congestion_by_floor(), congestion);
}

#[test]
fn a_full_house_adds_no_statistical_elevator_demand() {
    let (mut sim, hall, _) = party_hall_tower();
    attend(&mut sim, hall, Kind::PartyHall.attendance_cap().unwrap());
    assert!(occupants(&sim, hall) > 0);
    sim.elevators.accumulate(&sim.tower, 10.0, 1.45);
    assert_eq!(
        sim.elevators.waiting_at(HALL_FLOOR),
        0.0,
        "the hall's floor"
    );
    assert!(
        sim.elevators.waiting_at(4) > 0.0,
        "the hotel guest's floor does wait"
    );
}

#[test]
fn attendance_kinds_are_census_inert_with_their_catalog_caps() {
    for f in FACILITIES.iter() {
        if let Some(cap) = f.attendance {
            assert_eq!(f.population, 0, "{:?} stays census-inert", f.kind);
            assert!(cap > 0, "{:?}", f.kind);
        }
    }
    for (kind, cap) in [
        (Kind::Cinema, Some(30)),
        (Kind::PartyHall, Some(20)),
        (Kind::WeddingHall, Some(12)),
        (Kind::AquaticCenter, Some(24)),
        (Kind::FastFood, None),
        (Kind::Office, None),
    ] {
        assert_eq!(kind.attendance_cap(), cap, "{kind:?}");
    }
}

#[test]
fn each_venue_holds_its_visitors_for_its_own_span() {
    let minutes = |lo: i64, hi: i64| {
        let m = CROWD_SECONDS_PER_MINUTE as i64;
        (lo * m, hi * m)
    };
    assert_eq!(dwell_seconds_range(Some(Kind::Cinema)), minutes(90, 120));
    assert_eq!(dwell_seconds_range(Some(Kind::PartyHall)), minutes(60, 120));
    assert_eq!(
        dwell_seconds_range(Some(Kind::WeddingHall)),
        minutes(120, 180)
    );
    assert_eq!(
        dwell_seconds_range(Some(Kind::AquaticCenter)),
        minutes(60, 120)
    );
    let meal = (EAT_SECONDS_MIN, EAT_SECONDS_MAX);
    assert_eq!(dwell_seconds_range(Some(Kind::FastFood)), meal);
    assert_eq!(dwell_seconds_range(None), meal);
}

#[test]
fn the_mirror_reads_zero_on_a_ruin_and_on_a_load() {
    let (mut sim, hall, _) = party_hall_tower();
    attend(&mut sim, hall, 7);
    let back = deserialize(&sim.serialize()).unwrap();
    let loaded = back.tower.get_unit(hall).unwrap();
    assert_eq!((loaded.customers_in, loaded.occupants), (None, 0));
    attend(&mut sim, hall, 4);
    sim.tower.get_unit_mut(hall).unwrap().state = UnitState::Gutted;
    attend(&mut sim, hall, 4);
    assert_eq!(occupants(&sim, hall), 0, "no audience art on a ruin");
}

#[test]
fn the_presence_pass_keeps_the_mirror() {
    let (mut sim, hall, _) = party_hall_tower();
    attend(&mut sim, hall, 3);
    at_time(&mut sim, 0, 20);
    sim.update_presence();
    assert_eq!(occupants(&sim, hall), 3);
}

#[test]
fn evening_visitors_reach_the_hall_and_the_mirror_follows() {
    let (mut sim, hall, _) = party_hall_tower();
    at_time(&mut sim, 0, EVENING);
    let (mut visitor, mut attended) = (false, false);
    for _ in 0..240 {
        sim.tick(1.0);
        visitor |= sim
            .crowd
            .people
            .iter()
            .any(|p| p.meal_venue_id == Some(hall));
        if tally(&sim, hall) > 0 {
            attended = true;
            assert_eq!(occupants(&sim, hall), tally(&sim, hall));
        }
        if visitor && attended {
            break;
        }
    }
    assert!(visitor && attended);
}

#[test]
fn a_hotel_guest_at_the_party_thins_their_room() {
    let (mut sim, hall, room) = party_hall_tower();
    at_time(&mut sim, 0, EVENING);
    let mut mingled = false;
    for _ in 0..360 {
        sim.tick(1.0);
        let split = sim.tower.get_unit(hall).unwrap().hotel_customers_in;
        assert_eq!(
            split.unwrap_or(0),
            0,
            "an attendance venue keeps no hotel split"
        );
        let out = |p: &crate::crowd::Person| {
            p.meal_venue_id == Some(hall) && p.origin_unit_id == Some(room)
        };
        if sim.crowd.people.iter().any(out) {
            mingled = true;
            assert!(sim.tower.get_unit(room).unwrap().out_for_meal.unwrap_or(0) > 0);
            break;
        }
    }
    assert!(mingled);
}

#[test]
fn the_house_fills_and_drains_after_closing() {
    let (mut sim, hall, _) = party_hall_tower();
    at_time(&mut sim, 0, EVENING);
    let mut peak = 0;
    for _ in 0..600 {
        sim.tick(1.0);
        peak = peak.max(tally(&sim, hall));
    }
    assert!(peak > 0);
    assert_eq!((tally(&sim, hall), occupants(&sim, hall)), (0, 0));
}

#[test]
fn a_street_visitor_rides_home_to_the_lobby() {
    let (mut sim, hall, _) = party_hall_tower();
    at_time(&mut sim, 0, EVENING);
    let home = (0..600).find_map(|_| {
        sim.tick(1.0);
        sim.crowd
            .people
            .iter()
            .find(|p| p.meal_venue_id == Some(hall) && p.origin_unit_id.is_none() && p.returning)
            .map(|p| *p.floors.last().unwrap())
    });
    assert_eq!(home, Some(LOBBY));
}

#[test]
fn a_hall_bulldozed_mid_party_strands_nobody() {
    let (mut sim, hall, _) = party_hall_tower();
    until_attended(&mut sim, hall);
    assert!(sim.tower.remove_unit(hall).is_some());
    for _ in 0..500 {
        sim.tick(1.0);
    }
    assert!(!sim
        .crowd
        .people
        .iter()
        .any(|p| p.meal_venue_id == Some(hall)));
}

#[test]
fn losing_the_only_elevator_mid_party_still_drains_the_tally() {
    let (mut sim, hall, _) = party_hall_tower();
    until_attended(&mut sim, hall);
    let ev = sim.tower.transports[0].id;
    assert!(sim.tower.remove_transport(ev).is_some());
    for _ in 0..600 {
        sim.tick(1.0);
    }
    assert_eq!((tally(&sim, hall), occupants(&sim, hall)), (0, 0));
}

#[test]
fn the_traffic_loop_opens_a_reachable_hall_at_five() {
    let (mut sim, hall, _) = party_hall_tower();
    sim.tower.get_unit_mut(hall).unwrap().state = UnitState::Empty;
    at_time(&mut sim, 0, 16);
    for _ in 0..120 {
        sim.tick(1.0);
    }
    assert_eq!(sim.tower.get_unit(hall).unwrap().state, UnitState::Occupied);
}

#[test]
fn a_hall_lists_as_a_destination_only_while_open() {
    let (mut sim, _, _) = party_hall_tower();
    for (hour, open) in [(10, false), (EVENING, true)] {
        at_time(&mut sim, 0, hour);
        let floors = spawn_floors(&sim.tower, &sim.clock);
        let listed = floors
            .venues_by_kind
            .get(&Kind::PartyHall)
            .is_some_and(|f| !f.is_empty());
        assert_eq!(listed, open, "hour {hour}");
    }
}

/// One outside visit to the party hall at 18:00; the people it spawned.
fn street_visit(sim: &mut Simulation) -> usize {
    at_time(sim, 0, EVENING);
    let floors = spawn_floors(&sim.tower, &sim.clock);
    let halls = floors.venues_by_kind.get(&Kind::PartyHall).unwrap().clone();
    spawn_venue_visit(
        &mut sim.crowd,
        &mut sim.tower,
        Kind::PartyHall,
        &halls,
        &floors,
        EVENING,
        VisitOrigin::Outside,
    );
    sim.crowd.people.len()
}

#[test]
fn a_full_or_unreachable_hall_takes_no_visitor() {
    let (mut open_house, _, _) = party_hall_tower();
    assert_eq!(street_visit(&mut open_house), 1, "an open house takes one");

    let (mut full, hall, _) = party_hall_tower();
    attend(&mut full, hall, Kind::PartyHall.attendance_cap().unwrap());
    assert_eq!(street_visit(&mut full), 0, "a full house");

    let mut stranded = strip_tower(2024, GameMode::Modern, 40, 3);
    let hall = place_seated(
        &mut stranded,
        Kind::PartyHall,
        HALL_FLOOR,
        0,
        UnitState::Occupied,
        0,
    );
    assert_eq!(street_visit(&mut stranded), 0, "no transport, no route");
    assert_eq!(tally(&stranded, hall), 0);
}

/// A Modern strip to floor 3, an elevator at x 36 and a tenanted cinema.
fn cinema_tower() -> (Simulation, i64) {
    let mut sim = strip_tower(2024, GameMode::Modern, 40, 3);
    shaft(&mut sim, Kind::ElevatorStandard, 36, 1, 3);
    let cinema = place_seated(&mut sim, Kind::Cinema, 2, 0, UnitState::Occupied, 0);
    (sim, cinema)
}

#[test]
fn matinee_visitors_fill_the_cinema_and_the_mirror_follows() {
    let (mut sim, cinema) = cinema_tower();
    at_time(&mut sim, 0, 14);
    let attended = (0..240).any(|_| {
        sim.tick(1.0);
        tally(&sim, cinema) > 0
    });
    assert!(attended);
    assert_eq!(occupants(&sim, cinema), tally(&sim, cinema));
}

/// The cinema-bound visitors 1000 spawn draws send at 14:00, with a second
/// cinema on floor 2, at Normal and no blockbuster, as the competing visit
/// (an open shop no longer sends one-way trips to compete), the crowd and
/// both houses emptied after each draw so no cap binds. The cinema charges
/// ticket price `price` (#1950).
fn cinema_draws(blockbuster: bool, price: &str) -> usize {
    let (mut sim, cinema) = cinema_tower();
    for x in 40..80 {
        for floor in 1..=3 {
            let kind = if floor == LOBBY {
                Kind::Lobby
            } else {
                Kind::Floor
            };
            assert!(sim.tower.place(kind, floor, x).ok);
        }
    }
    let rival = place_seated(&mut sim, Kind::Cinema, 2, 40, UnitState::Occupied, 0);
    at_time(&mut sim, 0, 14);
    if blockbuster {
        sim.crowd.blockbusters.insert(cinema);
    }
    assert_eq!(sim.set_ticket_price(cinema, price), Some(price));
    let floors = spawn_floors(&sim.tower, &sim.clock);
    let mut sent = 0;
    for _ in 0..1000 {
        spawn_trips(&mut sim.crowd, &mut sim.tower, &sim.clock, &floors);
        sent += sim
            .crowd
            .people
            .iter()
            .filter(|p| p.meal_venue_id == Some(cinema))
            .count();
        sim.crowd.people.clear();
        for id in [cinema, rival] {
            sim.tower.get_unit_mut(id).unwrap().customers_in = None;
        }
    }
    sent
}

/// A blockbuster lists its cinema's visit twice and weighs its seat 2 to 1,
/// so more draws go to it than to the ordinary film beside it.
#[test]
fn a_blockbuster_draws_more_visits_than_an_ordinary_film() {
    let (plain, boosted) = (cinema_draws(false, "normal"), cinema_draws(true, "normal"));
    assert!(plain > 0);
    let lift = boosted as f64 / plain as f64;
    assert!(lift > 1.15, "{boosted} blockbuster visits against {plain}");
}

/// A theater's ticket price moves its share of the crowd (#1950): a Low
/// price draws more visits than Normal, and each step up draws fewer.
#[test]
fn a_cheaper_ticket_draws_more_visits_and_a_dearer_one_fewer() {
    let draws: Vec<usize> = ["low", "normal", "high", "premium"]
        .iter()
        .map(|price| cinema_draws(false, price))
        .collect();
    assert!(
        draws.windows(2).all(|w| w[0] > w[1]),
        "visits by step, cheapest first: {draws:?}"
    );
}

/// Only open theaters weigh in (#1950): an empty Premium theater beside an
/// open Low one leaves floor 2 drawing as Low, and each floor keeps its own
/// mean while the tower's share takes the mean of every open theater.
#[test]
fn the_crowd_weighs_each_floor_by_its_open_theaters_only() {
    let mut sim = strip_tower(2024, GameMode::Modern, 80, 5);
    let low = place_seated(&mut sim, Kind::Cinema, 2, 0, UnitState::Occupied, 0);
    let empty = place_seated(&mut sim, Kind::Cinema, 2, 40, UnitState::Empty, 0);
    let high = place_seated(&mut sim, Kind::Cinema, 4, 0, UnitState::Occupied, 0);
    for (id, price) in [(low, "low"), (empty, "premium"), (high, "high")] {
        assert_eq!(sim.set_ticket_price(id, price), Some(price));
    }
    at_time(&mut sim, 0, 14);
    let floors = spawn_floors(&sim.tower, &sim.clock);
    assert_eq!(floors.cinema_floor_pick(2), 1.25);
    assert_eq!(floors.cinema_floor_pick(4), 0.75);
    assert_eq!(floors.cinema_floor_pick(3), 1.0);
    assert_eq!(floors.cinema_picks, Some(1.0));
}

/// The blockbuster option (#1950): each open cinema floor holding a booked
/// theater, once, weighted by the mean ticket pick of the booked theaters
/// there. A stale id, a booked room that is no cinema and a booked theater
/// on a floor with no open theater all stay out, and at Normal it weighs 1.
#[test]
fn the_blockbuster_option_lists_booked_open_floors_and_their_mean_pick() {
    let mut sim = strip_tower(2024, GameMode::Modern, 80, 7);
    let low = place_seated(&mut sim, Kind::Cinema, 2, 0, UnitState::Occupied, 0);
    let premium = place_seated(&mut sim, Kind::Cinema, 2, 40, UnitState::Occupied, 0);
    place_seated(&mut sim, Kind::Cinema, 4, 0, UnitState::Occupied, 0);
    let closed = place_seated(&mut sim, Kind::Cinema, 6, 0, UnitState::Empty, 0);
    let shop = place_seated(&mut sim, Kind::Shop, 4, 40, UnitState::Occupied, 0);
    sim.crowd
        .blockbusters
        .extend([low, premium, closed, shop, 9_999]);
    at_time(&mut sim, 0, 14);
    let booked = |sim: &Simulation| {
        let floors = spawn_floors(&sim.tower, &sim.clock);
        let cinemas = floors.venues_by_kind.get(&Kind::Cinema).unwrap().to_vec();
        booked_cinema_floors(&sim.crowd, &sim.tower, &cinemas, &floors)
    };
    assert_eq!(booked(&sim), Some((vec![2], 1.0)));
    sim.set_ticket_price(low, "low");
    sim.set_ticket_price(premium, "premium");
    let (bb, weight) = booked(&sim).unwrap();
    assert_eq!(bb, vec![2]);
    assert!((weight - 0.9).abs() < 1e-12, "weight {weight}");
}
