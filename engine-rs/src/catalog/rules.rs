//! The catalog's `rules` block: the mode rules a frontend shows.

use serde::Serialize;

/// Mode rules a frontend shows the player, each stated from the engine's own
/// rule method, so a frontend reads them here instead of deciding them from
/// the mode's name.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rules {
    /// Whether a sold condo carries its own household of 2 to 5 that prices
    /// the sale and counts its residents. When false every condo houses the
    /// flat family and stores no household.
    pub variant_households: bool,
    /// Whether the build preview names the engine's refusal before the
    /// click. When false the refusal shows only once a click is refused.
    pub preview_names_refusal: bool,
    /// Whether the elevator schedule's assisted tools answer: the intent
    /// presets, auto-tune and the staffing advice. When false the schedule
    /// is the manual grid only and each assisted query is refused.
    pub schedule_assist: bool,
    /// Whether the player may place new construction while the game is
    /// paused. When false the frontend refuses a placement at speed 0 and
    /// says to unpause; the engine itself has no paused state.
    pub builds_while_paused: bool,
    /// Whether the tower can be exported for SimTower (1994) as a `.TDT`.
    /// When false the frontend disables that export with the reason, and the
    /// engine's `.TDT` export refuses the tower.
    pub exports_to_1994: bool,
    /// Whether the tenant card's lobby warning quotes the floors to the
    /// nearest lobby. When false it names the problem without the number.
    pub quotes_lobby_distance: bool,
    /// Whether a sky lobby may rise more than one story (#308). The ground
    /// lobby always may, up to `max_lobby_height`; when false it is the only
    /// one that can.
    pub tall_sky_lobbies: bool,
    /// The most stories a lobby can rise (#308). A floor's first lobby
    /// placement sets its height, and it never changes after.
    pub max_lobby_height: i64,
}
