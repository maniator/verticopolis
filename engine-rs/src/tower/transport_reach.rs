//! The refusals a newly served floor can raise, which `resize_transport`
//! checks for every new floor and an extend drag stops just short of
//! (#1847).

use super::Tower;
use crate::facilities::*;

impl Tower {
    /// Why shaft `id` (a `kind` at `tx`, `twidth` wide) cannot newly serve
    /// floor `fl`: another shaft is in the way, a room is (for an elevator,
    /// `shaft_rooms.rs`), or a lobby is due there and not built (the ground
    /// floor holds only lobby, and a sky lobby floor needs every tile under
    /// the shaft built first). `None` when it can.
    pub(super) fn new_floor_refusal(
        &self,
        id: i64,
        kind: Kind,
        tx: i64,
        twidth: i64,
        fl: i64,
    ) -> Option<String> {
        let blocked = self
            .transports
            .iter()
            .any(|other| other.id != id && Self::transport_overlaps(other, tx, twidth, fl));
        if blocked {
            return Some(SHAFT_OVERLAP.into());
        }
        if let Some(r) = self.shaft_room_reason(kind, fl, tx, twidth) {
            return Some(r.into());
        }
        if is_lobby_floor(fl) && !self.span_has_floor(fl, tx, twidth) {
            let lobby = if is_sky_lobby_floor(fl) {
                "sky lobby"
            } else {
                "lobby"
            };
            return Some(format!(
                "Build the {lobby} on floor {fl} first, then extend through it."
            ));
        }
        None
    }
}
