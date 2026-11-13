//! The ground lobby height a `.TDT` export writes (#308).

use serde_json::Value;

use crate::facilities::MAX_LOBBY_HEIGHT;

/// The height in stories of the save's ground lobby, from its
/// `lobbyHeights` (#308): 1 when the save lists none for floor 1. The
/// loader keeps only heights from 2 to `MAX_LOBBY_HEIGHT`, and anything
/// else here reads as 1 too.
pub fn ground_lobby_height(save: &Value) -> i64 {
    let entries = save.get("lobbyHeights").and_then(Value::as_array);
    entries
        .into_iter()
        .flatten()
        .filter_map(|e| Some((e.get(0)?.as_i64()?, e.get(1)?.as_i64()?)))
        .find(|&(floor, _)| floor == 1)
        .map_or(1, |(_, height)| height)
        .clamp(1, MAX_LOBBY_HEIGHT)
}
