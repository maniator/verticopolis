//! The retail card scores a venue against the Modern catalog's average good
//! day in both modes: a shop's yardstick is its daily traffic income over its
//! spend per customer at the mean foot traffic, 100 customers, never Classic's
//! higher sellout ceiling, which would read every healthy Classic shop as
//! failing. Below half the yardstick reads low, above 85 percent booming.

use serde_json::Value;

use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::tower::UnitState;

use super::{room, served_tower, LEFT};

/// A shop's average good day: 2,500 a day at 20 a customer, at the mean
/// foot traffic of 0.8.
const SHOP_YARDSTICK: f64 = 100.0;

/// The retail section of a served, open shop's card whose last full day
/// counted `yesterday` customers and whose day so far counts `today`.
fn shop_retail(mode: GameMode, yesterday: f64, today: f64) -> Value {
    let mut sim = served_tower(mode, CalendarKind::Canon, 2);
    let id = room(&mut sim, Kind::Shop, 2, LEFT + 10, UnitState::Occupied);
    {
        let mut extras = sim.tower.get_unit_mut(id).unwrap().extras_mut();
        extras.patronage_yest = Some(yesterday);
        extras.patronage_today = Some(today);
    }
    let facts = sim.service_diagnostic_facts(id).expect("a shop answers");
    serde_json::to_value(facts).unwrap()["retail"].clone()
}

#[test]
fn both_modes_score_a_shop_against_the_same_average_good_day() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let tier = |share: f64| shop_retail(mode, SHOP_YARDSTICK * share, 0.0)["tier"].clone();
        assert_eq!(tier(0.49), "low", "{mode:?}");
        assert_eq!(tier(0.5), "average", "{mode:?}");
        assert_eq!(tier(0.85), "average", "{mode:?}");
        assert_eq!(tier(0.86), "booming", "{mode:?}");
    }
}

#[test]
fn the_bar_fills_with_todays_count_against_the_yardstick() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let retail = shop_retail(mode, SHOP_YARDSTICK, SHOP_YARDSTICK / 2.0);
        assert_eq!(retail["active"], true, "{mode:?}");
        assert_eq!(retail["barWidth"], 50, "{mode:?}");
        assert_eq!(retail["today"], 50, "{mode:?}");
        let forged = shop_retail(mode, SHOP_YARDSTICK, -5.0);
        assert_eq!(
            forged["today"], 0,
            "{mode:?}: a negative count reads as none"
        );
        assert_eq!(forged["barWidth"], 0, "{mode:?}");
    }
}
