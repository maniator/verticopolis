//! The waits riders really had at each Modern elevator stop, remembered for
//! a few game minutes. The router's model of a line (`expected_time::cost_of`)
//! counts the people standing in it and the seats the cars bring; a stop
//! the cars reach already full keeps people far longer than that, and the
//! model only learns it from whoever is still standing there. Each boarding
//! leaves its wait here, the memory fades over the next eight game minutes, and the
//! router reads it as the line's longest wait, so it takes the larger of
//! the model and what riders saw. Saved as `waitsSeen` (`router_save.rs`).

use super::super::fasthash::FastMap;
use super::super::{Crowd, CROWD_SECONDS_PER_MINUTE};
use super::Line;
use crate::tower::Tower;

/// How much of a stop's remembered wait one boarding moves to its own.
const SHARE: f64 = 0.5;

/// How long a remembered wait takes to fade to nothing: eight game minutes.
/// A longer memory keeps riders away from a stop after its line clears; over
/// three days on three Modern towers and fourteen seeds, an hour's memory
/// raised the samples of riders waiting over half an hour by up to 2.5%, and
/// eight minutes lowered them on every tower.
pub const FADE_SECONDS: f64 = 8.0 * CROWD_SECONDS_PER_MINUTE;

/// The most stops a save restores: more than every stop of a full pool of
/// shafts the whole height of the tower.
pub const MAX_SAVED_STOPS: usize = 8_192;

/// One stop's remembered wait (crowd seconds) and how much of it fades
/// each crowd second.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Seen {
    pub wait: f64,
    pub fade: f64,
}

/// The remembered waits, by (shaft, floor), ascending.
#[derive(Clone, Debug, Default)]
pub struct WaitsSeen {
    stops: Vec<((i64, i64), Seen)>,
    /// Where the last boarding's stop was in `stops`: riders board a car in
    /// a run at one stop, so the next is usually the same one. Only a hint,
    /// checked against the key before use; never saved or compared.
    hint: usize,
}

impl PartialEq for WaitsSeen {
    fn eq(&self, other: &Self) -> bool {
        self.stops == other.stops
    }
}

/// Someone (`crowd.people[i]`) just boarded a car: an elevator's, when
/// `elevator`. A Modern tower remembers their wait at that stop.
pub fn note_boarding(crowd: &mut Crowd, tower: &Tower, elevator: bool, i: usize) {
    let p = &crowd.people[i];
    if let (true, true, Some(shaft)) = (elevator, tower.mode.routes_by_expected_time(), p.shaft_id)
    {
        let (floor, waited) = (p.floor, p.wait);
        crowd.waits_seen.boarded(shaft, floor, waited);
    }
}

/// Hands the crowd the motion pass's `counted` lines (`keep_lines`), each
/// stop's remembered wait faded by the pass's `dt` and folded in first.
pub fn keep_lines(crowd: &mut Crowd, mut counted: FastMap<(i64, i64), Line>, dt: f64) {
    crowd.waits_seen.fold(dt, &mut counted);
    super::super::expected_time::keep_lines(crowd, counted);
}

impl WaitsSeen {
    /// Someone boarded at `shaft` on `floor` after waiting `waited` crowd
    /// seconds. The stop's memory moves a share of the way to that wait and
    /// fades from there over the next `FADE_SECONDS`.
    pub fn boarded(&mut self, shaft: i64, floor: i64, waited: f64) {
        let key = (shaft, floor);
        let at = match self.stops.get(self.hint) {
            Some(e) if e.0 == key => Ok(self.hint),
            _ => self.stops.binary_search_by_key(&key, |e| e.0),
        };
        match at {
            Ok(i) => {
                self.hint = i;
                let seen = &mut self.stops[i].1;
                seen.wait += (waited - seen.wait) * SHARE;
                seen.fade = seen.wait / FADE_SECONDS;
            }
            Err(i) if waited > 0.0 => {
                let seen = Seen {
                    wait: waited,
                    fade: waited / FADE_SECONDS,
                };
                self.stops.insert(i, (key, seen));
                self.hint = i;
            }
            Err(_) => {}
        }
    }

    /// Fades every memory by `dt` crowd seconds, forgets the ones gone, and
    /// raises the longest wait of each stop's line in `lines` to what is
    /// left, adding the line when nobody stands in it.
    pub fn fold(&mut self, dt: f64, lines: &mut FastMap<(i64, i64), Line>) {
        self.stops.retain_mut(|(key, seen)| {
            seen.wait -= seen.fade * dt;
            if seen.wait <= 0.0 {
                return false;
            }
            let line = lines.get_or_insert_with(*key, Line::default);
            line.oldest = line.oldest.max(seen.wait);
            true
        });
    }

    pub fn is_empty(&self) -> bool {
        self.stops.is_empty()
    }

    /// The memories as save rows, `[shaft, floor, wait, fade]`, ascending.
    pub fn rows(&self) -> Vec<(i64, i64, f64, f64)> {
        (self.stops.iter())
            .map(|&((shaft, floor), s)| (shaft, floor, s.wait, s.fade))
            .collect()
    }

    /// Puts back one saved memory. A memory already gone, or a stop already
    /// remembered, or one that would never fade, is skipped.
    pub fn restore(&mut self, shaft: i64, floor: i64, seen: Seen) {
        let ok = seen.wait.is_finite() && seen.fade.is_finite();
        if !(ok && seen.wait > 0.0 && seen.fade > 0.0) {
            return;
        }
        let key = (shaft, floor);
        if let Err(i) = self.stops.binary_search_by_key(&key, |e| e.0) {
            self.stops.insert(i, (key, seen));
        }
    }
}
