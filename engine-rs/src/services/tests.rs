use super::*;
use crate::clock::{CalendarKind, GameMode};
use crate::facilities::{LOT_WIDTH, MAX_FLOOR};
use crate::star::TOWER_POPULATION;

#[test]
fn the_advisories_word_their_counts_as_typescript_does() {
    // The TypeScript templates with these inputs (sim/services.ts).
    assert_eq!(
        waste_nudge_message(1234.0, 1.0, 0),
        "♻️ Garbage is piling up: 1,234 population needs 1 Recycling Center (you have 0). 4★ requires demand met."
    );
    assert_eq!(
        waste_nudge_message(12345.0, 3.0, 1),
        "♻️ Garbage is piling up: 12,345 population needs 3 Recycling Centers (you have 1). 4★ requires demand met."
    );
    assert_eq!(
        suite_nudge_message(1.0, 0),
        "🚗 Hotel suites need a working parking space each: 1 suite, 0 space(s) chained to a ramp."
    );
    assert_eq!(
        suite_nudge_message(4.0, 2),
        "🚗 Hotel suites need a working parking space each: 4 suites, 2 space(s) chained to a ramp."
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
