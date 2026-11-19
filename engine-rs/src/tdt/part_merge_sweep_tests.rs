//! The sweep in `components` (#2086) finds the buildings the pairwise loop
//! it replaced found, on random parts packed tight enough to touch, overlap
//! and stack, and it merges a forged file's worth of theater pieces.

use super::*;

/// The loop `components` ran before #2086: every pair of parts.
fn pairwise<'a>(kind: Kind, stories: i64, items: &[&'a PartRecord]) -> Vec<Vec<&'a PartRecord>> {
    let mut parent: Vec<usize> = (0..items.len()).collect();
    for i in 0..items.len() {
        for j in i + 1..items.len() {
            if same_building(kind, stories, items[i], items[j]) {
                let ra = find(&mut parent, i);
                let rb = find(&mut parent, j);
                if ra != rb {
                    parent[ra] = rb;
                }
            }
        }
    }
    let mut groups: IndexMap<usize, Vec<&PartRecord>> = IndexMap::new();
    for (i, item) in items.iter().enumerate() {
        let root = find(&mut parent, i);
        groups.entry(root).or_default().push(item);
    }
    groups.into_values().collect()
}

#[test]
fn the_sweep_finds_the_buildings_every_pair_found() {
    let mut seed: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut next = |n: u64| {
        seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (seed >> 33) % n
    };
    let families = [
        (Kind::Cinema, [34, 35, 18, 19]),
        (Kind::Recycling, [20, 21, 20, 21]),
        (Kind::Metro, [30, 31, 32, 30]),
        (Kind::WeddingHall, [40, 41, 42, 43]),
    ];
    let mut joined = 0;
    for round in 0..3_000 {
        let (kind, types) = families[round % families.len()];
        let n = 1 + next(40) as usize;
        let floors = 1 + next(8) as i64;
        let parts: Vec<PartRecord> = (0..n)
            .map(|_| {
                let left = next(30) as i64;
                // One round in ten carries a part the floor walk never makes
                // (no width, or inverted), which takes the pairwise path.
                let width = if round % 10 == 0 {
                    next(12) as i64 - 3
                } else {
                    1 + next(10) as i64
                };
                PartRecord {
                    kind,
                    type_id: types[next(4) as usize],
                    floor: next(floors as u64) as i64 - 2,
                    left,
                    right: left + width,
                    construction: next(5) == 0,
                }
            })
            .collect();
        let items: Vec<&PartRecord> = parts.iter().collect();
        let stories = family_stories(kind);
        let want = pairwise(kind, stories, &items);
        assert_eq!(components(kind, stories, &items), want, "round {round}");
        assert_eq!(
            merge_parts(&parts).len(),
            merge_count(&parts),
            "round {round}"
        );
        joined += items.len() - want.len();
    }
    // The rounds join parts often, so the comparison means something.
    assert!(joined > 10_000, "{joined}");
}

/// `merge_parts` over the pairwise loop, for the count it should give.
fn merge_count(parts: &[PartRecord]) -> usize {
    let mut by_family: IndexMap<Kind, Vec<&PartRecord>> = IndexMap::new();
    for p in parts {
        by_family.entry(p.kind).or_default().push(p);
    }
    let mut count = 0;
    for (kind, records) in by_family {
        let stories = family_stories(kind);
        for mut cluster in pairwise(kind, stories, &records) {
            cluster.sort_by_key(|p| p.floor);
            let mut group: Vec<&PartRecord> = vec![];
            for p in cluster {
                if !group.is_empty() && p.floor - group[0].floor >= stories {
                    count += pairwise(kind, stories, &group).len();
                    group.clear();
                }
                group.push(p);
            }
            if !group.is_empty() {
                count += pairwise(kind, stories, &group).len();
            }
        }
    }
    count
}

/// A forged file can fill 120 floors with 256 theater pieces each (#2086):
/// 128 theaters a floor pair, 7,680 in all, merge without comparing every
/// pair of the 30,720 pieces.
#[test]
fn a_forged_files_worth_of_theater_pieces_merges() {
    let mut parts = vec![];
    for pair in 0..60 {
        for t in 0..128 {
            let left = t * 31;
            for (floor, screen, auditorium) in [(2 * pair, 35, 19), (2 * pair + 1, 34, 18)] {
                parts.push(part(screen, floor, left, left + 7));
                parts.push(part(auditorium, floor, left + 7, left + 31));
            }
        }
    }
    assert_eq!(parts.len(), 30_720);
    let merged = merge_parts(&parts);
    assert_eq!(merged.len(), 7_680);
    assert!(merged
        .iter()
        .all(|m| m.top_floor == m.floor + 1 && m.right - m.left == 31));
}

fn part(type_id: i64, floor: i64, left: i64, right: i64) -> PartRecord {
    PartRecord {
        kind: Kind::Cinema,
        type_id,
        floor,
        left,
        right,
        construction: false,
    }
}
