use super::{trip_facts, Errand, ErrandPlace, Place, Purpose};
use crate::clock::GameMode;
use crate::crowd::spawn::{add, spawn_step};
use crate::crowd::staff_shift::StaffTrip;
use crate::facilities::Kind;
use crate::rule_tests::{at_time, shaft, strip_tower};
use crate::sim::Simulation;
use crate::sim_loop::Weather;
use crate::tower::UnitState;

/// A 40-wide lobby, floors 2 to 4 and one standard elevator at x 4: an
/// office at x 10 on floor 2, a fast food at x 20 on floor 2 and a condo at
/// x 10 on floor 3, all open.
struct Tower3 {
    sim: Simulation,
    office: i64,
    food: i64,
    condo: i64,
}

fn tower3() -> Tower3 {
    let mut sim = strip_tower(1, GameMode::Classic, 40, 4);
    shaft(&mut sim, Kind::ElevatorStandard, 4, 1, 4);
    let open = |sim: &mut Simulation, kind, floor, x| {
        let id = sim.tower.place(kind, floor, x).unit_id.unwrap();
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
        id
    };
    let office = open(&mut sim, Kind::Office, 2, 10);
    let food = open(&mut sim, Kind::FastFood, 2, 20);
    let condo = open(&mut sim, Kind::Condo, 3, 10);
    Tower3 {
        sim,
        office,
        food,
        condo,
    }
}

/// A new person on a route from (`from`, `fx`) to (`to`, `tx`).
fn person(sim: &mut Simulation, from: (i64, i64), to: (i64, i64)) -> usize {
    add(
        &mut sim.crowd,
        &sim.tower,
        from.0,
        to.0,
        Some(from.1),
        Some(to.1),
    )
    .unwrap()
}

fn facts(sim: &Simulation, i: usize) -> super::TripFacts {
    trip_facts(&sim.crowd.people[i], &sim.tower)
}

#[test]
fn a_worker_coming_in_is_headed_for_the_office_on_the_tile_they_walk_to() {
    let mut t = tower3();
    let i = person(&mut t.sim, (1, 30), (2, 11));
    t.sim.crowd.people[i].errand = Some(Errand {
        place: ErrandPlace::Office,
        inbound: true,
    });
    let f = facts(&t.sim, i);
    assert_eq!(f.purpose, Purpose::ToWork);
    assert_eq!((f.from, f.to), (Place::Lobby(1), Place::Room(t.office)));
    assert!(!f.returning);
}

#[test]
fn a_tile_of_another_kind_names_only_the_floor() {
    // A worker bound for floor 2 whose tile is the fast food is not sent to
    // the burger counter: the card names the floor.
    let mut t = tower3();
    let i = person(&mut t.sim, (1, 30), (2, 21));
    t.sim.crowd.people[i].errand = Some(Errand {
        place: ErrandPlace::Office,
        inbound: true,
    });
    assert_eq!(facts(&t.sim, i).to, Place::Floor(2));
}

#[test]
fn someone_leaving_home_comes_from_the_condo_they_started_in() {
    let mut t = tower3();
    let i = person(&mut t.sim, (3, 12), (1, 30));
    t.sim.crowd.people[i].errand = Some(Errand {
        place: ErrandPlace::Home,
        inbound: false,
    });
    // They have walked on since: the card still names where they began.
    t.sim.crowd.people[i].x = 5.0;
    let f = facts(&t.sim, i);
    assert_eq!(f.purpose, Purpose::LeaveHome);
    assert_eq!((f.from, f.to), (Place::Room(t.condo), Place::Lobby(1)));
}

#[test]
fn every_errand_names_its_purpose() {
    let cases = [
        (ErrandPlace::Office, true, Purpose::ToWork),
        (ErrandPlace::Office, false, Purpose::FromWork),
        (ErrandPlace::Home, true, Purpose::ReturnHome),
        (ErrandPlace::Home, false, Purpose::LeaveHome),
        (ErrandPlace::Venue, true, Purpose::ToVenue),
        (ErrandPlace::Venue, false, Purpose::FromVenue),
    ];
    let mut t = tower3();
    let i = person(&mut t.sim, (1, 30), (2, 11));
    for (place, inbound, purpose) in cases {
        t.sim.crowd.people[i].errand = Some(Errand { place, inbound });
        assert_eq!(facts(&t.sim, i).purpose, purpose, "{place:?} {inbound}");
    }
}

#[test]
fn a_meal_trip_runs_from_the_office_to_the_counter_and_back() {
    let mut t = tower3();
    let i = person(&mut t.sim, (2, 10), (2, 20));
    let p = &mut t.sim.crowd.people[i];
    p.meal_venue_id = Some(t.food);
    p.origin_unit_id = Some(t.office);
    let out = facts(&t.sim, i);
    assert_eq!(out.purpose, Purpose::Meal);
    assert_eq!(
        (out.from, out.to),
        (Place::Room(t.office), Place::Room(t.food))
    );
    assert!(!out.returning);
    t.sim.crowd.people[i].returning = true;
    let back = facts(&t.sim, i);
    assert_eq!(
        (back.from, back.to),
        (Place::Room(t.food), Place::Room(t.office))
    );
    assert!(back.returning);
}

#[test]
fn a_visitor_from_the_street_comes_from_the_lobby() {
    let mut t = tower3();
    let i = person(&mut t.sim, (1, 30), (2, 20));
    t.sim.crowd.people[i].meal_venue_id = Some(t.food);
    let f = facts(&t.sim, i);
    assert_eq!((f.from, f.to), (Place::Lobby(1), Place::Room(t.food)));
}

