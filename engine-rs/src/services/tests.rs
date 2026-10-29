use super::*;
use crate::clock::{CalendarKind, GameMode};

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
