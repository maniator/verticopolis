//! Load-time people: how many rooms of a kind hold the people the file counts.

use std::collections::HashMap;

use super::OutUnit;
use crate::crowd::fasthash::FastMap;
use crate::economy::visitors::{
    counts_daily_visitors, counts_set_audience, set_audience, NEW_FILM_DRAW,
};
use crate::facilities::Kind;
use crate::tdt::format::{population_class, TDT_FLOOR_OFFSET};
use crate::tdt::format::{POP_CONDO, POP_OFFICE, TDT_POPULATION_CLASSES};
use crate::tdt::import_report::ImportCounts;
use crate::tdt::tables::part_family;
use crate::tdt::types::{TdtFloor, TdtTower};

/// The classes whose people the finance block counts and the load seeds: the
/// kind, its slot in the block and the state a room with people in it takes.
/// Hotels keep the states their own flags decode to, since a guest count cannot
/// say which double room holds one guest or two. Shops, restaurants and fast
/// food are seeded from their retail rows instead (`seed_visitors`), and
/// party halls and theatres from their own records instead (`seed_audiences`).
const SEEDED_CLASSES: [(Kind, usize, &str); 2] = [
    (Kind::Office, POP_OFFICE, "occupied"),
    (Kind::Condo, POP_CONDO, "occupied"),
];

fn count_in_state(units: &[OutUnit], of_kind: fn(Kind) -> bool, state: &str) -> i64 {
    units
        .iter()
        .filter(|u| of_kind(u.kind) && u.state == state)
        .count() as i64
}

/// Place the people the finance block counts for each seeded class and tally
/// them into the import report's counts.
pub(super) fn seed_from_finance(
    mut units: Vec<OutUnit>,
    pops: &[i64; TDT_POPULATION_CLASSES],
    counts: &mut ImportCounts,
) -> Vec<OutUnit> {
    let mut seeded = 0;
    for (kind, class, lived_in) in SEEDED_CLASSES {
        let rooms;
        (units, rooms) = seed_residents(units, kind, pops[class], lived_in);
        seeded += rooms * kind.facility().population.max(1);
        match kind {
            Kind::Office => counts.occupied_offices = rooms,
            Kind::Condo => counts.sold_condos = rooms,
            _ => {}
        }
    }
    counts.residents_seeded = seeded;
    counts.hotel_asleep = count_in_state(&units, Kind::is_hotel, "asleep");
    counts.hotel_dirty = count_in_state(&units, Kind::is_hotel, "dirty");
    units
}

/// Set how many rooms of `kind` hold people from the count the file gives for
/// the class, since a room's status byte is an activity state and reads some
/// occupied rooms as empty and the reverse. Rooms already in the `lived_in`
/// state stay in it first, then rooms the file shows were lived in. Returns the
/// rooms and how many now hold people.
fn seed_residents(
    units: Vec<OutUnit>,
    kind: Kind,
    people: i64,
    lived_in: &'static str,
) -> (Vec<OutUnit>, i64) {
    let per_room = kind.facility().population.max(1);
    let mut ranked: Vec<usize> = (0..units.len())
        .filter(|&i| units[i].kind == kind && units[i].state != "construction")
        .collect();
    ranked.sort_by_key(|&i| (units[i].state != lived_in, !units[i].ever_occupied));
    let target = (people / per_room).min(ranked.len() as i64);
    let held_now = ranked
        .iter()
        .filter(|&&i| units[i].state == lived_in)
        .count() as i64;
    if target == held_now {
        return (units, target);
    }
    let rank_of: HashMap<usize, usize> = ranked.iter().enumerate().map(|(r, &i)| (i, r)).collect();
    let seeded = units
        .into_iter()
        .enumerate()
        .map(|(i, unit)| match rank_of.get(&i) {
            Some(&rank) if (rank as i64) < target => OutUnit {
                state: lived_in,
                occupants: per_room,
                ever_occupied: true,
                ..unit
            },
            // A room the file's status marked as holding people but whose people
            // the finance block does not count goes back to never having been
            // lived in, which is all an exported vacant room can say.
            Some(_) => OutUnit {
                state: "empty",
                occupants: 0,
                ever_occupied: unit.ever_occupied && unit.state != lived_in,
                ..unit
            },
            None => unit,
        })
        .collect();
    (seeded, target)
}

