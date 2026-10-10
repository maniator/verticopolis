//! Merge the per-floor parts a multi-story unit is stored as back into whole
//! units (`tdtPartMerge.ts`): union-find over a tower's few dozen parts,
//! split by floor window and by horizontal connectivity.

use indexmap::IndexMap;

use super::tables::{family_stories, is_screen_part};
use crate::facilities::Kind;

/// A multi-story part collected during the floor walk, pre-merge.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PartRecord {
    pub kind: Kind,
    pub type_id: i64,
    pub floor: i64,
    pub left: i64,
    pub right: i64,
    pub construction: bool,
}

/// A merged multi-story unit: the cluster's base floor, top floor and
/// horizontal union.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MergedPart {
    pub kind: Kind,
    pub floor: i64,
    pub top_floor: i64,
    pub left: i64,
    pub right: i64,
    pub construction: bool,
}

/// Path-halving find, exactly as the TypeScript closure walks it.
fn find(parent: &mut [usize], mut i: usize) -> usize {
    while parent[i] != i {
        parent[i] = parent[parent[i]];
        i = parent[i];
    }
    i
}

/// True when two parts can belong to the same building.
fn same_building(kind: Kind, stories: i64, a: &PartRecord, b: &PartRecord) -> bool {
    let overlaps = a.left < b.right && b.left < a.right;
    let within_stories = (a.floor - b.floor).abs() < stories;
    let screen_touch = kind == Kind::Cinema
        && a.floor == b.floor
        && (a.right == b.left || b.right == a.left)
        && is_screen_part(a.type_id) != is_screen_part(b.type_id);
    (overlaps && within_stories) || screen_touch
}

/// Group `items` by union-find root, in order of first appearance.
fn components<'a>(kind: Kind, stories: i64, items: &[&'a PartRecord]) -> Vec<Vec<&'a PartRecord>> {
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

/// `mergeParts`.
pub fn merge_parts(parts: &[PartRecord]) -> Vec<MergedPart> {
    let mut by_family: IndexMap<Kind, Vec<&PartRecord>> = IndexMap::new();
    for p in parts {
        by_family.entry(p.kind).or_default().push(p);
    }
    let mut merged = vec![];
    for (kind, records) in by_family {
        let stories = family_stories(kind);
        for mut cluster in components(kind, stories, &records) {
            cluster.sort_by_key(|p| p.floor);
            let mut group: Vec<&PartRecord> = vec![];
            let flush = |group: &mut Vec<&PartRecord>, merged: &mut Vec<MergedPart>| {
                if group.is_empty() {
                    return;
                }
                for component in components(kind, stories, group) {
                    let first = component[0];
                    let mut m = MergedPart {
                        kind,
                        floor: first.floor,
                        top_floor: first.floor,
                        left: first.left,
                        right: first.right,
                        construction: first.construction,
                    };
                    for p in component {
                        m.left = m.left.min(p.left);
                        m.right = m.right.max(p.right);
                        m.floor = m.floor.min(p.floor);
                        m.top_floor = m.top_floor.max(p.floor);
                        m.construction = m.construction || p.construction;
                    }
                    merged.push(m);
                }
                group.clear();
            };
            for p in cluster {
                if !group.is_empty() && p.floor - group[0].floor >= stories {
                    flush(&mut group, &mut merged);
                }
                group.push(p);
            }
            flush(&mut group, &mut merged);
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part(kind: Kind, type_id: i64, floor: i64, left: i64, right: i64) -> PartRecord {
        PartRecord {
            kind,
            type_id,
            floor,
            left,
            right,
            construction: false,
        }
    }

    #[test]
    fn flush_neighbors_chained_through_a_building_below_stay_separate() {
        let parts = vec![
            part(Kind::Recycling, 21, -3, 107, 127),
            part(Kind::Recycling, 20, -2, 107, 127),
            part(Kind::Recycling, 21, -1, 92, 112),
            part(Kind::Recycling, 21, -1, 112, 132),
            part(Kind::Recycling, 20, 0, 92, 112),
            part(Kind::Recycling, 20, 0, 112, 132),
        ];
        let mut got: Vec<(i64, i64)> = merge_parts(&parts)
            .iter()
            .map(|m| (m.left, m.floor))
            .collect();
        got.sort();
        assert_eq!(got, vec![(92, -1), (107, -3), (112, -1)]);
    }

    #[test]
    fn a_theatre_merges_its_screen_halves() {
        let parts = vec![
            part(Kind::Cinema, 19, 11, 100, 127),
            part(Kind::Cinema, 35, 11, 127, 131),
            part(Kind::Cinema, 18, 12, 100, 127),
            part(Kind::Cinema, 34, 12, 127, 131),
        ];
        let got = merge_parts(&parts);
        assert_eq!(got.len(), 1);
        assert_eq!(
            (got[0].floor, got[0].top_floor, got[0].left, got[0].right),
            (11, 12, 100, 131)
        );
    }
}
