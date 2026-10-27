//! Tests for `dispatch.rs`: the stop bit sets, the ordered waiting map and
//! the per-revision floor lists answer exactly as the hashed sets and the
//! per-call rebuilds did (#1143 item 5, A20 and A10 in #1158).

use std::collections::HashMap;

use indexmap::IndexMap;

use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::schedule::Schedule;
use crate::sim::Simulation;
use crate::tower::{PlaceResult, Tower, UnitState};

#[cfg(test)]
#[path = "dispatch_reference_tests.rs"]
mod reference;
use reference::Reference;

#[cfg(test)]
#[path = "dispatch_search_tests.rs"]
mod search;

/// A small deterministic generator for the scenario's inputs.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self, n: u64) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.0 >> 33) % n
    }
}

fn must(placed: PlaceResult) -> i64 {
    assert!(placed.ok, "{:?}", placed.reason);
    placed.unit_id.unwrap_or(-1)
}

/// Lobbies on floors 1 and 15, floor tiles up to floor 22, offices on every
/// other floor (floor 22's sit above every passenger stop, so they are
/// unserved), a cinema, and four shafts: a standard to floor 15, an express,
/// a service car and a scheduled standard from the sky lobby up.
/// Where `tall_scenario` puts its tall express shaft.
const TALL_X: i64 = 172;

/// `scenario` with an express shaft from floor 1 to floor 80 beside the
/// others, so its stops run past one 64-bit word.
fn tall_scenario() -> Tower {
    let mut tower = scenario();
    for floor in 23..=80 {
        for x in 168..184 {
            must(tower.place(Kind::Floor, floor, x));
        }
    }
    let tall = must(tower.place_transport(Kind::ElevatorExpress, TALL_X, 1, 80));
    let t = tower.transports.iter_mut().find(|t| t.id == tall).unwrap();
    t.cars = 8;
    // Spread up the shaft: a car finds its nearest call, so cars that all
    // start at the bottom would never reach the second word.
    t.car_positions = (0..8).map(|i| 1.0 + 11.0 * i as f64).collect();
    t.car_dir = vec![0; 8];
    tower
}

fn scenario() -> Tower {
    let mut tower = Tower::new();
    let lobby = Kind::Lobby.facility().width as usize;
    for floor in 1..=22 {
        for x in 100..220 {
            match floor {
                1 | 15 if x % lobby as i64 == 0 => must(tower.place(Kind::Lobby, floor, x)),
                1 | 15 => continue,
                _ => must(tower.place(Kind::Floor, floor, x)),
            };
        }
    }
    for floor in (2..=22).filter(|f| *f != 15) {
        must(tower.place(Kind::Office, floor, 104));
        must(tower.place(Kind::Office, floor, 120));
    }
    must(tower.place(Kind::Cinema, 9, 140));
    must(tower.place_transport(Kind::ElevatorStandard, 180, 1, 15));
    must(tower.place_transport(Kind::ElevatorExpress, 188, 1, 15));
    must(tower.place_transport(Kind::ElevatorService, 196, 1, 21));
    let sky = must(tower.place_transport(Kind::ElevatorStandard, 204, 15, 21));
    let t = tower.transports.iter_mut().find(|t| t.id == sky).unwrap();
    t.schedule = Some(Schedule {
        weekday: Some((0..24).map(|h| if h < 8 { 1 } else { 8 }).collect()),
        weekend: Some(vec![2; 24]),
        waiting_car_response: Some(3.0),
        standard_floor_departure: None,
        home_floors: Some(vec![15, 18, 21]),
    });
    for t in &mut tower.transports {
        t.cars = 8;
        t.car_positions = vec![t.bottom as f64; 8];
        t.car_dir = vec![0; 8];
    }
    tower
}

/// Occupancy and presence moved by the generator, the same on both towers.
fn stir(tower: &mut Tower, rng: &mut Lcg) {
    for u in tower.units.iter_mut().filter(|u| !u.kind.is_structural()) {
        u.occupants = rng.next(30) as i64 - 4;
        u.state = if rng.next(3) == 0 {
            UnitState::Empty
        } else {
            UnitState::Occupied
        };
    }
}

