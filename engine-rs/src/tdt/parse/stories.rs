//! What the importer reads off the paved stories: the excavated basement
//! tiles, and the stories a tall ground lobby rises through (#308).

use std::collections::BTreeMap;

use super::out_unit::OutUnit;
use crate::facilities::MAX_LOBBY_HEIGHT;
use crate::tdt::format::{tdt_stair_stories, TDT_FLOOR_OFFSET};
use crate::tdt::types::TdtTower;

/// Every paved basement tile, as the save's `excavated` keys
/// (`"floor:x"`), in floor and then tile order.
pub(super) fn excavated_tiles(paved: &BTreeMap<i64, Vec<u8>>) -> Vec<String> {
    let basements = paved.iter().filter(|(&floor, _)| floor <= 0);
    basements
        .flat_map(|(&floor, row)| {
            let tiles = row.iter().enumerate().filter(|(_, &cell)| cell != 0);
            tiles.map(move |(x, _)| format!("{floor}:{x}"))
        })
        .collect()
}

/// The ground lobby's height the import keeps, from the header's lobby
/// height: 2 or 3 when the file has a ground lobby and nothing but floor and
/// lobby tiles on the stories it rises through, all of them over the ground
/// lobby, with no shaft or flight ending there; 1 otherwise. Those stories
/// are taken out of `paved`, since the lobby covers them in the tower the
/// engine builds; a tile beside the lobby's footprint keeps the height at 1
/// so that tile is never dropped.
pub(super) fn raise_ground_lobby(
    paved: &mut BTreeMap<i64, Vec<u8>>,
    tdt: &TdtTower,
    units: &[OutUnit],
) -> i64 {
    let height = tdt.header.lobby_height;
    let rises = 2..1 + height;
    let ground = paved.get(&1);
    let has_lobby = ground.is_some_and(|row| row.iter().any(|&c| c != 0));
    let over_lobby = |x: usize| ground.is_some_and(|row| row.get(x).is_some_and(|&c| c != 0));
    let tile_beside_lobby = rises.clone().any(|story| {
        paved.get(&story).is_some_and(|row| {
            let mut tiles = row.iter().enumerate().filter(|(_, &c)| c != 0);
            tiles.any(|(x, _)| !over_lobby(x))
        })
    });
    let room_inside = units
        .iter()
        .any(|u| u.floor < rises.end && u.floor + u.kind.floors() > rises.start);
    let elevators = tdt.tail.elevators.as_deref().unwrap_or(&[]);
    let elevator_ends = elevators.iter().flat_map(|e| [e.bottom_floor, e.top_floor]);
    // The floors each flight lands on as the import builds it: a flight from
    // the ground floor climbing the lobby's height whole, and any other
    // record one story at a time (`transports_from_decoded`).
    let stairs = tdt.tail.stairs.as_deref().unwrap_or(&[]);
    let landings = stairs.iter().filter(|s| s.type_id <= 5).flat_map(|s| {
        let base = s.floor - TDT_FLOOR_OFFSET;
        let stories = tdt_stair_stories(s.type_id);
        let whole = base == 1 && stories == height;
        let climb = if whole { stories } else { 1 };
        (0..=stories).step_by(climb as usize).map(move |i| base + i)
    });
    let shaft_inside = elevator_ends
        .map(|end| end - TDT_FLOOR_OFFSET)
        .chain(landings)
        .any(|floor| rises.contains(&floor));
    let blocked = room_inside || shaft_inside || tile_beside_lobby;
    if !(2..=MAX_LOBBY_HEIGHT).contains(&height) || !has_lobby || blocked {
        return 1;
    }
    for story in rises {
        paved.remove(&story);
    }
    height
}

#[cfg(test)]
#[path = "stories_tests.rs"]
mod tests;