#[test]
fn a_bulldozed_room_is_named_by_nothing_or_its_floor() {
    let mut t = tower3();
    let i = person(&mut t.sim, (2, 10), (2, 20));
    t.sim.crowd.people[i].meal_venue_id = Some(t.food);
    t.sim.crowd.people[i].origin_unit_id = Some(t.office);
    assert!(t.sim.tower.remove_unit(t.food).is_some());
    assert!(t.sim.tower.remove_unit(t.office).is_some());
    let f = facts(&t.sim, i);
    // A venue that is gone is no meal: the card says a visit to its floor.
    assert_eq!(f.purpose, Purpose::Visit);
    assert_eq!((f.from, f.to), (Place::None, Place::Floor(2)));
}

#[test]
fn a_school_run_and_a_sales_call_name_the_home_and_the_office() {
    let mut t = tower3();
    let out = person(&mut t.sim, (3, 10), (1, 30));
    t.sim.crowd.people[out].routine = Some("schoolRun");
    t.sim.crowd.people[out].origin_unit_id = Some(t.condo);
    let f = facts(&t.sim, out);
    assert_eq!(f.purpose, Purpose::SchoolRun);
    assert_eq!((f.from, f.to), (Place::Room(t.condo), Place::Lobby(1)));

    let home = person(&mut t.sim, (1, 30), (3, 11));
    t.sim.crowd.people[home].routine = Some("schoolRun");
    let f = facts(&t.sim, home);
    assert_eq!((f.from, f.to), (Place::Lobby(1), Place::Room(t.condo)));

    let call = person(&mut t.sim, (2, 10), (1, 30));
    t.sim.crowd.people[call].routine = Some("salesCall");
    t.sim.crowd.people[call].origin_unit_id = Some(t.office);
    let f = facts(&t.sim, call);
    assert_eq!(f.purpose, Purpose::SalesCall);
    assert_eq!((f.from, f.to), (Place::Room(t.office), Place::Lobby(1)));
}

#[test]
fn a_housekeeper_works_from_their_crew_room_through_the_day() {
    let mut t = tower3();
    let crew = t
        .sim
        .tower
        .place(Kind::Housekeeping, 4, 10)
        .unit_id
        .unwrap();
    let hotel = t.sim.tower.place(Kind::HotelSingle, 4, 30).unit_id.unwrap();
    let i = person(&mut t.sim, (1, 30), (4, 11));
    let p = &mut t.sim.crowd.people[i];
    p.staff = true;
    p.crew_id = Some(crew);
    p.clean_unit_id = Some(hotel);
    let cases = [
        (StaffTrip::In, Place::Room(crew)),
        (StaffTrip::Base, Place::None),
        (StaffTrip::Job, Place::Room(hotel)),
        (StaffTrip::Free, Place::None),
        (StaffTrip::Home, Place::Room(crew)),
        (StaffTrip::Out, Place::Floor(4)),
    ];
    for (step, to) in cases {
        t.sim.crowd.people[i].staff_trip = Some(step);
        let f = facts(&t.sim, i);
        assert_eq!(f.purpose, Purpose::Housekeeping);
        assert_eq!(f.shift, Some(step));
        assert_eq!((f.from, f.to), (Place::Room(crew), to), "{step:?}");
    }
}

#[test]
fn a_metro_platform_end_is_the_metro() {
    let mut sim = strip_tower(1, GameMode::Classic, 80, 2);
    for x in 0..80 {
        for floor in [0, -1, -2] {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    sim.tower.place(Kind::Metro, -2, 0).unit_id.unwrap();
    shaft(&mut sim, Kind::ElevatorStandard, 70, -1, 2);
    let i = person(&mut sim, (-1, 5), (2, 30));
    sim.crowd.people[i].errand = Some(Errand {
        place: ErrandPlace::Office,
        inbound: true,
    });
    assert_eq!(facts(&sim, i).from, Place::Metro(-1));
}

#[test]
fn a_spawned_morning_commute_carries_its_errand() {
    // Every person the morning sends from a floor list is stamped. Their
    // tile on the far floor is a random one, so the card names the office or
    // the condo when the tile is in it, and the floor when it is not.
    let mut t = tower3();
    at_time(&mut t.sim, 1, 8);
    let mut plain = 0;
    for _ in 0..400 {
        let population = t.sim.tower.total_population();
        spawn_step(
            &mut t.sim.crowd,
            0.5,
            &mut t.sim.tower,
            &t.sim.clock,
            Some(Weather::Clear),
            population,
        );
    }
    for p in &t.sim.crowd.people {
        if p.staff || p.meal_venue_id.is_some() || p.routine.is_some() {
            continue;
        }
        plain += 1;
        let e = p.errand.expect("a plain commute carries its errand");
        let f = trip_facts(p, &t.sim.tower);
        match (e.place, e.inbound) {
            (ErrandPlace::Office, true) => {
                assert!(
                    [Place::Room(t.office), Place::Floor(2)].contains(&f.to),
                    "{f:?}"
                )
            }
            (ErrandPlace::Home, false) => {
                assert!(
                    [Place::Room(t.condo), Place::Floor(3)].contains(&f.from),
                    "{f:?}"
                )
            }
            other => panic!("no morning trip is {other:?}"),
        }
    }
    assert!(plain > 0, "the morning sent someone");
}

#[test]
fn the_code_tables_match_the_names() {
    for (i, p) in Purpose::ALL.iter().enumerate() {
        assert_eq!(
            Purpose::ALL.iter().position(|q| q.name() == p.name()),
            Some(i)
        );
    }
    let places = [
        Place::None,
        Place::Room(1),
        Place::Floor(1),
        Place::Lobby(1),
        Place::Metro(-1),
    ];
    for (i, p) in places.iter().enumerate() {
        assert_eq!(Place::NAMES[i], p.name());
    }
}