fn random_calls(tower: &Tower, rng: &mut Lcg) -> ElevatorCalls {
    let mut calls = ElevatorCalls::default();
    for t in &tower.transports {
        if rng.next(4) > 0 {
            let hall = calls.hall.entry(t.id).or_default();
            for _ in 0..rng.next(6) {
                // Floors off the span and fractions below one are in range.
                let floor = t.bottom - 2 + rng.next((t.top - t.bottom + 5) as u64) as i64;
                hall.insert(floor, rng.next(5) as f64 * 0.5);
            }
        }
        if rng.next(3) > 0 {
            let cab = calls.cab.entry(t.id).or_default();
            for _ in 0..rng.next(5) {
                let floor = t.bottom - 1 + rng.next((t.top - t.bottom + 3) as u64) as i64;
                cab.entry(rng.next(10) as i64).or_default().insert(floor);
            }
        }
    }
    calls
}

fn bits(v: &[f64]) -> Vec<u64> {
    v.iter().map(|x| x.to_bits()).collect()
}

fn assert_same(tower: &Tower, d: &ElevatorDispatch, rt: &Tower, r: &Reference, at: usize) {
    assert_eq!(tower.transports.len(), rt.transports.len(), "step {at}");
    for (t, u) in tower.transports.iter().zip(&rt.transports) {
        assert_eq!(t.id, u.id, "step {at}");
        assert_eq!(
            bits(&t.car_positions),
            bits(&u.car_positions),
            "step {at}, shaft {}",
            t.id
        );
        assert_eq!(t.car_dir, u.car_dir, "step {at}, shaft {}", t.id);
        let load = |l: &Option<Vec<f64>>| l.as_deref().map(bits);
        assert_eq!(
            load(&t.car_load),
            load(&u.car_load),
            "step {at}, shaft {}",
            t.id
        );
    }
    let mut waiting: Vec<(i64, u64)> = r.waiting.iter().map(|(f, w)| (*f, w.to_bits())).collect();
    waiting.sort();
    let ours: Vec<(i64, u64)> = d.waiting.iter().map(|(f, w)| (*f, w.to_bits())).collect();
    assert_eq!(ours, waiting, "step {at}");
    let dwell = |m: &HashMap<i64, Vec<f64>>| {
        let mut v: Vec<(i64, Vec<u64>)> = m.iter().map(|(id, d)| (*id, bits(d))).collect();
        v.sort();
        v
    };
    assert_eq!(dwell(&d.car_dwell), dwell(&r.car_dwell), "step {at}");
}

/// Cars about to sit out a whole chunk dwelling on a floor their shaft no
/// longer stops at: the claim the reference keeps there and the bit sets drop.
fn dwelling_off_a_stop(tower: &Tower, d: &ElevatorDispatch, chunk: f64) -> usize {
    let mut n = 0;
    for t in tower.transports.iter().filter(|t| t.kind.is_elevator()) {
        let stops = tower.stops_of(t);
        let Some(dwell) = d.car_dwell.get(&t.id) else {
            continue;
        };
        for (i, w) in dwell.iter().enumerate() {
            let fl = crate::jsmath::round(t.car_positions[i]) as i64;
            if *w >= chunk && !stops.contains(&fl) {
                n += 1;
            }
        }
    }
    n
}

/// Takes a stop away from the first car dwelling inside its span, or from a
/// random shaft, on both towers; returns what to put back later.
fn drop_a_stop(towers: [&mut Tower; 2], d: &ElevatorDispatch, rng: &mut Lcg) -> Option<(i64, i64)> {
    let tower = &*towers[0];
    let dwelling = tower.transports.iter().find_map(|t| {
        let dwell = d.car_dwell.get(&t.id)?;
        (0..dwell.len()).find_map(|i| {
            let fl = crate::jsmath::round(t.car_positions[i]) as i64;
            (dwell[i] > 0.0 && fl > t.bottom && fl < t.top && t.stops_at(fl)).then_some((t.id, fl))
        })
    });
    let (id, fl) = dwelling.or_else(|| {
        let t = &tower.transports[rng.next(tower.transports.len() as u64) as usize];
        let fl = t.bottom + 1 + rng.next((t.top - t.bottom).max(1) as u64) as i64;
        (fl < t.top && t.stops_at(fl)).then_some((t.id, fl))
    })?;
    for tw in towers {
        assert!(tw.set_stop(id, fl, false));
    }
    Some((id, fl))
}

