//! Port of the retired TypeScript `src/engine/crowd/shaftBanks.ts`.

use super::fasthash::FastMap;
use super::{Crowd, Route};
use crate::facilities::Kind;
use crate::schedule::Schedule;
use crate::tower::Tower;

/// The interchangeable shafts for each leg: the shafts of one kind that
/// stop at the same landing segments at both ends, in id order. Each
/// distinct landing list gets a number once per shaft stop, so a leg's key
/// is the kind and two numbers instead of two cloned lists hashed whole.
#[derive(Default)]
pub struct Banks {
    lists: FastMap<Vec<i64>, u32>,
    index: FastMap<(Kind, u32, u32), usize>,
    /// Each bank's key, by its place in `shafts`.
    keys: Vec<(Kind, u32, u32)>,
    shafts: Vec<Vec<i64>>,
}

impl Banks {
    /// The bank of `kind` shafts from the landing `from` to `to`.
    fn bank(&self, kind: Kind, from: &Vec<i64>, to: &Vec<i64>) -> Option<&[i64]> {
        let key = (kind, *self.lists.get(from)?, *self.lists.get(to)?);
        Some(&self.shafts[*self.index.get(&key)?])
    }

    /// Every leg's (kind, from, to) and its bank, for tests.
    #[cfg(test)]
    fn entries(&self) -> Vec<((Kind, Vec<i64>, Vec<i64>), &[i64])> {
        let mut list = vec![Vec::new(); self.lists.len()];
        for (segs, &n) in self.lists.sorted() {
            list[n as usize] = segs.clone();
        }
        let key =
            |&(k, a, b): &(Kind, u32, u32)| (k, list[a as usize].clone(), list[b as usize].clone());
        self.keys
            .iter()
            .map(key)
            .zip(self.shafts.iter().map(Vec::as_slice))
            .collect()
    }
}

fn shaft_banks<'a>(crowd: &'a mut Crowd, tower: &Tower) -> &'a Banks {
    let fresh = !matches!(&crowd.shaft_banks, Some((rev, _)) if *rev == tower.revision);
    if fresh {
        let mut banks = Banks::default();
        for t in &tower.transports {
            let stops = tower.stops_of(t);
            // Each stop's landing segments once per shaft, not once per
            // stop pair: the pair loop below is O(stops^2), and
            // `landing_segs` allocates and reads the floor's runs (A18 in
            // #1158).
            let ids: Vec<u32> = stops
                .iter()
                .map(|&f| {
                    let next = banks.lists.len() as u32;
                    *banks
                        .lists
                        .get_or_insert_with(tower.landing_segs(t, f), || next)
                })
                .collect();
            for (a, &from) in stops.iter().enumerate() {
                for (b, &to) in stops.iter().enumerate() {
                    if to == from {
                        continue;
                    }
                    let key = (t.kind, ids[a], ids[b]);
                    let next = banks.shafts.len();
                    let k = *banks.index.get_or_insert_with(key, || next);
                    if k == next {
                        banks.keys.push(key);
                        banks.shafts.push(Vec::new());
                    }
                    banks.shafts[k].push(t.id);
                }
            }
        }
        for bank in banks.shafts.iter_mut() {
            bank.sort();
        }
        crowd.shaft_banks = Some((tower.revision, banks));
    }
    &crowd.shaft_banks.as_ref().unwrap().1
}

/// The cars `id` runs this step: every car, or the ones its schedule keeps
/// on shift at the crowd's hour. Stairs and escalators count as one.
///
/// A shaft on Auto counts its whole fleet, as the Modern router's
/// `stand_down` does: it runs every car once anyone waits at its stops
/// (`Schedule::cars_while_anyone_waits`), so the cars it parks while its
/// stops are empty come out for the riders this draw sends. Shared by its
/// row, or by the cars it parked, an Auto shaft beside a busy twin took a
/// one-car share, nobody stood at its stops, and its cars stayed parked.
fn on_shift_cars(crowd: &Crowd, tower: &Tower, id: i64) -> i64 {
    let Some(t) = tower.get_transport(id) else {
        return 0;
    };
    if !t.kind.is_elevator() {
        return 1;
    }
    if t.schedule.as_ref().is_some_and(|s| s.auto_tune) {
        return t.cars;
    }
    match crowd.hour {
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
        let bank = shaft_banks(crowd, tower).bank(chosen.kind, &from, &to);
        let Some(bank) = bank.filter(|b| b.len() > 1).map(<[i64]>::to_vec) else {
            continue;
        };
        r.shafts[i] = bank[pick_in_bank(crowd, tower, &bank)];
    }
    r
}

#[cfg(test)]
#[path = "banks_tests.rs"]
mod tests;
