use super::*;
use crate::clock::GameMode;

#[test]
fn vacate_reason_text_matches_the_typescript_table() {
    for (key, want) in [
        ("access", "no route to the lobby"),
        ("noTransport", "no way to transportation from here"),
        ("congestion", "overcrowded vertical transport"),
        ("rent", "rent set too high"),
        ("noise", "a noisy neighbor nearby"),
        (
            "transportFar",
            "too far from a stairway, escalator, or passenger elevator",
        ),
        ("lobbyFar", "too far from a lobby or sky lobby"),
        ("unmetDemand", "too few shops or restaurants within reach"),
        ("relocation", "the household is relocating"),
    ] {
        assert_eq!(vacate_reason_text(key), want, "{key}");
    }
}

#[test]
fn notices_name_one_unit_or_tally_by_cause() {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.emit_notices(&[(5, Kind::Office, "access")]);
    assert_eq!(
        sim.log.last().unwrap().text,
        "Office on floor 5 gave notice: no route to the lobby. Fix it before they leave."
    );
    sim.emit_notices(&[
        (5, Kind::Office, "access"),
        (6, Kind::Condo, "rent"),
        (7, Kind::Office, "access"),
    ]);
    assert_eq!(
        sim.log.last().unwrap().text,
        "3 tenants gave notice: 2 \u{d7} no route to the lobby, 1 \u{d7} rent set too high. Fix the flagged units before they leave."
    );
}

/// The nearest story by a walk over every entry, as the step read it before
/// the lists were kept sorted.
fn nearest_by_walk(floors: &[i64], floor: i64) -> f64 {
    floors
        .iter()
        .map(|&f| (f - floor).abs() as f64)
        .fold(f64::INFINITY, f64::min)
}

#[test]
fn the_nearest_story_search_answers_as_a_walk_over_every_story() {
    let lists: [&[i64]; 6] = [
        &[],
        &[1],
        &[-3, 2],
        &[1, 2, 3, 9],
        &[-9, -8, 0, 40, 41, 77],
        &[5, 7],
    ];
    for floors in lists {
        for floor in -12..=80 {
            assert_eq!(
                nearest_floor_dist(floors, floor),
                nearest_by_walk(floors, floor),
                "{floors:?} from {floor}"
            );
        }
    }
}

#[test]
fn the_halo_lists_hold_each_served_venue_story_once_in_order() {
    use crate::load::deserialize;
    use crate::rule_tests::fixture_save;
    let mut casts = 0;
    for name in ["sixseven_2", "split-tower", "towerone_6"] {
        for mode in [GameMode::Classic, GameMode::Modern] {
            let mut sim = deserialize(&fixture_save(name)).unwrap();
            sim.mode = mode;
            let ctx = sim.build_satisfaction_context(false);
            for (row, halo) in mode.halos().iter().enumerate() {
                let mut want: Vec<i64> = sim
                    .tower
                    .room_units()
                    .filter(|c| c.kind == halo.source && casts_halo(c))
                    .filter(|c| ctx.served_set.contains(&c.floor))
                    .flat_map(|c| c.floor..c.floor + c.kind.floors())
                    .collect();
                casts += want.len();
                want.sort_unstable();
                want.dedup();
                assert_eq!(ctx.halo_floors[row], want, "{name} {mode:?} row {row}");
            }
        }
    }
    assert!(casts > 0, "no fixture has a venue that casts");
}

#[test]
fn a_venue_noted_mid_pass_keeps_its_list_sorted_and_each_story_once() {
    let mode = GameMode::Modern;
    let row = mode
        .halos()
        .iter()
        .position(|h| h.source == Kind::FitnessClub)
        .unwrap();
    let mut halo_floors = vec![Vec::new(); mode.halos().len()];
    halo_floors[row] = vec![2, 9, 30];
    // Any room serves as the venue: only its kind and floor are read.
    let sim = crate::load::deserialize(&crate::rule_tests::fixture_save("sixseven_2")).unwrap();
    let mut club = sim.tower.room_units().next().unwrap().clone();
    club.kind = Kind::FitnessClub;
    for floor in [8, 1, 31, 9] {
        club.floor = floor;
        note_halo_venue(&mut halo_floors, mode, &club);
    }
    let span = Kind::FitnessClub.floors();
    let mut want: Vec<i64> = [2, 9, 30]
        .into_iter()
        .chain([8, 1, 31, 9].into_iter().flat_map(|f| f..f + span))
        .collect();
    want.sort_unstable();
    want.dedup();
    assert_eq!(halo_floors[row], want);
}