#[test]
fn dispatch_matches_the_hashed_reference_step_for_step() {
    let (mut tower, mut rt) = (tall_scenario(), tall_scenario());
    let (mut d, mut r) = (ElevatorDispatch::new(), Reference::default());
    let mut rng = Lcg(0x1143_0005);
    let mut dropped: Vec<(i64, i64)> = Vec::new();
    let (mut off_stop, mut empty_steps, mut tallies, mut calls_up) = (0, 0, 0, 0);
    let mut second_word = 0;
    for step in 0..3000 {
        let mut stir_rng = Lcg(rng.0);
        stir(&mut tower, &mut stir_rng);
        stir(&mut rt, &mut rng);
        // Now and then nobody is in: the lobbies get no share.
        if step % 50 == 7 {
            for tw in [&mut tower, &mut rt] {
                for u in tw.units.iter_mut().filter(|u| !u.kind.is_structural()) {
                    u.state = UnitState::Empty;
                }
            }
            empty_steps += 1;
            assert_eq!(tower.total_population(), 0);
        }
        // Stops come and go under dwelling cars, so a car can sit on a floor
        // that is no longer a stop of its shaft.
        if step % 20 == 3 {
            dropped.extend(drop_a_stop([&mut tower, &mut rt], &d, &mut rng));
        }
        if step % 100 == 53 {
            for (id, fl) in dropped.drain(..) {
                for tw in [&mut tower, &mut rt] {
                    tw.set_stop(id, fl, true);
                }
            }
        }
        // Layout edits on both towers: a shaft comes and goes, so the
        // served floors, the stops and the dwell prune all change.
        if step == 900 || step == 2400 {
            for tw in [&mut tower, &mut rt] {
                must(tw.place_transport(Kind::ElevatorStandard, 212, 15, 22));
            }
        }
        if step == 1500 || step == 2100 {
            // The short express first, then the shaft added at step 900.
            for tw in [&mut tower, &mut rt] {
                let x = if step == 1500 { 188 } else { 212 };
                let id = tw.transports.iter().find(|t| t.x == x).unwrap().id;
                assert!(tw.remove_transport(id).is_some());
            }
        }
        let rush = rng.next(7) as f64 * 0.5;
        let dt = [2.0, 0.5, 20.0, 1.25][rng.next(4) as usize];
        d.accumulate(&tower, dt, rush);
        r.accumulate(&rt, dt, rush);
        let mut left = dt.min(12.5);
        while left > 0.0 {
            let chunk = left.min(2.5);
            let calls = random_calls(&tower, &mut rng);
            let (hour, weekend) = (rng.next(24) as i64, rng.next(5) == 0);
            off_stop += dwelling_off_a_stop(&tower, &d, chunk);
            d.move_cars(&mut tower, chunk, &calls, hour, weekend);
            r.move_cars(&mut rt, chunk, &calls, hour, weekend);
            left -= chunk;
        }
        assert_same(&tower, &d, &rt, &r, step);
        // A tall-shaft car past its 64th stop works in the second word.
        let tall = tower.transports.iter().find(|t| t.x == TALL_X).unwrap();
        second_word += usize::from(tall.car_positions.iter().any(|p| *p >= 65.0));
        calls_up += usize::from(d.waiting.values().any(|w| *w >= 1.0));
        if step % 30 == 29 {
            let ours: Vec<_> = sorted_tally(d.drain_boardings());
            assert_eq!(
                ours,
                sorted_tally(std::mem::take(&mut r.board_tally)),
                "step {step}"
            );
            tallies += usize::from(!ours.is_empty());
        }
    }
    // The scenario reaches the paths the bit sets replaced.
    assert!(calls_up > 0, "the estimate never raised a call");
    assert!(off_stop > 0, "no car dwelt on a dropped stop");
    assert!(empty_steps > 0 && tallies > 0);
    assert!(
        second_word > 0,
        "no car reached the tall shaft's second word"
    );
}

