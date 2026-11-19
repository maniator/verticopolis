use super::*;
use crate::clock::{CalendarKind, GameMode};
use crate::facilities::{LOT_WIDTH, MAX_FLOOR};
use crate::star::TOWER_POPULATION;

#[test]
fn the_advisories_word_their_counts_as_typescript_does() {
    // The retired TypeScript templates with these inputs (`src/engine/sim/services.ts`).
    assert_eq!(
        waste_nudge_message(1234.0, 1.0, 0),
        "♻️ Garbage is piling up: 1,234 population needs 1 Recycling Center (you have 0). Tenant ratings fall until it is handled, and 4★ requires demand met."
    );
    assert_eq!(
        waste_nudge_message(12345.0, 3.0, 1),
        "♻️ Garbage is piling up: 12,345 population needs 3 Recycling Centers (you have 1). Tenant ratings fall until it is handled, and 4★ requires demand met."
    );
    assert_eq!(
        suite_nudge_message(1.0, 0),
        "🚗 Hotel suites need a working parking space each: 1 suite, 0 space(s) chained to a ramp."
    );
    assert_eq!(
        suite_nudge_message(4.0, 2),
        "🚗 Hotel suites need a working parking space each: 4 suites, 2 space(s) chained to a ramp."
    );
    assert_eq!(
        office_parking_nudge_message(1.0, 1.0),
        "🚗 Offices need parking: their workers need 1 space and 1 is left after the hotel suites. Office ratings fall until there is room."
    );
    assert_eq!(
        office_parking_nudge_message(184.0, 0.0),
        "🚗 Offices need parking: their workers need 184 spaces and 0 are left after the hotel suites. Office ratings fall until there is room."
    );
}

#[test]
fn thousands_match_to_locale_string() {
    for (x, want) in [
        (0.0, "0"),
        (999.0, "999"),
        (1000.0, "1,000"),
        (7000.0, "7,000"),
        (25000.0, "25,000"),
        (100000.0, "100,000"),
        (999999.0, "999,999"),
        (1000000.0, "1,000,000"),
        (1234567.0, "1,234,567"),
    ] {
        assert_eq!(with_thousands(x), want);
    }
}

/// The fractional cases, each the string node's `toLocaleString()`
/// prints for the same number.
#[test]
fn fractional_amounts_match_to_locale_string() {
    for (x, want) in [
        (123456.78, "123,456.78"),
        (150000.0, "150,000"),
        (1234.5678, "1,234.568"),
        (0.0005, "0.001"),
        (999.9996, "1,000"),
        (1.0005, "1.001"),
        (106666.66666666667, "106,666.667"),
        (0.1 + 0.2, "0.3"),
    ] {
        assert_eq!(with_thousands(x), want, "{x}");
    }
}

/// The signed and non-finite cases, each the string node's
/// `toLocaleString()` prints for the same number.
#[test]
fn signed_and_non_finite_amounts_match_to_locale_string() {
    for (x, want) in [
        (-0.0, "-0"),
        (-0.0001, "-0"),
        (-0.0004, "-0"),
        (-0.0005, "-0.001"),
        (-1234.5, "-1,234.5"),
        (f64::INFINITY, "∞"),
        (f64::NEG_INFINITY, "-∞"),
        (f64::NAN, "NaN"),
    ] {
        assert_eq!(with_thousands(x), want, "{x}");
    }
}

