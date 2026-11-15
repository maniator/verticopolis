//! The Modern router's A* bound (`expected_bound`): the least cost to the
//! goal, consistent with every link, searched right, kept across edits
//! that change no way up, and kept under its cap.

use super::bound::{least_cost, BOUND_CELLS};
use super::costs::cost_of;
use super::tests::{apart, first_shaft, tower};
use super::*;
use crate::clock::GameMode;
use crate::rule_tests::shaft;
use crate::sim::Simulation;

#[test]
fn the_bound_never_overtakes_a_link() {
    // A* finds the cheapest route only while the bound drops by no more
    // than each link costs (a consistent bound). Check every link of a
    // tower with every kind of way up, toward every goal, with lines at
    // the landings, which only ever add to a link.
    let mut sim = tower(GameMode::Modern, 20);
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 20);
    let local = shaft(&mut sim, Kind::ElevatorStandard, 10, 1, 15);
    shaft(&mut sim, Kind::ElevatorStandard, 16, 15, 20);
    shaft(&mut sim, Kind::Escalator, 24, 1, 2);
    shaft(&mut sim, Kind::Stairs, 30, 15, 16);
    // A second ground lobby apart from the first, over a basement, and an
    // elevator in it: the street joins the two.
    apart(&mut sim);
    shaft(&mut sim, Kind::ElevatorStandard, 60, 0, 1);
    let line = |riders| crate::crowd::line_count::Line {
        riders,
        oldest: 0.0,
    };
    sim.crowd.shaft_lines = FastMap::from_iter([((express, 1), line(30)), ((local, 1), line(5))]);
    sim.crowd.begin_step();
    let router = fresh(&mut sim.crowd, &sim.tower);
    let goals: Vec<u32> = (0..router.nodes.len() as u32)
        .filter(|&p| matches!(router.nodes[p as usize], Node::Segment(_)))
        .collect();
    let (mut checked, mut above_zero, mut streets) = (0, 0, 0);
    for &goal in &goals {
        let (toward, fresh) = bound_toward(router, goal, None);
        let bound = &toward.least;
        assert!(fresh);
        assert_eq!(bound[goal as usize], 0);
        for (p, links) in router.links.iter().enumerate() {
            above_zero += usize::from(bound[p] > 0 && bound[p] < UNREACHABLE);
            for l in links.iter().filter(|l| bound[l.to as usize] < UNREACHABLE) {
                let cost = cost_of(router, l);
                assert!(cost >= least_cost(&router.shafts, l));
                assert!(
                    i64::from(bound[p]) <= cost + i64::from(bound[l.to as usize]),
                    "node {p} to {} toward {goal}",
                    l.to
                );
                checked += 1;
                streets += usize::from(matches!(l.how, Move::Street));
            }
        }
        keep_bound(router, goal, (toward, fresh));
    }
    assert!(checked > 1000, "only {checked} links checked");
    assert!(streets > 0, "the street's links were checked");
    // The bound does add something, or this test pins nothing.
    assert!(above_zero > 0);
}

/// The least cost from every node to `goal`, the plain way: relax every
/// link until nothing drops. Slow and plainly right, to check the bound's
/// search against.
fn least_by_relaxing(router: &Router, goal: u32) -> Vec<u32> {
    let mut least = vec![i64::MAX; router.nodes.len()];
    least[goal as usize] = 0;
    let mut dropped = true;
    while dropped {
        dropped = false;
        for (p, links) in router.links.iter().enumerate() {
            for l in links {
                let ahead = least[l.to as usize];
                let via = least_cost(&router.shafts, l).saturating_add(ahead);
                if ahead < i64::MAX && via < least[p] {
                    least[p] = via;
                    dropped = true;
                }
            }
        }
    }
    let entry = |c: i64| match c {
        i64::MAX => UNREACHABLE,
        c => u32::try_from(c).unwrap_or(UNREACHABLE - 1),
    };
    least.into_iter().map(entry).collect()
}

#[test]
fn the_bound_is_the_least_cost_to_the_goal() {
    // The bound's search settles cars without its heap; every entry must
    // still be the least cost to the goal, toward every goal, with a stop
    // skipped, a sky lobby change, walkways and the street.
    let mut sim = tower(GameMode::Modern, 21);
    shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 20);
    let local = shaft(&mut sim, Kind::ElevatorStandard, 10, 1, 15);
    assert!(sim.tower.set_stop(local, 8, false));
    shaft(&mut sim, Kind::ElevatorStandard, 14, 3, 12);
    shaft(&mut sim, Kind::ElevatorStandard, 16, 15, 20);
    shaft(&mut sim, Kind::Escalator, 24, 1, 2);
    shaft(&mut sim, Kind::Stairs, 30, 15, 16);
    shaft(&mut sim, Kind::Stairs, 32, 20, 21);
    apart(&mut sim);
    shaft(&mut sim, Kind::ElevatorStandard, 60, 0, 1);
    sim.crowd.begin_step();
    let router = fresh(&mut sim.crowd, &sim.tower);
    let goals: Vec<u32> = (0..router.nodes.len() as u32)
        .filter(|&p| matches!(router.nodes[p as usize], Node::Segment(_)))
        .collect();
    for &goal in &goals {
        let whole = least_by_relaxing(router, goal);
        // Searched only as far as a start needs, every node nearer the
        // goal than the start has its least cost already.
        let start = goals[(goal as usize * 7 + 3) % goals.len()];
        let (part, fresh) = bound_toward(router, goal, Some(start));
        assert!(fresh);
        let radius = part.least[start as usize];
        assert_eq!(radius, whole[start as usize], "start {start} toward {goal}");
        for (p, &least) in whole.iter().enumerate() {
            let ahead = part.ahead(p as u32, radius);
            let want = (least != UNREACHABLE).then(|| least.min(radius));
            assert!(ahead == want || (least == UNREACHABLE && ahead == Some(radius)));
        }
        keep_bound(router, goal, (part, fresh));
        // Picked up from there, the search ends where a whole one does.
        let (bound, fresh) = bound_toward(router, goal, None);
        assert!(!fresh);
        assert_eq!(bound.least, whole, "toward {goal}");
        keep_bound(router, goal, (bound, fresh));
    }
    assert!(goals.len() > 20, "only {} goals", goals.len());
}

