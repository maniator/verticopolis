//! The ground lobby height a `.TDT` export writes (#308).

use serde_json::Value;

use crate::facilities::MAX_LOBBY_HEIGHT;

/// The height in stories of the save's ground lobby, from its
/// `lobbyHeights` (#308): 1 when the save lists none for floor 1. An entry
/// is `[floor, height]` (version 8, a whole floor) or `[floor, x0, x1,
/// height]` (version 9, one hall, #2068); the export takes only Classic
/// towers, whose ground halls share one height, so the first floor 1 entry
/// gives it. The loader keeps only heights from 2 to `MAX_LOBBY_HEIGHT`,
/// and anything else here reads as 1 too.
pub fn ground_lobby_height(save: &Value) -> i64 {
    let entries = save.get("lobbyHeights").and_then(Value::as_array);
    entries
        .into_iter()
        .flatten()
        .filter_map(|e| {
            let list = e.as_array()?;
            let height = list.get(list.len().checked_sub(1)?)?.as_i64()?;
            matches!(list.len(), 2 | 4).then_some((list.first()?.as_i64()?, height))
        })
        .find(|&(floor, _)| floor == 1)
        .map_or(1, |(_, height)| height)
        .clamp(1, MAX_LOBBY_HEIGHT)
}
