//! Tests for the inspector's memos (#1215): each key input rebuilds on its
//! own, a read within the hour reuses the demand map, the main gripe fills
//! it only where the TypeScript inspector would, and asking about every unit
//! changes nothing.

use super::tenant_tests::{facts, served_tower, tenant, C};
use crate::canonical::digest;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::snapshot::state_view;
use crate::tower::UnitState;

#[test]
fn the_demand_memo_rebuilds_on_each_key_input_and_holds_within_the_hour() {
    let mut sim = served_tower(GameMode::Modern, 3);
    sim.clock.minutes = 8.0 * 60.0;
    let id = tenant(&mut sim, Kind::Office, 2, C + 6, UnitState::Occupied, 1.0);
    let u = sim.tower.get_unit(id).unwrap().clone();
    assert!(!sim.demand_memo_is_fresh());
    sim.inspector_coverage(&u);
    assert!(sim.demand_memo_is_fresh());
    // Occupancy moves without a revision bump, and the clock moves within
    // the hour: the hour's map stands.
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Empty;
    sim.clock.minutes += 59.0;
    assert!(sim.demand_memo_is_fresh(), "the TypeScript's in-hour lag");
    sim.clock.minutes += 1.0;
    assert!(!sim.demand_memo_is_fresh(), "a new game hour");
    sim.inspector_coverage(&u);
    // A transport edit moves the revision alone.
    let units = sim.tower.units.len();
    assert!(sim.build_transport(Kind::Stairs, C + 60, 1, 2).ok);
    assert_eq!(sim.tower.units.len(), units, "stairs add no unit");
    assert!(!sim.demand_memo_is_fresh(), "a revision bump");
    sim.inspector_coverage(&u);
    assert!(sim.tower.place(Kind::Office, 3, 10).ok);
    assert!(!sim.demand_memo_is_fresh(), "an edit");
    sim.inspector_coverage(&u);
    // The unit count alone: a list cut behind the revision.
    let cut = sim.tower.units.pop();
    assert!(
        !sim.demand_memo_is_fresh(),
        "a unit list cut behind the revision"
    );
    sim.tower.units.extend(cut);
    // A load builds a fresh `Simulation`, so it starts with no map at all.
    sim.inspector_coverage(&u);
    let loaded = crate::load::deserialize(&sim.serialize()).expect("loads");
    assert!(!loaded.demand_memo_is_filled(), "a load");
}

#[test]
fn the_inspector_reuses_congestion_across_rooms_and_invalidates_on_changes() {
    let mut sim = served_tower(GameMode::Modern, 3);
    let id = tenant(&mut sim, Kind::Office, 2, C + 6, UnitState::Occupied, 0.1);
    assert!(!sim.inspector_congestion_memo_is_fresh());
    let first = sim.inspector_congestion_at(2);
    assert!(sim.inspector_congestion_memo_is_fresh());
    assert_eq!(sim.inspector_congestion_at(2), first);
    // A different tenant on the same or another floor shares this map.
    sim.inspector_congestion_at(3);
    assert!(sim.inspector_congestion_memo_is_fresh());

    sim.clock.minutes += 1.0;
    assert!(
        !sim.inspector_congestion_memo_is_fresh(),
        "rush factor clock"
    );
    sim.inspector_congestion_at(2);
    assert!(sim.inspector_congestion_memo_is_fresh());

    assert!(sim.build_transport(Kind::Stairs, C + 60, 1, 2).ok);
    assert!(
        !sim.inspector_congestion_memo_is_fresh(),
        "transport edit"
    );
    sim.inspector_congestion_at(2);
    assert!(sim.inspector_congestion_memo_is_fresh());

    // The room-change marks invalidate a cached map even with an unchanged
    // clock and structural revision. This is the normal production setter.
    let (u, mark) = sim.tower.marked_by_id(id).expect("marked room");
    u.set_state(mark, UnitState::Empty);
    assert!(
        !sim.inspector_congestion_memo_is_fresh(),
        "room mark"
    );
    sim.inspector_congestion_at(2);
    assert!(sim.inspector_congestion_memo_is_fresh());

    sim.crowd.step += 1;
    assert!(
        !sim.inspector_congestion_memo_is_fresh(),
        "crowd step"
    );
    sim.inspector_congestion_at(2);
    assert!(sim.inspector_congestion_memo_is_fresh());

    let loaded = crate::load::deserialize(&sim.serialize()).expect("loads");
    assert!(
        !loaded.inspector_congestion_memo_is_fresh(),
        "load resets the map"
    );
}

