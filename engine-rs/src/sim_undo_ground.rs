//! The ground a step leaves (`sim_undo_check.rs`): the tower's floor and
//! lobby tiles, less those of the units the step takes out, with those of
//! the units it puts back. A room, a shaft or the metro station the step
//! puts back must stand where building it could, a floor or lobby tile
//! where its story and the station let it, and what the step leaves
//! standing must keep standing. The lobby rule, that taking out a
//! ground-floor lobby tile leaves nothing laid since hanging, has its own
//! file (`sim_undo_lobby.rs`).
use crate::crowd::fasthash::{FastMap, FastSet};
use crate::facilities::{is_sky_lobby_floor, Kind, LOT_WIDTH, MIN_FLOOR};
use crate::tower::{Tower, Transport, Unit};
use crate::undo::{Step, UnitChange};

/// The floor the lobby concourse runs along.
const GROUND_FLOOR: i64 = 1;

#[path = "sim_undo_lobby.rs"]
mod lobby;

pub(crate) struct Ground<'a> {
    tower: &'a Tower,
    leaving: &'a FastSet<i64>,
    /// The floor and lobby tiles the step puts back, each with the id and
    /// kind of the unit it puts back there.
    laid: FastMap<(i64, i64), (i64, Kind)>,
    /// The floor and lobby tiles the step takes out and does not lay again,
    /// as (x, floor) in order, so a shaft finds those in its column with a
    /// search.
    taken: Vec<(i64, i64)>,
    /// Where on the ground floor the step takes out a lobby tile and does
    /// not lay a tile again.
    lobbies_taken: Vec<i64>,
    /// The lobby tiles the step adds to each floor, less those it takes out.
    lobbies_added: FastMap<i64, i64>,
    /// The room tiles the step takes out on each row a room it takes out
    /// stands on.
    rooms_leaving: FastMap<i64, i64>,
    /// The floor the metro station stands on once the step applies: the
    /// tower's, unless the step takes it out, or the one the step puts back.
    station: Option<i64>,
}

impl<'a> Ground<'a> {
    pub(crate) fn of(tower: &'a Tower, step: &Step, leaving: &'a FastSet<i64>) -> Self {
        let put_back: Vec<&Unit> = step
            .units
            .iter()
            .filter_map(|img| match &img.change {
                UnitChange::PutBack(u) => Some(u),
                _ => None,
            })
            .collect();
        let mut laid = FastMap::default();
        for u in put_back.iter().filter(|u| u.kind.is_structural()) {
            for tile in tiles_of(u) {
                laid.insert(tile, (u.id, u.kind));
            }
        }
        let mut lobbies_added = FastMap::default();
        for u in put_back.iter().filter(|u| u.kind == Kind::Lobby) {
            *lobbies_added.get_or_insert_with(u.floor, || 0) += u.width;
        }
        // One walk over the units the step takes out.
        let (mut taken, mut lobbies_taken) = (Vec::new(), Vec::new());
        let mut rooms_leaving = FastMap::default();
        let mut station_leaves = false;
        let taken_out = step
            .units
            .iter()
            .filter(|img| matches!(img.change, UnitChange::TakeOut(_)))
            .filter_map(|img| tower.get_unit(img.id));
        for u in taken_out {
            if u.kind.is_structural() {
                for (floor, x) in tiles_of(u).filter(|tile| !laid.contains_key(tile)) {
                    taken.push((x, floor));
                    if u.kind == Kind::Lobby && floor == GROUND_FLOOR {
                        lobbies_taken.push(x);
                    }
                }
                if u.kind == Kind::Lobby {
                    *lobbies_added.get_or_insert_with(u.floor, || 0) -= u.width;
                }
            } else {
                for row in u.floor..u.floor + u.kind.floors() {
                    *rooms_leaving.get_or_insert_with(row, || 0) += u.width;
                }
                station_leaves |= u.kind == Kind::Metro;
            }
        }
        taken.sort_unstable();
        let station = match tower.metro_floor() {
            Some(floor) if !station_leaves => Some(floor),
            _ => put_back
                .iter()
                .find(|u| u.kind == Kind::Metro)
                .map(|u| u.floor),
        };
        Ground {
            tower,
            leaving,
            laid,
            taken,
            lobbies_taken,
            lobbies_added,
            rooms_leaving,
            station,
        }
    }

