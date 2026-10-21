//! Tests for #1237's room-only scans and the served-floor rebuild: the star
//! gates, the stranded-floor and metro scans and the served-floor closure
//! answer exactly as the walks they replaced did.

use std::collections::HashSet;

use super::reads_tests::{game, must, stacked, STATES};
use crate::facilities::{Kind, FACILITIES};
use crate::sim::Simulation;
use crate::star::is_tenant_floor_unit;
use crate::tower::{Tower, UnitState};

#[test]
fn no_tile_can_pass_the_room_only_scans() {
    // The star gates, the stranded-floor, metro and parking scans and the
    // operational checks for room kinds skip tiles. That is safe because no
    // tile kind has a population, is a hotel, or is a kind they name.
    for kind in FACILITIES.iter().map(|f| f.kind) {
        if !kind.is_structural() {
            continue;
        }
        assert_eq!(kind.facility().population, 0, "{kind:?}");
        assert!(!kind.is_hotel(), "{kind:?}");
    }
    for kind in [
        Kind::Office,
        Kind::Condo,
        Kind::Metro,
        Kind::ParkingRamp,
        Kind::Parking,
        Kind::Security,
        Kind::Medical,
        Kind::Recycling,
        Kind::HotelSuite,
        Kind::Cinema,
        Kind::WeddingHall,
    ] {
        assert!(!kind.is_structural(), "{kind:?}");
    }
    // Every tile kind in every state, on a tenant floor, fails each scan's
    // own predicate, in both stranded-floor scopes.
    let tower = stacked();
    for tile in tower.units.iter().filter(|u| u.kind.is_structural()) {
        for kind in FACILITIES
            .iter()
            .map(|f| f.kind)
            .filter(|k| k.is_structural())
        {
            for state in STATES {
                let mut u = tile.clone();
                u.kind = kind;
                u.state = state;
                u.floor = 5;
                assert!(!is_tenant_floor_unit(&u), "{kind:?} {state:?}");
                for rentable in [false, true] {
                    assert!(!Simulation::is_stranded_candidate(&u, rentable));
                }
            }
        }
    }
}

/// A full lot, x 0 to 374: a lobby on floor 1, floor tiles on floors 2 to 4
/// and on basement floors -2 to 0, with a Metro station under it all.
fn full_lot() -> (Simulation, i64) {
    let mut tower = Tower::new();
    let lobby = Kind::Lobby.facility().width;
    for x in (0..375 - lobby + 1).step_by(lobby as usize) {
        must(tower.place(Kind::Lobby, 1, x));
    }
    for floor in [2, 3, 4, 0, -1, -2] {
        for x in 0..375 {
            must(tower.place(Kind::Floor, floor, x));
        }
    }
    let metro = must(tower.place(Kind::Metro, -2, 0));
    (game(tower), metro)
}

/// What the scans answer, as they walked every unit: the occupied-floor
/// gate, the vacancy gate, the metro cut-off and both stranded-floor scopes.
type Scans = (bool, bool, bool, Vec<i64>, Vec<i64>);

fn walked_scans(sim: &mut Simulation) -> Scans {
    let tower = &sim.tower;
    let mut saw_one = false;
    let mut served = true;
    for u in &tower.units {
        if !is_tenant_floor_unit(u) {
            continue;
        }
        saw_one = true;
        if !tower.is_floor_served(u.floor) {
            served = false;
            break;
        }
    }
    let vacancy_free = !tower.units.iter().any(|u| {
        u.state == UnitState::Empty
            && (u.kind == Kind::Office || u.kind == Kind::Condo || u.kind.is_hotel())
    });
    let orphaned = tower
        .units
        .iter()
        .any(|u| u.kind == Kind::Metro && u.is_operational() && !tower.is_metro_platform_served(u));
    let mut stranded = [Vec::new(), Vec::new()];
    for (k, rentable) in [false, true].into_iter().enumerate() {
        let mut candidates: indexmap::IndexSet<i64> = indexmap::IndexSet::new();
        for u in &sim.tower.units {
            if Simulation::is_stranded_candidate(u, rentable) && sim.tower.is_floor_served(u.floor)
            {
                candidates.insert(u.floor);
            }
        }
        for floor in candidates {
            if !sim.floor_reachable(floor) {
                stranded[k].push(floor);
            }
        }
        stranded[k].sort();
    }
    let [kept, rentable] = stranded;
    (saw_one && served, vacancy_free, orphaned, kept, rentable)
}

fn assert_scans(sim: &mut Simulation) {
    let (served, vacancy_free, orphaned, kept, rentable) = walked_scans(sim);
    assert_eq!(sim.every_occupied_floor_served(), served);
    assert_eq!(sim.no_leasable_vacancy(), vacancy_free);
    assert_eq!(sim.stranded_floors(false), kept);
    assert_eq!(sim.stranded_floors(true), rentable);
    sim.nudge_metro_platform();
    assert_eq!(sim.metro_platform_nudged, orphaned);
}