/// Give each shop, fast food and restaurant the visitors its retail row says
/// it served yesterday, the census SimTower shows for it (#1500). A row names
/// its room by floor and a slot the floor's index map turns into a tenant; the
/// unit is the room of a counted kind on that floor that covers the tenant.
pub(super) fn seed_visitors(units: &mut [serde_json::Value], tdt: &TdtTower) {
    // One pass over the units: each counted venue's floor and span, keyed by
    // floor, so a row looks at its own floor's few venues and never at the
    // tower's thousands of floor tiles.
    let mut venues: FastMap<i64, Vec<(usize, i64, i64)>> = FastMap::default();
    for (i, u) in units.iter().enumerate() {
        let counted = u
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .and_then(Kind::parse)
            .is_some_and(counts_daily_visitors);
        if !counted {
            continue;
        }
        let field = |k: &str| u.get(k).and_then(serde_json::Value::as_i64);
        if let (Some(f), Some(x), Some(w)) = (field("floor"), field("x"), field("width")) {
            venues.get_or_insert_with(f, Vec::new).push((i, x, x + w));
        }
    }
    let mut floors: FastMap<i64, &TdtFloor> = FastMap::default();
    for f in &tdt.floors {
        // The first floor with an index wins, as a search would find it.
        floors.get_or_insert_with(f.index, || f);
    }
    for row in &tdt.tail.retail {
        // A row that served nobody seeds nothing: the venue counts 0 either
        // way, and our own exporter writes zero rows over a zero remap that
        // would otherwise pin a 0 on the floor's first room.
        if row.served == 0 {
            continue;
        }
        let Some(floor) = floors.get(&i64::from(row.floor)) else {
            continue;
        };
        let Some(tenant) = floor
            .index_map
            .get(usize::from(row.slot))
            .and_then(|&t| floor.tenants.get(usize::from(t)))
        else {
            continue;
        };
        let Some(on_floor) = venues.get(&(floor.index - TDT_FLOOR_OFFSET)) else {
            continue;
        };
        let hit = on_floor
            .iter()
            .find(|&&(_, left, right)| left < tenant.right && tenant.left < right);
        if let Some(&(i, _, _)) = hit {
            if let serde_json::Value::Object(m) = &mut units[i] {
                m.insert("visitorsYest".into(), row.served.into());
            }
        }
    }
}

/// Give each open party hall and theatre the audience the census counts for
/// it (#1500): 50 for a hall, and for a theatre 40 for each step of the film
/// draw its record's byte 15 holds. The finance block decides: a class whose
/// rooms add up to its count is seeded room by room. Otherwise, when the count
/// splits evenly into an audience each room could hold, every room gets that
/// share; a save taken after a film's draw fell but before the census caught
/// up counts the old draw. Anything else seeds nothing, since a hall or
/// theatre opened that day counts nothing yet and the file does not say which.
pub(super) fn seed_audiences(units: &mut [serde_json::Value], tdt: &TdtTower) {
    let Some(file) = tdt.tail.finance_population else {
        return;
    };
    let field = |u: &serde_json::Value, k: &str| u.get(k).and_then(serde_json::Value::as_i64);
    // The few halls and theatres the import placed: index, kind, floors, span.
    let mut venues: Vec<(usize, Kind, i64, i64, i64, i64)> = vec![];
    for (i, u) in units.iter().enumerate() {
        let Some(kind) = u
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .and_then(Kind::parse)
            .filter(|&k| counts_set_audience(k))
        else {
            continue;
        };
        if u.get("state").and_then(serde_json::Value::as_str) == Some("construction") {
            continue;
        }
        if let (Some(f), Some(x), Some(w)) = (field(u, "floor"), field(u, "x"), field(u, "width")) {
            venues.push((i, kind, f, f + kind.floors() - 1, x, x + w));
        }
    }
    if venues.is_empty() {
        return;
    }
    // Each venue's audience, from the first of its parts the floors list.
    let mut audience: Vec<Option<i64>> = vec![None; venues.len()];
    for floor in &tdt.floors {
        let at = floor.index - TDT_FLOOR_OFFSET;
        for t in &floor.tenants {
            let Some(kind) = part_family(t.type_id).filter(|&k| counts_set_audience(k)) else {
                continue;
            };
            let hit = venues.iter().position(|&(_, k, bottom, top, left, right)| {
                k == kind && (bottom..=top).contains(&at) && left < t.right && t.left < right
            });
            if let Some(v) = hit {
                audience[v] = audience[v].or_else(|| set_audience(kind, t.draw));
            }
        }
    }
    let mut sums = [0i64; TDT_POPULATION_CLASSES];
    let mut rooms = [0i64; TDT_POPULATION_CLASSES];
    for (v, &(_, kind, ..)) in venues.iter().enumerate() {
        if let Some(class) = population_class(kind) {
            sums[class] += audience[v].unwrap_or(0);
            rooms[class] += 1;
        }
    }
    for (v, &(i, kind, ..)) in venues.iter().enumerate() {
        let Some(class) = population_class(kind) else {
            continue;
        };
        let count = if file[class] <= 0 {
            None
        } else if sums[class] == file[class] {
            audience[v]
        } else {
            even_share(kind, file[class], rooms[class])
        };
        if let (Some(count), serde_json::Value::Object(m)) = (count, &mut units[i]) {
            m.insert("visitorsYest".into(), count.into());
        }
    }
}

/// `total` split evenly over `rooms` of `kind`, when the share is an audience
/// one of them could count at some film draw.
fn even_share(kind: Kind, total: i64, rooms: i64) -> Option<i64> {
    if rooms <= 0 || total % rooms != 0 {
        return None;
    }
    let share = total / rooms;
    (0..=NEW_FILM_DRAW)
        .any(|draw| set_audience(kind, draw) == Some(share))
        .then_some(share)
}