fn modern_with_rooms(infested: usize, clean: usize) -> Simulation {
    let mut sim = Simulation::new(1, GameMode::Modern, CalendarKind::RealWorld, false);
    for x in 0..40 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for x in 0..40 {
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    let width = Kind::HotelSingle.facility().width;
    let mut x = 0;
    for i in 0..infested + clean {
        let r = sim.tower.place(Kind::HotelSingle, 2, x);
        assert!(r.ok, "{:?}", r.reason);
        let id = r.unit_id.unwrap();
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.state = if i < infested {
            UnitState::Infested
        } else {
            UnitState::Occupied
        };
        x += width;
    }
    sim
}

#[test]
fn booking_mirrors_call_exterminator() {
    let mut sim = modern_with_rooms(3, 1);
    sim.money = 100.0;
    assert_eq!(
        sim.call_exterminator(),
        Err(ExterminatorRefusal::Funds {
            cost: 11000.0,
            rooms: 3
        })
    );
    sim.money = 20000.0;
    let day = sim.clock.day();
    assert_eq!(sim.call_exterminator(), Ok((11000.0, 3)));
    assert_eq!(sim.money, 9000.0);
    assert_eq!(sim.ledger.today.get("upkeep"), Some(&-11000.0));
    assert_eq!(sim.extermination_due_day, Some((day + 1) as f64));
    assert_eq!(sim.extermination_room_ids.as_ref().map(Vec::len), Some(3));
    let last = sim.log.last().unwrap();
    assert_eq!(
        last.text,
        "🧹 Exterminator booked for 3 infested room(s): $11,000 charged. The rooms clear tomorrow."
    );
    assert_eq!(last.kind, LogKind::Money);
    assert_eq!(sim.call_exterminator(), Err(ExterminatorRefusal::Pending));

    let mut none = modern_with_rooms(0, 2);
    none.money = 1e6;
    assert_eq!(none.call_exterminator(), Err(ExterminatorRefusal::None));

    let mut classic = Simulation::new(1, GameMode::Classic, CalendarKind::RealWorld, false);
    classic.money = 1e6;
    assert_eq!(
        classic.call_exterminator(),
        Err(ExterminatorRefusal::Unavailable)
    );
}

/// A Classic tower with `office_floors` floors of occupied offices above the
/// lobby, slabs up to floor 100, three basement floors, and a star rating of
/// five: everything the VIP checks apart from the hall and the Metro.
fn finished_tower(office_floors: i64) -> Simulation {
    let mut sim = Simulation::new(1, GameMode::Classic, CalendarKind::RealWorld, false);
    sim.money = 1.0e9;
    for x in 0..LOT_WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in (-2..=0).rev().chain(2..=MAX_FLOOR) {
        for x in 0..LOT_WIDTH {
            assert!(
                sim.tower.place(Kind::Floor, floor, x).ok,
                "floor {floor},{x}"
            );
        }
    }
    let width = Kind::Office.facility().width;
    for floor in 2..2 + office_floors {
        for x in (0..=LOT_WIDTH - width).step_by(width as usize) {
            let id = sim.tower.place(Kind::Office, floor, x).unit_id.unwrap();
            sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
        }
    }
    sim.star = 5;
    sim
}

/// The VIP's visit today.
fn vip_visits_today(sim: &mut Simulation) {
    sim.vip_visit_day = sim.clock.day() as f64;
    sim.check_vip();
}

/// The TOWER rating (the win): a five-star tower with the population, the
/// Wedding Hall crowning floor 100 and a Metro station impresses the VIP and
/// becomes a TOWER. Short of the population, the VIP leaves unimpressed and
/// comes back in five days.
#[test]
fn the_vip_crowns_a_finished_tower_and_returns_to_a_short_one() {
    let per_floor = LOT_WIDTH / Kind::Office.facility().width;
    let floors_needed = (TOWER_POPULATION + per_floor * Kind::Office.facility().population - 1)
        / (per_floor * Kind::Office.facility().population);
    for (office_floors, crowned) in [(floors_needed - 1, false), (floors_needed, true)] {
        let mut sim = finished_tower(office_floors);
        assert!(sim.tower.place(Kind::Metro, -2, 0).ok, "metro");
        assert!(
            sim.build(Kind::WeddingHall, MAX_FLOOR, LOT_WIDTH / 2).ok,
            "wedding hall"
        );
        assert_eq!(sim.tower.built_wedding_hall, Some(true));
        for kind in [Kind::WeddingHall, Kind::Metro] {
            for id in sim
                .tower
                .units_of_kind(kind)
                .map(|u| u.id)
                .collect::<Vec<_>>()
            {
                sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
            }
        }
        assert_eq!(
            sim.rating_population() >= TOWER_POPULATION,
            crowned,
            "population {}",
            sim.rating_population()
        );

        vip_visits_today(&mut sim);
        if crowned {
            assert_eq!(sim.star, 6, "a TOWER");
            assert_eq!(sim.evaluated_tower, Some(true));
            assert_eq!(sim.vip_visit_day, -1.0, "no further visit");
        } else {
            assert_eq!(sim.star, 5);
            assert_ne!(sim.evaluated_tower, Some(true));
            assert_eq!(
                sim.vip_visit_day,
                (sim.clock.day() + 5) as f64,
                "back in five days"
            );
        }
    }
}

/// A three-star Classic tower with one hotel suite on floor 2, served by an
/// elevator, its guests asleep at `satisfaction`, and no parking.
fn suite_tower(satisfaction: f64) -> Simulation {
    let mut sim = Simulation::new(1, GameMode::Classic, CalendarKind::RealWorld, false);
    sim.money = 1.0e9;
    for x in 100..160 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, 100, 1, 2).ok);
    let id = sim.tower.place(Kind::HotelSuite, 2, 120).unit_id.unwrap();
    let suite = sim.tower.get_unit_mut(id).unwrap();
    suite.state = UnitState::Asleep;
    suite.satisfaction = satisfaction;
    sim.star = 3;
    sim.vip_favorable = false;
    sim.last_vip_nag_day = -5;
    sim
}

