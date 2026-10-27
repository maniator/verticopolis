//! Native tests for the staff graph's parts, which let a staff route between
//! two unjoined parts fail without a search (#1143 item 6).

use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

fn edge(f: i64) -> Edge {
    Edge {
        f,
        shaft: 0,
        walk_kind: None,
    }
}

#[test]
fn parts_never_split_a_pair_the_search_joins() {
    // 1 and 2 both ways, 2 and 3 one way only, 4 and 5 both ways, and 6
    // listed with no edge (a transport with one stop).
    let mut adj: AdjGraph = HashMap::new();
    adj.insert(1, vec![edge(2)]);
    adj.insert(2, vec![edge(1), edge(3)]);
    adj.insert(4, vec![edge(5)]);
    adj.insert(5, vec![edge(4)]);
    adj.insert(6, vec![]);
    // Listed out of numeric order, as a build may list them.
    let listed = [5, 2, 1, 4, 6];
    let parts = graph_parts(&adj, &listed);
    assert_eq!(
        parts.get(&1),
        Some(&2),
        "a part is labeled with its first listed segment"
    );
    assert_eq!(
        parts.get(&3),
        Some(&2),
        "a one-way edge still joins its ends"
    );
    assert_eq!(parts.get(&4), Some(&5));
    assert_eq!(parts.get(&6), None);
    for a in 0..8 {
        for b in 0..8 {
            if a != b && bfs_route(&adj, a, b).is_some() {
                assert!(!parts_split(&parts, a, b), "{a} -> {b}");
            }
        }
    }
    // With every edge in a pair, as the tower's graphs have them, the parts
    // answer exactly what the search would.
    adj.get_mut(&2).unwrap().pop();
    let parts = graph_parts(&adj, &listed);
    for a in 0..8 {
        for b in 0..8 {
            if a != b {
                let found = bfs_route(&adj, a, b).is_some();
                assert_eq!(!parts_split(&parts, a, b), found, "{a} -> {b}");
            }
        }
    }
}

fn route(sim: &mut Simulation, from: (i64, f64), to: (i64, f64)) -> bool {
    let Simulation {
        ref mut crowd,
        ref tower,
        ..
    } = *sim;
    staff_route(crowd, tower, from.0, Some(from.1), to.0, Some(to.1)).is_some()
}

/// Every position from a few starts against the search on its own, as staff
/// routing ran it before the parts.
fn routes_match_the_search(sim: &mut Simulation) {
    let spots: Vec<(i64, f64)> = (1..=7)
        .flat_map(|fl| (145..235).step_by(3).map(move |x| (fl, x as f64 + 0.5)))
        .collect();
    // (1, 160.0) is on the lobby, which no staff transport serves.
    for &from in &[
        (1, 160.0),
        (2, 204.0),
        (5, 170.0),
        (5, 210.0),
        (6, 200.0),
        (3, 192.5),
    ] {
        for &to in &spots {
            let Simulation {
                ref mut crowd,
                ref tower,
                ..
            } = *sim;
            let (a, b) = (
                tower.seg_at(from.0, Some(from.1)),
                tower.seg_at(to.0, Some(to.1)),
            );
            let searched = match off_run_pair(a, b, from.0, Some(from.1), to.0, Some(to.1)) {
                Some(decided) => decided.is_some(),
                None => bfs_route(staff_adjacency(crowd, tower).0, a, b).is_some(),
            };
            assert_eq!(route(sim, from, to), searched, "{from:?} -> {to:?}");
        }
    }
}

#[test]
fn parts_refuse_a_staff_route_only_where_the_search_fails() {
    let mut sim = Simulation::new_game(5, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 5;
    for x in 150..230 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for fl in 2..=5 {
        for x in 151..229 {
            assert!(sim.build(Kind::Floor, fl, x).ok, "floor {fl} at {x}");
        }
    }
    assert!(sim.build_transport(Kind::ElevatorService, 152, 2, 5).ok);
    // Floor 5 in two runs: the first service elevator reaches only the left
    // one, and a second joins the right one to floor 6 alone.
    for x in 190..196 {
        let id = sim.tower.unit_at(5, x).expect("a floor tile").id;
        assert!(sim.tower.remove_unit(id).is_some());
    }
    for x in 196..229 {
        assert!(sim.build(Kind::Floor, 6, x).ok, "floor 6 at {x}");
    }
    assert!(sim.build_transport(Kind::ElevatorService, 220, 5, 6).ok);
    assert_eq!(sim.tower.segments_of(5), vec![(151, 189), (196, 228)]);
    assert!(sim.tower.staff_connected(2, 6), "the floors are linked");
    {
        let Simulation {
            ref mut crowd,
            ref tower,
            ..
        } = sim;
        let parts = staff_adjacency(crowd, tower).1;
        let (left, right) = (tower.seg_at(5, Some(170.0)), tower.seg_at(5, Some(210.0)));
        assert!(parts.get(&left).is_some() && parts.get(&right).is_some());
        assert!(parts_split(parts, left, right), "two parts with edges");
    }
    assert!(route(&mut sim, (2, 204.0), (5, 170.0)));
    assert!(
        !route(&mut sim, (2, 204.0), (5, 210.0)),
        "the right run of floor 5 is off the low network"
    );
    assert!(!route(&mut sim, (2, 204.0), (6, 210.0)));
    assert!(route(&mut sim, (6, 200.0), (5, 210.0)));
    routes_match_the_search(&mut sim);
    // Stairs from floor 4 to the right run of floor 5 join the two parts
    // under a new revision.
    assert!(sim.build_transport(Kind::Stairs, 200, 4, 5).ok);
    assert!(route(&mut sim, (2, 204.0), (6, 210.0)));
    assert!(route(&mut sim, (2, 204.0), (5, 210.0)));
    routes_match_the_search(&mut sim);
    // A loaded tower builds its graph and parts afresh.
    let mut loaded = crate::load::deserialize(&sim.serialize()).expect("a save loads");
    assert!(loaded.crowd.staff_adj.is_none());
    routes_match_the_search(&mut loaded);
}