#[test]
fn the_main_gripe_reads_coverage_only_past_the_causes_that_outrank_it() {
    let mut sim = served_tower(GameMode::Modern, 3);
    let gouged = tenant(&mut sim, Kind::Office, 2, C + 6, UnitState::Occupied, 0.3);
    sim.tower.get_unit_mut(gouged).unwrap().rent = Some(20_000.0);
    assert_eq!(facts(&mut sim, gouged).gripe.map(|g| g.cause), Some("rent"));
    assert!(
        !sim.demand_memo_is_fresh(),
        "a rent gripe stops before the tiers that read coverage"
    );
    // An unhappy office with no cause above unmet demand: the ladder reads
    // coverage (the tower has no retail, so it names nothing).
    let plain = tenant(&mut sim, Kind::Office, 3, C + 6, UnitState::Occupied, 0.3);
    assert_eq!(facts(&mut sim, plain).gripe.map(|g| g.cause), None);
    assert!(
        sim.demand_memo_is_fresh(),
        "a ladder that reaches unmet demand"
    );
}

/// Ask about every unit every hour for three game days; the tower must match
/// a twin that never asks, hour by hour: state, crowd and gameplay events.
fn asks_change_nothing(mode: GameMode) {
    let build = || {
        let mut sim = served_tower(mode, 6);
        sim.star = 5;
        for f in 2..=6 {
            for (kind, x) in [
                (Kind::Office, 10),
                (Kind::Condo, C + 6),
                (Kind::Office, C + 40),
            ] {
                let r = sim.build(kind, f, x);
                assert!(r.ok, "{kind:?} on {f}: {:?}", r.reason);
            }
        }
        assert!(sim.build(Kind::FastFood, 2, 120).ok);
        // An unhappy tenant per floor, so the gripe ladder runs from the first
        // hour: a gouged rent names a gripe, and a fair one reaches the tier
        // that reads coverage.
        for f in 2..=6 {
            let id = tenant(&mut sim, Kind::Office, f, C + 80, UnitState::Occupied, 0.15);
            if f % 2 == 0 {
                sim.tower.get_unit_mut(id).unwrap().rent = Some(20_000.0);
            }
        }
        sim
    };
    let mut asked = build();
    let mut quiet = build();
    // Reads per section, so the run shows it reached the gated paths that
    // fill caches (the gripe ladder, the move-in gate), not just access.
    let (mut access, mut gripe, mut wont_lease, mut filled) = (0, 0, 0, 0);
    for hour in 0..72 {
        let ids: Vec<i64> = asked.tower.units.iter().map(|u| u.id).collect();
        for id in ids {
            let f = asked.diagnostic_facts(id).expect("a unit");
            access += usize::from(f.access.is_some());
            gripe += usize::from(f.gripe.is_some());
            wont_lease += usize::from(f.wont_lease.is_some());
        }
        filled += usize::from(asked.demand_memo_is_fresh());
        asked.tick(60.0);
        quiet.tick(60.0);
        assert_eq!(
            digest(&state_view(&asked)),
            digest(&state_view(&quiet)),
            "{mode:?} hour {hour}"
        );
        assert_eq!(
            digest(&asked.crowd.view()),
            digest(&quiet.crowd.view()),
            "{mode:?} hour {hour}"
        );
        assert_eq!(
            crate::gameplay::batch_json(&asked.gameplay.drain()).to_string(),
            crate::gameplay::batch_json(&quiet.gameplay.drain()).to_string(),
            "{mode:?} hour {hour}"
        );
    }
    assert!(
        access > 1_000 && gripe > 0 && wont_lease > 0 && filled > 0,
        "{mode:?}: access {access}, gripe {gripe}, won't lease {wont_lease}, memo filled in {filled} hours"
    );
}

#[test]
fn asking_changes_nothing_in_classic() {
    asks_change_nothing(GameMode::Classic);
}

#[test]
fn asking_changes_nothing_in_modern() {
    asks_change_nothing(GameMode::Modern);
}

#[test]
fn a_fresh_simulation_has_no_inspector_memo() {
    let sim = Simulation::new_game(3, GameMode::Classic);
    assert!(!sim.demand_memo_is_filled());
}
