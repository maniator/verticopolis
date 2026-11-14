//! Port of `crowd/shaftBanks.ts`.

use std::collections::HashMap;

use super::{Crowd, Route};
use crate::facilities::Kind;
use crate::schedule::Schedule;
use crate::tower::Tower;

type Banks = HashMap<(Kind, Vec<i64>, Vec<i64>), Vec<i64>>;

fn shaft_banks<'a>(crowd: &'a mut Crowd, tower: &Tower) -> &'a Banks {
    let fresh = !matches!(&crowd.shaft_banks, Some((rev, _)) if *rev == tower.revision);
    if fresh {
        let mut banks: Banks = HashMap::new();
        for t in &tower.transports {
            let stops = tower.stops_of(t);
            // Each stop's landing segments once per shaft, not once per
            // stop pair: the pair loop below is O(stops^2), and
            // `landing_segs` allocates and reads the floor's runs (A18 in
            // #1158).
            let segs: Vec<Vec<i64>> = stops.iter().map(|&f| tower.landing_segs(t, f)).collect();
            for (a, &from) in stops.iter().enumerate() {
                for (b, &to) in stops.iter().enumerate() {
                    if to == from {
                        continue;
                    }
                    let key = (t.kind, segs[a].clone(), segs[b].clone());
                    banks.entry(key).or_default().push(t.id);
                }
            }
        }
        for bank in banks.values_mut() {
            bank.sort();
        }
        crowd.shaft_banks = Some((tower.revision, banks));
    }
    &crowd.shaft_banks.as_ref().unwrap().1
}

/// The cars `id` runs this step: every car, or the ones its schedule keeps
/// on shift at the crowd's hour. Stairs and escalators count as one.
fn on_shift_cars(crowd: &Crowd, tower: &Tower, id: i64) -> i64 {
    let Some(t) = tower.get_transport(id) else {
        return 0;
    };
    match crowd.hour {
        _ if !t.kind.is_elevator() => 1,
        Some(hour) => Schedule::active_car_count(t.schedule.as_ref(), crowd.weekend, hour, t.cars),
        None => t.cars,
    }
}

/// The index into `bank` one draw picks, each shaft as likely as the cars
/// it runs: a shaft its schedule has cut to one car carries a share fit
/// for one car, not the same share as an eight-car twin beside it. With
/// every shaft running alike (or none running), each is equally likely,
/// with the same draw as before.
fn pick_in_bank(crowd: &mut Crowd, tower: &Tower, bank: &[i64]) -> usize {
    // Two passes over the bank rather than a list of its weights, so a
    // route allocates nothing more here.
    let first = on_shift_cars(crowd, tower, bank[0]);
    let mut total = 0;
    let mut alike = true;
    for &id in bank {
        let w = on_shift_cars(crowd, tower, id);
        total += w;
        alike &= w == first;
    }
    if total <= 0 || alike {
        return crowd.rng.int(0, bank.len() as i64 - 1) as usize;
    }
    let mut r = crowd.rng.int(0, total - 1);
    for (k, &id) in bank.iter().enumerate() {
        let w = on_shift_cars(crowd, tower, id);
        if r < w {
            return k;
        }
        r -= w;
    }
    bank.len() - 1
}

/// Re-pick which shaft of an equivalent bank carries each leg (one rng draw
/// per leg with a real bank), by the cars each runs (`pick_in_bank`).
pub fn balance_shafts(crowd: &mut Crowd, tower: &Tower, mut r: Route) -> Route {
    for i in 0..r.shafts.len() {
        let Some(chosen) = tower.get_transport(r.shafts[i]) else {
            continue;
        };
        let from = tower.landing_segs(chosen, r.floors[i]);
        let to = tower.landing_segs(chosen, r.floors[i + 1]);
        let key = (chosen.kind, from, to);
        let bank = shaft_banks(crowd, tower).get(&key).cloned();
        let Some(bank) = bank else { continue };
        if bank.len() <= 1 {
            continue;
        }
        r.shafts[i] = bank[pick_in_bank(crowd, tower, &bank)];
    }
    r
}

#[cfg(test)]
#[path = "banks_tests.rs"]
mod tests;