#[test]
fn the_room_only_scans_match_the_full_walk() {
    let (mut sim, metro) = full_lot();
    assert_scans(&mut sim);
    let office = must(sim.tower.place(Kind::Office, 2, 10));
    let condo = must(sim.tower.place(Kind::Condo, 4, 40));
    let hotel = must(sim.tower.place(Kind::HotelSingle, 3, 60));
    must(sim.tower.place(Kind::FastFood, 3, 80));
    assert_scans(&mut sim);
    // A shaft serves floors 1 to 3 and leaves floor 4 and the platform out.
    let lift = must(sim.tower.place_transport(Kind::ElevatorStandard, 200, 1, 3));
    assert_scans(&mut sim);
    // Every state of each room, with the scans read after each change, so
    // each gate passes and fails on its own.
    for id in [office, condo, hotel, metro] {
        for state in STATES {
            sim.tower.get_unit_mut(id).unwrap().state = state;
            assert_scans(&mut sim);
        }
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    }
    // A shaft through the basement serves the platform and every floor.
    assert!(sim.tower.remove_transport(lift).is_some());
    must(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 200, -1, 4),
    );
    for id in [office, condo, hotel, metro] {
        for state in STATES {
            sim.tower.get_unit_mut(id).unwrap().state = state;
            assert_scans(&mut sim);
        }
    }
    let mut loaded = crate::load::deserialize(&sim.serialize()).expect("the save loads");
    assert_scans(&mut loaded);
}

/// `servedFloors` as the fixpoint over every transport computed it before
/// the stops were listed once.
fn walked_served(tower: &Tower) -> Vec<i64> {
    let mut reachable: HashSet<i64> = HashSet::new();
    reachable.insert(1);
    let mut changed = true;
    while changed {
        changed = false;
        for t in &tower.transports {
            if t.kind.is_staff_only_transport() {
                continue;
            }
            let connects = (t.bottom..=t.top).any(|fl| t.stops_at(fl) && reachable.contains(&fl));
            if connects {
                for fl in t.bottom..=t.top {
                    if t.stops_at(fl) && !reachable.contains(&fl) {
                        reachable.insert(fl);
                        changed = true;
                    }
                }
            }
        }
    }
    let mut sorted: Vec<i64> = reachable.into_iter().collect();
    sorted.sort_unstable();
    sorted
}

fn assert_served(tower: &Tower, expected: &[i64]) {
    assert_eq!(walked_served(tower), expected);
    let mut served: Vec<i64> = tower.served_floors().into_iter().collect();
    served.sort_unstable();
    assert_eq!(served, expected);
    for floor in -3..=33 {
        assert_eq!(
            tower.is_floor_served(floor),
            expected.contains(&floor),
            "floor {floor}"
        );
    }
}

#[test]
fn the_served_floors_close_over_chains_listed_top_down() {
    // Floors 2 to 31 over x 100 to 179, with sky lobbies on 15 and 30.
    let mut tower = stacked();
    let lobby = Kind::Lobby.facility().width;
    for floor in 5..=31 {
        if floor == 15 || floor == 30 {
            for x in (100..180).step_by(lobby as usize) {
                must(tower.place(Kind::Lobby, floor, x));
            }
        } else {
            for x in 100..180 {
                must(tower.place(Kind::Floor, floor, x));
            }
        }
    }
    let all = |lo: i64, hi: i64| (lo..=hi).collect::<Vec<i64>>();
    // Placed top down, so each sweep of the fixpoint joins one more link.
    let top = must(tower.place_transport(Kind::ElevatorStandard, 130, 20, 31));
    assert_served(&tower, &[1]);
    let middle = must(tower.place_transport(Kind::ElevatorStandard, 140, 10, 20));
    let bottom = must(tower.place_transport(Kind::ElevatorStandard, 150, 1, 12));
    assert_served(&tower, &all(1, 31));
    // A staff-only shaft serves nobody.
    let service = must(tower.place_transport(Kind::ElevatorService, 160, -1, 4));
    assert_served(&tower, &all(1, 31));
    assert!(tower.remove_transport(service).is_some());
    // Skipped stops leave the bottom and middle cars no floor in common, so
    // the chain above breaks.
    assert!(tower.set_stop(bottom, 10, false));
    assert!(tower.set_stop(bottom, 11, false));
    assert!(tower.set_stop(middle, 12, false));
    let mut low = all(1, 9);
    low.push(12);
    assert_served(&tower, &low);
    // An express stops only at the lobbies, and joins the middle again at 15.
    let express = must(tower.place_transport(Kind::ElevatorExpress, 170, 1, 30));
    tower.set_express_stops(express);
    assert_served(&tower, &all(1, 31));
    // Without the middle car, floors 10, 11 and 13 to 19 have no stop.
    assert!(tower.remove_transport(middle).is_some());
    let mut expected = low.clone();
    expected.push(15);
    expected.extend(all(20, 31));
    assert_served(&tower, &expected);
    assert!(tower.remove_transport(top).is_some());
    let mut expected = low.clone();
    expected.extend([15, 30]);
    assert_served(&tower, &expected);
    // Stairs down to the basement link to the ground floor.
    must(tower.place_transport(Kind::Stairs, 110, 0, 1));
    expected.insert(0, 0);
    assert_served(&tower, &expected);
    tower.reindex();
    assert_served(&tower, &expected);
}
