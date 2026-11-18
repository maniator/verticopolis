//! The tower's notices name the cause in Classic and add the fix in Modern
//! (#549), as a room's card and the morning elevator warning already do.
//! The 1994 game's messages said what went wrong and left the remedy to the
//! player. The infestation notice is pinned by
//! `rule_tests::infestation::the_infestation_notice_offers_the_exterminator_and_a_fix_only_in_modern`.
use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::services::{METRO_PLATFORM_CUTOFF_CAUSE, METRO_PLATFORM_CUTOFF_MSG};
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::legibility::{stair_strand, STRANDED_NUDGE};
use super::{lay_row, put, seat, MID};

fn last_notice(sim: &Simulation, containing: &str) -> String {
    sim.log
        .iter()
        .rev()
        .find(|e| e.text.contains(containing))
        .map(|e| e.text.clone())
        .unwrap_or_else(|| panic!("a notice with {containing:?}"))
}

/// A lobby, two basement floors and an open Metro station on B2 with no
/// way down to its platform.
fn cut_off_metro(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new(1, mode, CalendarKind::RealWorld, false);
    sim.money = 1e12;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in [0, -1, -2] {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    let id = sim
        .tower
        .place(Kind::Metro, -2, 0)
        .unit_id
        .expect("a metro");
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    let metro = sim.tower.get_unit(id).expect("the metro");
    assert!(metro.is_operational(), "the station is open");
    assert!(
        !sim.tower.is_metro_platform_served(metro),
        "nothing reaches the platform"
    );
    sim
}

#[test]
fn the_metro_cut_off_notice_names_the_fix_in_modern_only() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = cut_off_metro(mode);
        sim.nudge_metro_platform();
        let notice = last_notice(&sim, "metro platform is cut off");
        let expected = if mode.advises_fixes() {
            METRO_PLATFORM_CUTOFF_MSG
        } else {
            METRO_PLATFORM_CUTOFF_CAUSE
        };
        assert_eq!(notice, expected, "{mode:?}");
    }
    assert!(!METRO_PLATFORM_CUTOFF_CAUSE.contains("Build"));
}

#[test]
fn the_stranded_floor_notice_names_the_cause_only_in_classic() {
    let mut sim = stair_strand(3, false);
    assert_eq!(sim.mode, GameMode::Classic);
    let office = put(&mut sim, Kind::Office, 40, MID + 30);
    seat(&mut sim, office, UnitState::Occupied, 1.0);
    assert!(
        sim.stranded_floors(true).contains(&40),
        "floor 40 is served but out of reach"
    );
    sim.nudge_stranded();
    let notice = last_notice(&sim, STRANDED_NUDGE);
    assert!(
        notice.ends_with("Nobody will move in or visit."),
        "{notice}"
    );
    assert!(!notice.contains("Add an elevator"), "{notice}");
}

#[test]
fn the_unimpressed_vip_notice_names_the_fix_in_modern_only() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = Simulation::new(1, mode, CalendarKind::RealWorld, false);
        sim.star = 5;
        sim.tower.built_wedding_hall = Some(true); // the visit's trigger, with no population behind it
        sim.vip_visit_day = sim.clock.day() as f64;
        sim.check_vip();
        let notice = last_notice(&sim, "The VIP was unimpressed.");
        assert_eq!(
            notice.contains("Grow your population"),
            mode.advises_fixes(),
            "{mode:?}: {notice}"
        );
    }
}