    fn holds(&self, floor: i64, x: i64) -> bool {
        self.laid.contains_key(&(floor, x)) || self.stays(floor, x)
    }

    /// The id and kind of the unit whose floor or lobby tile holds at
    /// `tile`, as (floor, x), once the step applies: the one the step puts
    /// back there, or the tower's that stays. Unit ids only grow, and a unit
    /// an undo puts back keeps its own, so the id says when the tile was
    /// built.
    fn built_by(&self, tile: (i64, i64)) -> Option<(i64, Kind)> {
        if let Some(&laid) = self.laid.get(&tile) {
            return Some(laid);
        }
        let id = *self.tower.structure.get(&tile)?;
        let kind = self.tower.struct_kind.get(&tile).copied()?;
        (!self.leaving.contains(&id)).then_some((id, kind))
    }

    /// Whether the tower's floor or lobby tile at (`floor`, `x`) stays,
    /// which is all a sale of what the step takes out leaves there.
    fn stays(&self, floor: i64, x: i64) -> bool {
        self.tower
            .structure
            .get(&(floor, x))
            .is_some_and(|id| !self.leaving.contains(id))
    }

    /// Whether the step lays one of the tiles of floor or lobby tile `u`
    /// again.
    pub(crate) fn lays_again(&self, u: &Unit) -> bool {
        tiles_of(u).any(|tile| self.laid.contains_key(&tile))
    }

    /// Whether `floor` has a lobby tile once the step applies.
    fn has_lobby(&self, floor: i64) -> bool {
        let added = self.lobbies_added.get(&floor).copied().unwrap_or(0);
        self.tower.lobby_tile_count(floor) + added > 0
    }

    /// Whether the step leaves a room tile on `row`.
    fn rooms_stay_on(&self, row: i64) -> bool {
        let on_row = self.tower.room_tiles.get(&row).copied().unwrap_or(0);
        on_row > self.rooms_leaving.get(&row).copied().unwrap_or(0)
    }

    /// Whether unit `u` stands where the build rules let it. A floor or lobby
    /// tile stands on the metro station's row or above it, and above the ground
    /// floor rests on the story below, as `Tower::is_supported` asks; a lobby
    /// tile goes back on a sky lobby floor only where no room stays on that
    /// floor (`Tower::can_place`). A floor tile may go back on a sky lobby
    /// floor beside a room, or beside a lobby the lobby brush left there,
    /// though `Tower::can_place` refuses a new one beside a lobby. A tile on
    /// the ground floor or below is asked for no neighbor here, though its
    /// build asked for a tile beside, above or below it (#1843). A room has
    /// floor under every tile, as its build laid (`Tower::ensure_floor_under`),
    /// sits on no sky lobby floor that holds a lobby (so never on a lobby tile,
    /// which goes only on those floors and the ground floor, where no room
    /// goes), and stands above the station's row (`metro_reason`). A wedding
    /// hall's upper story stands above the top slab. The station itself has
    /// nothing below it and no room on its row.
    pub(crate) fn under_room(&self, u: &Unit) -> bool {
        if u.kind.is_structural() {
            let rests =
                u.floor <= GROUND_FLOOR || (u.x..u.x + u.width).all(|x| self.holds(u.floor - 1, x));
            let concourse = u.kind == Kind::Lobby && is_sky_lobby_floor(u.floor);
            return rests
                && !(concourse && self.rooms_stay_on(u.floor))
                && self.station.is_none_or(|station| u.floor >= station);
        }
        let stories = self.tower.lot().slab_stories(u.kind, u.floor);
        let floored = (u.floor..u.floor + stories).all(|f| {
            !(is_sky_lobby_floor(f) && self.has_lobby(f))
                && (u.x..u.x + u.width).all(|x| self.holds(f, x))
        });
        let site = if u.kind == Kind::Metro {
            self.clear_for_station(u.floor)
        } else {
            self.station.is_none_or(|station| u.floor > station)
        };
        floored && site
    }