fn last_line(sim: &Simulation) -> &str {
    sim.log.last().map_or("", |e| e.text.as_str())
}

/// The VIP's suite stay (`maybeVipStay`), whose words the conformance hash
/// leaves out (#864): an unhappy suite gets the underwhelming line, a happy
/// one with no parking gets the circled-the-block line, and either counts a
/// visit and waits five days before the next. A tower below three stars, or
/// one with its favorable review already, gets no visit.
#[test]
fn the_vip_suite_stay_reads_the_suites_and_waits_five_days() {
    let underwhelming = "A VIP's suite stay was underwhelming. Improve suite access and try again.";
    let mut sim = suite_tower(0.5);
    let today = sim.clock.day();
    sim.maybe_vip_stay();
    assert_eq!(last_line(&sim), underwhelming);
    assert_eq!((sim.vip_visits, sim.last_vip_nag_day), (1, today));
    assert!(!sim.vip_favorable);
    let lines = sim.log.len();
    sim.maybe_vip_stay();
    assert_eq!(sim.log.len(), lines, "no second visit within five days");
    assert_eq!(sim.vip_visits, 1);
    sim.last_vip_nag_day = today - 5;
    sim.maybe_vip_stay();
    assert_eq!(last_line(&sim), underwhelming, "back after five days");
    assert_eq!(sim.vip_visits, 2);

    let mut sim = suite_tower(0.7);
    assert!(sim.suite_parking_short());
    sim.maybe_vip_stay();
    assert_eq!(
        last_line(&sim),
        "🚗 The VIP circled the block and left. Every hotel suite needs a working parking space (chained to a ramp)."
    );
    assert_eq!(sim.vip_visits, 1);
    assert!(!sim.vip_favorable);

    for (star, favorable) in [
        (VIP_VISITS_FROM_STAR - 1, false),
        (VIP_VISITS_FROM_STAR, true),
    ] {
        let mut sim = suite_tower(0.5);
        sim.star = star;
        sim.vip_favorable = favorable;
        let lines = sim.log.len();
        sim.maybe_vip_stay();
        assert_eq!(
            (sim.log.len(), sim.vip_visits),
            (lines, 0),
            "star {star}, favorable {favorable}"
        );
    }
}

