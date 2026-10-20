//! Port of `crowd/segmentGraph.ts`: reachability probes.
//!
//! `segReachable` asks whether a passenger route runs from any lobby
//! segment to a target, and the TypeScript answers with one route search
//! per lobby segment for every room it checks (#849). The demand, income
//! and move-in passes ask it for each room on a split floor every hour, so
//! here the answer comes from a set of every segment reachable from a
//! lobby, built once per tower revision (#1143). The routing graph is
//! memoized on the same key, so the set answers exactly as fresh searches
//! over that graph would.

use std::collections::HashSet;

use super::routing::{adjacency, walk_budget_step, WalkState};
use super::{AdjGraph, Crowd};
use crate::tower::Tower;
use crate::tower_query::seg_id;

/// `segReachable`: whether `passengerPath` finds a route to `target` from
/// any lobby segment. A route search succeeds exactly when its target is in
/// the closure of its origin under the router's moves, so the union of
/// those closures over every lobby segment answers for all of them. In
/// Modern that closure is the plain graph's, which `connected_set` already
/// holds; the Classic router walks a state graph with a walkway budget, so
/// its closure has its own memo.
fn seg_reachable(crowd: &mut Crowd, tower: &Tower, target: i64) -> bool {
    if tower.mode.walkway_willingness_applies() {
        walk_budget_reach(crowd, tower).contains(&target)
    } else {
        connected_set(crowd, tower).contains(&target)
    }
}

/// Every segment the walk-budget router (`bfs_route_walk_budget`) reaches
/// from some lobby segment: one search from all of them at once, with the
/// router's own step, so a state is reached here exactly when one of the
/// single-origin searches would reach it.
fn walk_budget_reach<'a>(crowd: &'a mut Crowd, tower: &Tower) -> &'a HashSet<i64> {
    let fresh = !matches!(&crowd.lobby_reach, Some((rev, _)) if *rev == tower.revision);
    if fresh {
        let origins = tower.lobby_segs();
        let reach = closure_under_walk_budget(adjacency(crowd, tower), &origins);
        crowd.lobby_reach = Some((tower.revision, reach));
    }
    &crowd.lobby_reach.as_ref().unwrap().1
}

fn closure_under_walk_budget(adj: &AdjGraph, origins: &[i64]) -> HashSet<i64> {
    let mut seen: HashSet<WalkState> = HashSet::new();
    let mut segs: HashSet<i64> = HashSet::new();
    let mut frontier: Vec<WalkState> = Vec::new();
    for &s in origins {
        let origin: WalkState = (s, 0, None);
        if seen.insert(origin) {
            segs.insert(s);
            frontier.push(origin);
        }
    }
    while let Some(s) = frontier.pop() {
        let Some(edges) = adj.get(&s.0) else { continue };
        for edge in edges {
            let Some(ns) = walk_budget_step(s, edge) else {
                continue;
            };
            if seen.insert(ns) {
                segs.insert(ns.0);
                frontier.push(ns);
            }
        }
    }
    segs
}

pub fn position_reachable(crowd: &mut Crowd, tower: &Tower, floor: i64, x: i64) -> bool {
    let s = tower.seg_at(floor, Some(x as f64));
    seg_reachable(crowd, tower, s)
}

pub fn floor_reachable_from_lobby(crowd: &mut Crowd, tower: &Tower, floor: i64) -> bool {
    if floor == 1 {
        return true;
    }
    for (start, _) in tower.segments_of(floor) {
        if seg_reachable(crowd, tower, seg_id(floor, start)) {
            return true;
        }
    }
    false
}

fn connected_set<'a>(crowd: &'a mut Crowd, tower: &Tower) -> &'a HashSet<i64> {
    let fresh = !matches!(&crowd.seg_served, Some((rev, _)) if *rev == tower.revision);
    if fresh {
        let mut seen: HashSet<i64> = HashSet::new();
        let mut frontier: Vec<i64> = Vec::new();
        for s1 in tower.lobby_segs() {
            if seen.insert(s1) {
                frontier.push(s1);
            }
        }
        {
            let adj = adjacency(crowd, tower);
            while let Some(s) = frontier.pop() {
                if let Some(edges) = adj.get(&s) {
                    for e in edges {
                        if seen.insert(e.f) {
                            frontier.push(e.f);
                        }
                    }
                }
            }
        }
        crowd.seg_served = Some((tower.revision, seen));
    }
    &crowd.seg_served.as_ref().unwrap().1
}