type Tally = Vec<(i64, Vec<(i64, u64)>)>;

fn sorted_tally(t: HashMap<i64, IndexMap<i64, f64>>) -> Tally {
    let mut v: Tally = t
        .into_iter()
        .map(|(id, m)| (id, m.into_iter().map(|(f, n)| (f, n.to_bits())).collect()))
        .collect();
    v.sort_by_key(|(id, _)| *id);
    v
}

fn assert_floor_lists(tower: &Tower) {
    let floors = tower.dispatch_floors();
    let mut served: Vec<i64> = tower.served_floors().into_iter().collect();
    served.sort();
    assert_eq!(floors.served, served);
    assert_eq!(floors.lobbies, tower.lobby_floors());
}

#[test]
fn the_floor_lists_follow_every_layout_edit() {
    let mut tower = scenario();
    assert_floor_lists(&tower);
    let up = must(tower.place_transport(Kind::ElevatorStandard, 212, 15, 22));
    assert_floor_lists(&tower);
    assert!(tower.dispatch_floors().served.contains(&22));
    assert!(tower.remove_transport(up).is_some());
    assert_floor_lists(&tower);
    assert!(!tower.dispatch_floors().served.contains(&22));
    // A new sky lobby joins the lobby list.
    let lobby = Kind::Lobby.facility().width;
    for floor in 23..=30 {
        for x in 100..220 {
            if floor < 30 {
                must(tower.place(Kind::Floor, floor, x));
            } else if x % lobby == 0 {
                must(tower.place(Kind::Lobby, floor, x));
            }
        }
    }
    assert_floor_lists(&tower);
    assert_eq!(tower.dispatch_floors().lobbies, vec![1, 15, 30]);
    // A stop toggle keeps the unit count and moves the served floors.
    let standard = tower.transports[0].id;
    let count = tower.units.len();
    assert!(tower.set_stop(standard, 7, false));
    assert_eq!(tower.units.len(), count);
    assert_floor_lists(&tower);
    assert!(!tower.dispatch_floors().served.contains(&7));
    assert!(tower.set_stop(standard, 7, true));
    assert_floor_lists(&tower);
    assert!(tower.dispatch_floors().served.contains(&7));
}

#[test]
fn reindex_resets_the_floor_lists() {
    let mut tower = scenario();
    assert!(tower.dispatch_floors().served.contains(&7));
    // Pin the reset itself: a stop list assigned wholesale, as a load does,
    // at the same unit count and revision, still reads the memo's old answer
    // until `reindex` resets it.
    let (count, revision) = (tower.units.len(), tower.revision);
    tower.transports[0].skip_floors = Some(vec![7.0]);
    assert_eq!((tower.units.len(), tower.revision), (count, revision));
    assert!(tower.dispatch_floors().served.contains(&7));
    tower.reindex();
    assert_floor_lists(&tower);
    assert!(!tower.dispatch_floors().served.contains(&7));
}

#[test]
fn a_reload_rebuilds_the_floor_lists() {
    let mut sim = Simulation::new_game(11, GameMode::Modern);
    sim.tower = scenario();
    assert_floor_lists(&sim.tower);
    let loaded = crate::load::deserialize(&sim.serialize()).expect("the save loads");
    assert_floor_lists(&loaded.tower);
    assert_eq!(
        loaded.tower.dispatch_floors().served,
        sim.tower.dispatch_floors().served
    );
}

#[test]
fn a_removed_shaft_loses_its_dwell_timers() {
    let mut tower = scenario();
    let mut d = ElevatorDispatch::new();
    d.move_cars(&mut tower, 2.0, &ElevatorCalls::default(), 9, false);
    let gone = tower.transports[0].id;
    assert!(d.car_dwell.contains_key(&gone));
    assert!(tower.remove_transport(gone).is_some());
    d.accumulate(&tower, 2.0, 1.0);
    assert!(!d.car_dwell.contains_key(&gone));
    assert_eq!(
        d.car_dwell.len(),
        tower
            .transports
            .iter()
            .filter(|t| t.kind.is_elevator())
            .count()
    );
}