/// A tower with a working recycling center in the basement, a shop on floor
/// 3 and, in Modern, a nightclub on floor 2, every room open.
fn venue_tower(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new(1, mode, CalendarKind::RealWorld, false);
    for x in 0..LOT_WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in [0, -1, 2, 3] {
        for x in 0..LOT_WIDTH {
            let r = sim.tower.place(Kind::Floor, floor, x);
            assert!(r.ok, "floor {floor} x {x}: {:?}", r.reason);
        }
    }
    let mut placed = vec![sim.tower.place(Kind::Recycling, -1, 0)];
    if mode == GameMode::Modern {
        placed.push(sim.tower.place(Kind::Nightclub, 2, 40));
    }
    placed.push(sim.tower.place(Kind::Shop, 3, 0));
    for r in placed {
        assert!(r.ok, "{:?}", r.reason);
        sim.tower.get_unit_mut(r.unit_id.unwrap()).unwrap().state = UnitState::Occupied;
    }
    sim
}

fn set_customers(sim: &mut Simulation, kind: Kind, n: i64) {
    let id = sim.tower.units.iter().find(|u| u.kind == kind).unwrap().id;
    sim.tower.get_unit_mut(id).unwrap().customers_in = Some(n);
}

#[test]
fn a_modern_venue_crowd_cannot_flip_the_recycling_gate() {
    // #358: the nightclub's census is the customers inside right now, so
    // the total population swings with the crowd. Recycling plans for the
    // population without them: a crowd far past one center's 2,500 leaves
    // the gate met and the bins as full as before.
    let mut sim = venue_tower(GameMode::Modern);
    sim.star = 4;
    sim.clock.minutes += 12.0 * 60.0; // noon, so the bins hold something
    set_customers(&mut sim, Kind::Shop, 0);
    set_customers(&mut sim, Kind::Nightclub, 0);
    assert_eq!(sim.recycling_centers(), 1);
    let quiet_total = sim.tower.total_population();
    let quiet = sim.recycling_population();
    let quiet_fill = sim.recycling_fill();
    assert!(quiet_fill > 0.0 || quiet == 0);
    assert!(sim.recycling_demand_met());

    set_customers(&mut sim, Kind::Nightclub, 3000);
    assert_eq!(
        sim.tower.total_population(),
        quiet_total + 3000,
        "the census still counts the crowd"
    );
    assert_eq!(sim.recycling_population(), quiet);
    assert!(
        sim.recycling_demand_met(),
        "the crowd flipped the 4-star recycling gate"
    );
    assert_eq!(sim.recycling_fill(), quiet_fill);
    assert_eq!(sim.service_shortfalls().trash(), None);
}

#[test]
fn a_classic_tower_plans_recycling_for_its_whole_population() {
    // Every Classic room's census follows the day or counts the people who
    // live or work there, so nothing is left out.
    let mut sim = venue_tower(GameMode::Classic);
    let shop = sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Shop)
        .unwrap()
        .id;
    sim.tower.get_unit_mut(shop).unwrap().visitors_yest = Some(20);
    assert_eq!(sim.tower.total_population(), 20);
    assert_eq!(sim.recycling_population(), sim.tower.total_population());
}

#[test]
fn the_recycling_share_is_the_census_share_except_for_a_live_venue() {
    // `recycling_census_share` decides in one pass what `census_share`
    // decides through `census_count` and `live_load`; this keeps the copy
    // from drifting, for every kind and for a room present or not.
    use crate::economy::visitors::census_counts_live_customers;
    use crate::facilities::FACILITIES;
    use crate::tower::UnitState;
    let sim = venue_tower(GameMode::Modern);
    let template = sim.tower.room_units().next().unwrap().clone();
    for f in FACILITIES.iter() {
        for state in [UnitState::Occupied, UnitState::Empty] {
            let mut u = template.clone();
            u.kind = f.kind;
            u.state = state;
            u.visitors_yest = Some(17);
            u.customers_in = Some(23);
            u.occupants = 9;
            let expected = if census_counts_live_customers(f.kind) {
                0
            } else {
                u.census_share()
            };
            assert_eq!(
                u.recycling_census_share(),
                expected,
                "{} ({state:?})",
                f.name
            );
        }
    }
}
