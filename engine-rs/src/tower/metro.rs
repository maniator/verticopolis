//! Where a metro station may stand, and what its row lets the rest of the
//! tower build there.

use super::Tower;
use crate::facilities::*;

impl Tower {
    /// The metro rules: SimTower's station is three stories on B8 to B10 with
    /// its tunnel along the bottom row, and nothing can be built below it. The
    /// bottom basement row holds only the station and its tunnel. A Modern
    /// tower may hold several stations (`build_cap_in`); they all run on the
    /// one line, so each stands on the first station's row, beside the others.
    pub(super) fn metro_reason(&self, kind: Kind, floor: i64) -> Option<String> {
        let station = self.metro_floor();
        if kind == Kind::Metro {
            if station.is_some_and(|row| row != floor) {
                return Some(
                    "Every metro station runs on the same line. Build it on the first station's row."
                        .into(),
                );
            }
            if self.floor_bounds().0 < floor {
                return Some(
                    "Nothing can be built below the metro station. Clear the floors under it first."
                        .into(),
                );
            }
            if self.floor_has_room_besides_stations(floor) {
                return Some("The metro's bottom row is its tunnel. Clear it first.".into());
            }
            return None;
        }
        let structural = kind.is_structural();
        if let Some(station) = station {
            if floor < station {
                return Some("Nothing can be built below the metro station.".into());
            }
            if floor == station && !structural {
                return Some("The metro's bottom row is its tunnel.".into());
            }
        }
        if floor == MIN_FLOOR && !structural {
            return Some("The bottom basement row is only for the metro tunnel.".into());
        }
        None
    }

    /// Whether a room other than a metro station stands on `floor`. A
    /// station's own bottom story counts as a room on its row, so the row
    /// that holds one station still takes another beside it.
    fn floor_has_room_besides_stations(&self, floor: i64) -> bool {
        let rooms = self.room_tiles.get(&floor).copied().unwrap_or(0);
        rooms > self.station_tiles_on(floor)
    }

    /// The tiles the metro stations standing on `floor` cover on that row.
    pub(crate) fn station_tiles_on(&self, floor: i64) -> i64 {
        self.metro_stations()
            .filter(|u| u.floor == floor)
            .map(|u| u.width)
            .sum()
    }
}