#[test]
fn with_no_lines_the_bound_is_the_route_itself() {
    // With nobody waiting and every car a shaft holds running, every link
    // costs its least, so the bound from the start is the cheapest route's
    // cost.
    let mut sim = tower(GameMode::Modern, 20);
    for (kind, x, bottom, top) in [
        (Kind::ElevatorExpress, 4, 1, 20),
        (Kind::ElevatorStandard, 10, 1, 15),
    ] {
        let id = shaft(&mut sim, kind, x, bottom, top);
        assert!(sim.tower.set_cars(id, kind.max_cars()));
    }
    shaft(&mut sim, Kind::Stairs, 30, 15, 16);
    sim.crowd.begin_step();
    let router = fresh(&mut sim.crowd, &sim.tower);
    let place = |router: &Router, floor: i64| {
        let seg = (0..router.nodes.len() as u32).find(|&p| match router.nodes[p as usize] {
            Node::Segment(s) => crate::tower_query::floor_of_seg(s) == floor,
            Node::Car(..) => false,
        });
        seg.expect("a segment on the floor")
    };
    for to in [15, 16, 20] {
        let (start, goal) = (place(router, 1), place(router, to));
        assert!(search(router, start, goal));
        let cost = router.best[goal as usize];
        for p in router.touched.drain(..) {
            router.best[p as usize] = i64::MAX;
        }
        let bound = router.toward[goal as usize].as_ref().expect("kept");
        assert_eq!(
            i64::from(bound.least[start as usize]),
            cost,
            "to floor {to}"
        );
    }
}

#[test]
fn the_kept_bounds_stay_under_their_cap() {
    // Each goal's bound holds one entry per node. Past `BOUND_CELLS` the
    // oldest goal's bound goes, and a search toward it again finds it anew.
    let mut sim = tower(GameMode::Modern, 20);
    shaft(&mut sim, Kind::ElevatorStandard, 10, 1, 20);
    sim.crowd.begin_step();
    let router = fresh(&mut sim.crowd, &sim.tower);
    let goals: Vec<u32> = (0..router.nodes.len() as u32)
        .filter(|&p| matches!(router.nodes[p as usize], Node::Segment(_)))
        .collect();
    let room = BOUND_CELLS / router.nodes.len();
    // Bounds made up past the cap stand in for a tower that many goals big.
    // They all claim one goal, which real searches never do (a goal with a
    // fresh bound is not kept yet); here they are only filler.
    let filler = vec![0_u32; router.nodes.len()];
    for _ in 0..room {
        keep_bound(router, goals[1], (Toward::searched(filler.clone()), true));
    }
    assert_eq!(router.kept.len(), room);
    let start = goals[0];
    assert!(search(router, start, goals[2]));
    for p in router.touched.drain(..) {
        router.best[p as usize] = i64::MAX;
    }
    assert_eq!(router.kept.len(), room, "a new bound pushes the oldest out");
    assert_eq!(router.kept.back(), Some(&goals[2]));
    let kept: usize = router.toward.iter().flatten().map(|t| t.least.len()).sum();
    assert!(kept <= BOUND_CELLS);
    // Searching toward a kept goal again keeps it once.
    assert!(search(router, start, goals[2]));
    assert_eq!(router.kept.len(), room);
}

#[test]
fn an_edit_that_changes_no_way_up_keeps_the_bounds() {
    // A bound depends only on the graph's ways and their least costs, so a
    // tower edit that leaves them as they were keeps every bound searched,
    // and one that adds a way up drops them, since a new shaft can make a
    // route cheaper.
    let mut sim = tower(GameMode::Modern, 20);
    let lift = shaft(&mut sim, Kind::ElevatorStandard, 10, 1, 20);
    sim.crowd.begin_step();
    first_shaft(&mut sim, 12);
    first_shaft(&mut sim, 20);
    let kept = |sim: &Simulation| sim.crowd.router.as_ref().map_or(0, |r| r.kept.len());
    assert_eq!(kept(&sim), 2);
    // A room on a floor the shaft already serves.
    let revision = sim.tower.revision;
    assert!(sim.tower.place(Kind::Office, 5, 20).ok);
    assert_ne!(sim.tower.revision, revision, "the room is an edit");
    first_shaft(&mut sim, 12);
    assert_eq!(kept(&sim), 2, "the room kept the graph and its bounds");
    // More cars, the edit a player makes while lines grow: the bound
    // already counts every car the shaft can hold.
    assert!(sim.tower.set_cars(lift, 3));
    first_shaft(&mut sim, 12);
    assert_eq!(kept(&sim), 2, "more cars kept the bounds");
    shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 20);
    first_shaft(&mut sim, 12);
    assert_eq!(kept(&sim), 1, "a new shaft searches its goals anew");
}
