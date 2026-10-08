//! Port of `crowd/shaftBanks.ts`.

use std::collections::HashMap;

use super::{Crowd, Route};
use crate::facilities::Kind;
use crate::tower::Tower;

type Banks = HashMap<(Kind, Vec<i64>, Vec<i64>), Vec<i64>>;

fn shaft_banks<'a>(crowd: &'a mut Crowd, tower: &Tower) -> &'a Banks {
    let fresh = !matches!(&crowd.shaft_banks, Some((rev, _)) if *rev == tower.revision);
    if fresh {
        let mut banks: Banks = HashMap::new();
        for t in &tower.transports {
            let stops = tower.stops_of(t);
            for &from in &stops {
                for &to in &stops {
                    if to == from {
                        continue;
                    }
                    let key = (t.kind, tower.landing_segs(t, from), tower.landing_segs(t, to));
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

/// Re-pick which shaft of an equivalent bank carries each leg (one rng draw
/// per leg with a real bank).
pub fn balance_shafts(crowd: &mut Crowd, tower: &Tower, mut r: Route) -> Route {
    for i in 0..r.shafts.len() {
        let Some(chosen) = tower.get_transport(r.shafts[i]) else { continue };
        let from = tower.landing_segs(chosen, r.floors[i]);
        let to = tower.landing_segs(chosen, r.floors[i + 1]);
        let key = (chosen.kind, from, to);
        let bank = shaft_banks(crowd, tower).get(&key).cloned();
        let Some(bank) = bank else { continue };
        if bank.len() <= 1 {
            continue;
        }
        r.shafts[i] = bank[crowd.rng.int(0, bank.len() as i64 - 1) as usize];
    }
    r
}