    /// Whether nothing the step leaves stands below `row`, and no room it
    /// leaves stands on that row, so a station can stand there. A unit the step
    /// puts back below the row, or a room it puts back on it, is refused on its
    /// own.
    fn clear_for_station(&self, row: i64) -> bool {
        if self.rooms_stay_on(row) {
            return false;
        }
        // Every room stands on floor, so the floor tiles say where the
        // units are.
        let lowest = self.tower.floor_bounds().0.max(MIN_FLOOR);
        (lowest..row).all(|floor| (0..LOT_WIDTH).all(|x| !self.holds(floor, x)))
    }

    /// Whether shaft `t` has floor or lobby in its column on every story it
    /// spans, as `Tower::validate_transport` asks.
    pub(crate) fn under_shaft(&self, t: &Transport) -> bool {
        (t.bottom..=t.top).all(|f| (t.x..t.x + t.width).any(|x| self.holds(f, x)))
    }

    /// Whether shaft `t`, which stood on the tower's tiles, still has floor
    /// or lobby in its column on each story where the step takes a tile
    /// from under it.
    pub(crate) fn still_under_shaft(&self, t: &Transport) -> bool {
        self.under_shaft_where(t, |floor, x| self.holds(floor, x))
    }

    /// Whether shaft `t` would still have that floor once the player sold
    /// what the step takes out: a sale lays no tile.
    pub(crate) fn still_under_shaft_once_sold(&self, t: &Transport) -> bool {
        self.under_shaft_where(t, |floor, x| self.stays(floor, x))
    }

    /// Whether shaft `t` has a tile that `holds` in its column on each
    /// story where the step takes a tile from under it. Each column of the
    /// shaft is a run of `taken`, found by a search.
    fn under_shaft_where(&self, t: &Transport, holds: impl Fn(i64, i64) -> bool) -> bool {
        let columns = t.x..t.x + t.width;
        columns.clone().all(|x| {
            let from = self.taken.partition_point(|&tile| tile < (x, t.bottom));
            let to = self.taken.partition_point(|&tile| tile <= (x, t.top));
            // A shaft whose span runs backward has no tiles under it.
            self.taken
                .get(from..to)
                .unwrap_or_default()
                .iter()
                .all(|&(_, f)| columns.clone().any(|x| holds(f, x)))
        })
    }

    /// Whether the player could sell floor tile `u`, with the other tiles
    /// the step takes out, by the floor rule a sale keeps to
    /// (`Tower::removal_reason`): in a mode that keeps floors whole
    /// ([`GameMode::removes_mid_floor_tiles`](crate::clock::GameMode::removes_mid_floor_tiles)),
    /// the run of leaving tiles around `u` must reach an end of its story,
    /// so the sales can start there. Only the run's first tile walks it, and
    /// the others answer yes, so a step's check stays linear in its tiles:
    /// the step is sellable only when every tile is, and the first one's
    /// answer is the run's.
    pub(crate) fn sells_from_an_end(&self, u: &Unit) -> bool {
        let leaves = |x: i64| {
            self.tower
                .structure
                .get(&(u.floor, x))
                .is_some_and(|id| self.leaving.contains(id))
        };
        if self.tower.mode.removes_mid_floor_tiles() || leaves(u.x - 1) {
            return true;
        }
        let mut right = u.x + u.width;
        while leaves(right) {
            right += 1;
        }
        !(self.stays(u.floor, u.x - 1) && self.stays(u.floor, right))
    }

    /// Whether taking out floor or lobby tile `u` leaves everything it held
    /// up standing, by the rules a sale keeps to (`Tower::removal_reason`):
    /// no room stays on its tiles, and from the ground floor up no story
    /// stays above it, unless the step lays the tile again.
    pub(crate) fn leaves_nothing_hanging_from(&self, u: &Unit) -> bool {
        tiles_of(u).all(|(f, x)| {
            let room_stays = self
                .tower
                .rooms
                .get(&(f, x))
                .is_some_and(|id| !self.leaving.contains(id));
            self.laid.contains_key(&(f, x))
                || (!room_stays && !(f >= GROUND_FLOOR && self.holds(f + 1, x)))
        })
    }
}

/// The tiles floor or lobby unit `u` covers.
fn tiles_of(u: &Unit) -> impl Iterator<Item = (i64, i64)> + '_ {
    (u.x..u.x + u.width).map(move |x| (u.floor, x))
}