pub fn segment_connected(crowd: &mut Crowd, tower: &Tower, floor: i64, x: i64) -> bool {
    let s = tower.seg_at(floor, Some(x as f64));
    connected_set(crowd, tower).contains(&s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameMode;
    use crate::crowd::routing::passenger_path;
    use crate::facilities::{Kind, LOT_WIDTH, MAX_FLOOR, MIN_FLOOR};
    use crate::sim::Simulation;
    use crate::tower_query::{floor_of_seg, NO_SEGMENT};

    /// `segReachable` as it was before the memo: one route search per
    /// lobby segment.
    fn searched(crowd: &mut Crowd, tower: &Tower, target: i64) -> bool {
        for s1 in tower.lobby_segs() {
            if passenger_path(crowd, tower, s1, target).is_some() {
                return true;
            }
        }
        false
    }

    /// The segment ids to check: every run on every floor, the ids a
    /// position off every run carries (one per tile, or with `sample` only
    /// those past each lot edge and next to each run), the off-run
    /// sentinel, and every node of the routing graph (a landing over no
    /// tile carries an id no run starts at). Sorted, so the order does not
    /// depend on the graph's hash map.
    fn every_segment(crowd: &mut Crowd, tower: &Tower, sample: bool) -> Vec<i64> {
        let mut segs = vec![NO_SEGMENT];
        for floor in MIN_FLOOR - 1..=MAX_FLOOR + 1 {
            let runs = tower.segments_of(floor);
            segs.extend(runs.iter().map(|r| seg_id(floor, r.0)));
            let xs: Vec<i64> = if sample {
                let edges = runs.iter().flat_map(|r| [r.0 - 1, r.1 + 1]);
                [-1, 0, LOT_WIDTH].into_iter().chain(edges).collect()
            } else {
                (-1..=LOT_WIDTH).collect()
            };
            segs.extend(xs.into_iter().map(|x| tower.seg_at(floor, Some(x as f64))));
        }
        for (&from, edges) in adjacency(crowd, tower) {
            segs.push(from);
            segs.extend(edges.iter().map(|e| e.f));
        }
        segs.sort();
        segs.dedup();
        segs
    }

    /// The memo answers every segment as the per-lobby searches do, and
    /// returns the targets it found reachable.
    fn assert_matches_searches(sim: &mut Simulation) -> HashSet<i64> {
        check_segments(sim, false)
    }

    fn check_segments(sim: &mut Simulation, sample: bool) -> HashSet<i64> {
        let Simulation {
            ref mut crowd,
            ref tower,
            ..
        } = *sim;
        let mut reached = HashSet::new();
        for target in every_segment(crowd, tower, sample) {
            let memo = seg_reachable(crowd, tower, target);
            assert_eq!(memo, searched(crowd, tower, target), "segment {target}");
            if memo {
                reached.insert(target);
            }
        }
        // The answers came from this revision's memo for the mode, and
        // Modern never builds the walk-budget set.
        let current = |memo: &Option<(i64, HashSet<i64>)>| matches!(memo, Some((rev, _)) if *rev == tower.revision);
        if tower.mode.walkway_willingness_applies() {
            assert!(current(&crowd.lobby_reach));
        } else {
            assert!(current(&crowd.seg_served) && crowd.lobby_reach.is_none());
        }
        reached
    }

    /// A lobby on floor 1 and floor tiles on floors 2 to `top`, all at x 100
    /// to 199.
    fn bare_tower(mode: GameMode, top: i64) -> Simulation {
        let mut sim = Simulation::new_game(5, mode);
        sim.money = 1e12;
        for x in 100..200 {
            assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        }
        for floor in 2..=top {
            for x in 100..200 {
                assert!(sim.tower.place(Kind::Floor, floor, x).ok);
            }
        }
        sim
    }

    /// `bare_tower` with one flight of each given kind per floor, climbing
    /// from the lobby. The floor above the last flight has no way in.
    fn walkway_tower(mode: GameMode, flights: &[Kind]) -> Simulation {
        let mut sim = bare_tower(mode, flights.len() as i64 + 2);
        for (i, &kind) in flights.iter().enumerate() {
            let (x, bottom) = (100 + 12 * i as i64, 1 + i as i64);
            assert!(sim.tower.place_transport(kind, x, bottom, bottom + 1).ok);
        }
        sim
    }

    /// Five flights of stairs from the lobby, one more than the Classic
    /// budget allows in a row.
    fn stair_tower(mode: GameMode) -> Simulation {
        assert_eq!(Kind::Stairs.walkway_willingness(), Some(4));
        walkway_tower(mode, &[Kind::Stairs; 5])
    }

    fn floor_seg(sim: &Simulation, floor: i64, x: i64) -> i64 {
        sim.tower.seg_at(floor, Some(x as f64))
    }

    #[test]
    fn the_classic_walk_budget_bounds_the_reach() {
        // Floor 6 is five flights up: out of reach in Classic, in reach in
        // Modern, where only the graph decides.
        let mut classic = stair_tower(GameMode::Classic);
        let reached = assert_matches_searches(&mut classic);
        assert!(reached.contains(&floor_seg(&classic, 5, 150)));
        assert!(!reached.contains(&floor_seg(&classic, 6, 150)));
        let mut modern = stair_tower(GameMode::Modern);
        let reached = assert_matches_searches(&mut modern);
        assert!(reached.contains(&floor_seg(&modern, 6, 150)));
        assert!(!reached.contains(&floor_seg(&modern, 7, 150)));
    }

    #[test]
    fn a_walk_keeps_the_lowest_budget_it_has_met() {
        // Escalators allow seven flights in a row. A run that meets a stair
        // keeps the stairs' four from then on, escalators included.
        assert_eq!(Kind::Escalator.walkway_willingness(), Some(7));
        let mut escalators = walkway_tower(GameMode::Classic, &[Kind::Escalator; 8]);
        let reached = assert_matches_searches(&mut escalators);
        assert!(reached.contains(&floor_seg(&escalators, 8, 150)));
        assert!(!reached.contains(&floor_seg(&escalators, 9, 150)));
        let (e, s) = (Kind::Escalator, Kind::Stairs);
        let mut mixed = walkway_tower(GameMode::Classic, &[e, e, s, e, e, e]);
        let reached = assert_matches_searches(&mut mixed);
        assert!(reached.contains(&floor_seg(&mixed, 5, 150)));
        assert!(!reached.contains(&floor_seg(&mixed, 6, 150)));
    }

    #[test]
    fn every_lobby_run_is_an_origin_with_its_own_walk() {
        // Two lobby runs, x 100 to 139 and 160 to 199, with floors 2 to 4
        // split the same way and floors 5 to 9 whole. One run climbs four
        // flights of stairs to floor 5; the other takes an elevator to floor
        // 4 and one flight to floor 5. Stairs from floor 5 climb to 9.
        // Arriving with one flight walked, the elevator side's walkers get to
        // floor 8; the stair side's, with four, get no higher than floor 5.
        // The mirrored layout swaps the sides, so either run can be the one
        // a search reaches floor 5 from first.
        for mode in [GameMode::Classic, GameMode::Modern] {
            for mirrored in [false, true] {
                // The x of something `width` wide, flipped about the middle
                // of x 100 to 199 in the mirrored layout.
                let at = |x: i64, width: i64| if mirrored { 300 - x - width } else { x };
                let mut sim = bare_tower(mode, 9);
                for floor in 1..=4 {
                    for x in 140..160 {
                        let tile = sim.tower.unit_at(floor, x).map(|u| u.id).unwrap();
                        assert!(sim.tower.remove_unit(tile).is_some());
                    }
                }
                let stairs = [(100, 1), (110, 2), (120, 3), (130, 4), (160, 4)];
                let more = [(140, 5), (152, 6), (164, 7), (176, 8)];
                for (x, bottom) in stairs.into_iter().chain(more) {
                    let x = at(x, 8);
                    let placed = sim
                        .tower
                        .place_transport(Kind::Stairs, x, bottom, bottom + 1);
                    assert!(placed.ok, "stairs at {x}, floor {bottom}");
                }
                let lift = sim
                    .tower
                    .place_transport(Kind::ElevatorStandard, at(184, 4), 1, 4);
                assert!(lift.ok);
                assert_eq!(sim.tower.lobby_segs().len(), 2);
                let reached = assert_matches_searches(&mut sim);
                let stair_side = floor_seg(&sim, 1, at(120, 1));
                let lift_side = floor_seg(&sim, 1, at(180, 1));
                let (top, roof) = (floor_seg(&sim, 8, 150), floor_seg(&sim, 9, 150));
                if mode.walkway_willingness_applies() {
                    assert!(reached.contains(&top) && !reached.contains(&roof));
                    // Floor 8 is in reach from the elevator side only.
                    let Simulation {
                        ref mut crowd,
                        ref tower,
                        ..
                    } = sim;
                    assert!(passenger_path(crowd, tower, stair_side, top).is_none());
                    assert!(passenger_path(crowd, tower, lift_side, top).is_some());
                } else {
                    assert!(reached.contains(&roof));
                }
            }
        }
    }

    #[test]
    fn the_memo_follows_each_layout_edit() {
        for mode in [GameMode::Classic, GameMode::Modern] {
            let mut sim = stair_tower(mode);
            assert_matches_searches(&mut sim);
            // An elevator resets the walk run: floors 6 and 7 come in reach.
            let lift = sim
                .tower
                .place_transport(Kind::ElevatorStandard, 170, 1, 7)
                .unit_id
                .unwrap();
            let reached = assert_matches_searches(&mut sim);
            assert!(reached.contains(&floor_seg(&sim, 6, 150)));
            assert!(reached.contains(&floor_seg(&sim, 7, 150)));
            // A tile pulled from floor 3 splits it: the stair landing keeps
            // the left part, the elevator the right.
            let gap = sim.tower.unit_at(3, 160).map(|u| u.id).unwrap();
            assert!(sim.tower.remove_unit(gap).is_some());
            let reached = assert_matches_searches(&mut sim);
            assert!(reached.contains(&floor_seg(&sim, 3, 110)));
            assert!(reached.contains(&floor_seg(&sim, 3, 170)));
            // An elevator that skips floor 3 leaves its right part with no
            // way in, until it stops there again.
            assert!(sim.tower.set_stop(lift, 3, false));
            let reached = assert_matches_searches(&mut sim);
            assert!(!reached.contains(&floor_seg(&sim, 3, 170)));
            assert!(sim.tower.set_stop(lift, 3, true));
            let reached = assert_matches_searches(&mut sim);
            assert!(reached.contains(&floor_seg(&sim, 3, 170)));
            // Cut back to floor 5, the elevator leaves floor 7 with no way
            // in, while floor 6 is one flight above it.
            assert!(sim.tower.resize_transport(lift, 1, 5).ok);
            let reached = assert_matches_searches(&mut sim);
            assert!(reached.contains(&floor_seg(&sim, 6, 150)));
            assert!(!reached.contains(&floor_seg(&sim, 7, 150)));
            // Without the elevator the right part of floor 3 has no way in.
            assert!(sim.tower.remove_transport(lift).is_some());
            let reached = assert_matches_searches(&mut sim);
            assert!(!reached.contains(&floor_seg(&sim, 3, 170)), "{mode:?}");
            // A lobby split leaves the stairs on the left-hand run, and the
            // right-hand run, with no transport, an origin of its own.
            let lobby_gap = sim.tower.unit_at(1, 140).map(|u| u.id).unwrap();
            assert!(sim.tower.remove_unit(lobby_gap).is_some());
            assert_eq!(sim.tower.lobby_segs().len(), 2);
            let reached = assert_matches_searches(&mut sim);
            assert!(reached.contains(&floor_seg(&sim, 1, 170)));
            assert!(reached.contains(&floor_seg(&sim, 2, 150)));
            // Filling the gap joins the runs again.
            assert!(sim.tower.place(Kind::Lobby, 1, 140).ok);
            assert_eq!(sim.tower.lobby_segs().len(), 1);
            let reached = assert_matches_searches(&mut sim);
            assert!(reached.contains(&floor_seg(&sim, 1, 170)));
        }
    }

    #[test]
    fn a_reload_answers_from_a_fresh_memo() {
        for mode in [GameMode::Classic, GameMode::Modern] {
            let mut sim = stair_tower(mode);
            let before = assert_matches_searches(&mut sim);
            let mut loaded = crate::load::deserialize(&sim.serialize()).expect("the save loads");
            assert!(loaded.crowd.lobby_reach.is_none() && loaded.crowd.seg_served.is_none());
            assert_eq!(assert_matches_searches(&mut loaded), before, "{mode:?}");
        }
    }

    #[test]
    fn the_fixture_towers_answer_as_the_searches_do() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures/");
        let mut modes = Vec::new();
        for name in ["split-tower-4", "split-tower", "sixseven_2", "towerone_6"] {
            let path = format!("{dir}{name}.vctower");
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
            let raw = crate::load::decode_vctower(&text).expect("decodes");
            let mut sim = crate::load::deserialize(&raw).expect("loads");
            // An off-run position has its own id per tile, and the old
            // searches walk the whole graph for each unreachable one, so the
            // fixtures check a sample of those; the small towers check all.
            let reached = check_segments(&mut sim, true);
            let upstairs = reached.iter().filter(|&&s| floor_of_seg(s) > 1).count();
            assert!(upstairs > 10, "{name}: {upstairs} segments above the lobby");
            modes.push(sim.tower.mode);
        }
        assert!(modes.contains(&GameMode::Classic) && modes.contains(&GameMode::Modern));
    }
}
