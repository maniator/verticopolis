//! Tests for `Demand::next_stop`: the bit-set search finds the stop the
//! TypeScript's full scan found, across word boundaries and empty words
//! (#1143 item 5, A20 in #1158).

use std::collections::BTreeSet;

use super::super::*;
use super::Lcg;

/// The TypeScript's `calls` and `claimed` sets as flag bits, for the scan.
const CALL: u8 = 1;
const CLAIMED: u8 = 2;

/// The scan `Demand::next_stop` replaced: every stop, first strict minimum.
fn scan_every_stop(
    stops: &[i64],
    flags: &[u8],
    pos: f64,
    dir: i64,
    cab: Option<&BTreeSet<i64>>,
) -> Option<i64> {
    let mut best: Option<i64> = None;
    let mut best_dist = f64::INFINITY;
    for (k, &fl) in stops.iter().enumerate() {
        let f = fl as f64;
        if (dir > 0 && f <= pos + 0.05) || (dir < 0 && f >= pos - 0.05) {
            continue;
        }
        if flags[k] & (CALL | CLAIMED) != CALL && !cab.is_some_and(|c| c.contains(&fl)) {
            continue;
        }
        let dist = (f - pos).abs();
        if dist < best_dist {
            best_dist = dist;
            best = Some(fl);
        }
    }
    best
}

/// The bit-set search over the same stops, flags and cab set.
fn search(
    stops: &[i64],
    flags: &[u8],
    pos: f64,
    dir: i64,
    cab: Option<&BTreeSet<i64>>,
) -> Option<i64> {
    let words = stops.len().div_ceil(WORD);
    let (mut calls, mut claimed) = (vec![0; words], vec![0; words]);
    for (k, f) in flags.iter().enumerate() {
        if f & CALL != 0 {
            set_bit(&mut calls, k);
        }
        if f & CLAIMED != 0 {
            set_bit(&mut claimed, k);
        }
    }
    let mut cab_stops = Vec::new();
    let cab = cab
        .filter(|c| !c.is_empty())
        .map(|c| fill_cab_stops(stops, c, &mut cab_stops));
    let demand = Demand {
        stops,
        calls: &calls,
        claimed: &claimed,
        cab,
    };
    demand.next_stop(pos, dir).map(|k| stops[k])
}

#[test]
fn the_stop_search_finds_what_the_full_scan_found() {
    let mut rng = Lcg(0x1143_5005);
    // Far positions round distances together; the scan kept the lowest floor.
    let odd = [f64::NAN, f64::INFINITY, -f64::INFINITY, 1e300, -1e300, 1e17];
    let mut found = 0;
    // Stop lists by the number of words they take, one to four.
    let mut by_words = [0; 4];
    for case in 0..20_000 {
        // Every fifth list runs unbroken for a length at or beside a word
        // boundary; the rest skip floors at random over up to 300 floors.
        let bottom = rng.next(12) as i64 - 10;
        let (len, keep) = if case % 5 == 0 {
            let edges = [1, 63, 64, 65, 127, 128, 129, 192, 193, 256];
            (edges[rng.next(edges.len() as u64) as usize], 1)
        } else {
            (rng.next(300) as usize + 1, 3)
        };
        let mut stops: Vec<i64> = (bottom..bottom + len as i64)
            .filter(|_| keep == 1 || rng.next(keep) > 0)
            .collect();
        if stops.is_empty() {
            stops.push(bottom);
        }
        by_words[stops.len().div_ceil(WORD) - 1] += 1;
        let flags: Vec<u8> = stops.iter().map(|_| rng.next(4) as u8).collect();
        // Cab floors, some of them off the shaft's stops.
        let cab: BTreeSet<i64> = (bottom - 3..bottom + len as i64 + 3)
            .filter(|_| rng.next(6) == 0)
            .collect();
        let cab = (rng.next(2) == 0).then_some(&cab);
        let pos = if case % 50 == 0 {
            odd[rng.next(odd.len() as u64) as usize]
        } else {
            // On a stop, a hair either side of one, or anywhere in the span.
            let fl = stops[rng.next(stops.len() as u64) as usize] as f64;
            match rng.next(4) {
                0 => fl,
                1 => fl + 0.05,
                2 => fl - 0.05 + rng.next(3) as f64 * 0.025,
                _ => bottom as f64 - 2.0 + rng.next(10 * len as u64 + 40) as f64 * 0.1,
            }
        };
        for dir in [1, -1, 2] {
            let searched = search(&stops, &flags, pos, dir, cab);
            assert_eq!(
                searched,
                scan_every_stop(&stops, &flags, pos, dir, cab),
                "case {case}, pos {pos}, dir {dir}"
            );
            found += usize::from(searched.is_some());
        }
    }
    assert!(found > 10_000);
    assert!(by_words.iter().all(|&n| n > 500), "{by_words:?}");
}

/// One answering stop at the far end of a long shaft, so every word between
/// the car and it is empty and the search has to cross them.
#[test]
fn the_stop_search_crosses_empty_words() {
    for n in [64usize, 65, 127, 128, 129, 200, 256] {
        let stops: Vec<i64> = (0..n as i64).collect();
        for (hit, pos, dir) in [(0, n as f64, -1), (n - 1, -1.0, 1)] {
            for cab in [false, true] {
                let mut flags = vec![0u8; n];
                let cab_set: BTreeSet<i64> = [hit as i64].into();
                if !cab {
                    flags[hit] = CALL;
                }
                let cab = cab.then_some(&cab_set);
                let found = search(&stops, &flags, pos, dir, cab);
                assert_eq!(found, Some(hit as i64), "n {n}, dir {dir}");
                assert_eq!(found, scan_every_stop(&stops, &flags, pos, dir, cab));
                // Claimed, the call no longer answers; the cab stop still does.
                flags[hit] |= CLAIMED;
                let claimed = search(&stops, &flags, pos, dir, cab);
                assert_eq!(claimed, scan_every_stop(&stops, &flags, pos, dir, cab));
                assert_eq!(claimed.is_some(), cab.is_some(), "n {n}, dir {dir}");
            }
        }
    }
}
