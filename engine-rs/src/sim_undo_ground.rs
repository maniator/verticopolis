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
use crate::tower::{floor_left_of, floor_right_of, Tower, Transport, Unit};
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
    /// The row the metro stations stand on once the step applies: that of a
    /// station the step leaves standing, else that of one it puts back.
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
            }
        }
        taken.sort_unstable();
        let station = tower
            .metro_stations()
            .find(|u| !leaving.contains(&u.id))
            .or_else(|| put_back.iter().copied().find(|u| u.kind == Kind::Metro))
            .map(|u| u.floor);
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
            self.station == Some(u.floor) && self.clear_for_station(u.floor)
        } else {
            self.station.is_none_or(|station| u.floor > station)
        };
        floored && site
    }

    /// Whether nothing the step leaves stands below `row`, and no room it
    /// leaves stands on that row but the other metro stations, so a station
    /// can stand there beside them. A unit the step puts back below the row,
    /// or a room it puts back on it, is refused on its own.
    fn clear_for_station(&self, row: i64) -> bool {
        let staying_stations: i64 = self
            .tower
            .metro_stations()
            .filter(|u| u.floor == row && !self.leaving.contains(&u.id))
            .map(|u| u.width)
            .sum();
        let on_row = self.tower.room_tiles.get(&row).copied().unwrap_or(0);
        let leaving = self.rooms_leaving.get(&row).copied().unwrap_or(0);
        if on_row - leaving > staying_stations {
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
    /// the sales take each run of leaving tiles from one of its ends, by
    /// [`floor_left_of`] and [`floor_right_of`] over the tiles that stay, as
    /// `Tower::floor_on_both_sides` asks of a sale. So a gap a save already
    /// has is no end, and a lobby a run touches holds it in. A run still
    /// standing is plain floor on one side of every other run on its story,
    /// so the sales start at the story's two ends and work inward: the run
    /// of `u` comes out once every run from one end of the story through it
    /// can come out toward that end. Only the run's first tile asks, for the
    /// whole run, and the others answer yes, since the step is sellable only
    /// when every tile is.
    pub(crate) fn sells_from_an_end(&self, u: &Unit) -> bool {
        if self.tower.mode.removes_mid_floor_tiles() || self.leaves(u.floor, u.x - 1) {
            return true;
        }
        // The run ends at the first tile past `u` that does not leave.
        let run_end = (u.x + u.width..LOT_WIDTH)
            .find(|&x| !self.leaves(u.floor, x))
            .unwrap_or(LOT_WIDTH);
        self.comes_out_leftward(u.floor, u.x) || self.comes_out_rightward(u.floor, run_end)
    }

    /// Whether every run of leaving tiles on `floor`, from the lot's left
    /// edge through the run that starts at `start`, can come out from its
    /// left end: none has floor on its left by [`floor_left_of`]. No plain
    /// floor that stays is left of the run at `start`, so none is left of an
    /// earlier run, and an earlier run has floor on its left only where a
    /// tile that stays touches it.
    fn comes_out_leftward(&self, floor: i64, start: i64) -> bool {
        !floor_left_of(start, |x| self.kind_staying(floor, x))
            && !(0..start).any(|x| self.stays(floor, x) && self.leaves(floor, x + 1))
    }

    /// Whether every run of leaving tiles on `floor`, from the run that
    /// ends before `end` through the lot's right edge, can come out from its
    /// right end, by [`floor_right_of`] and the reasoning of
    /// `comes_out_leftward`.
    fn comes_out_rightward(&self, floor: i64, end: i64) -> bool {
        !floor_right_of(end, |x| self.kind_staying(floor, x))
            && !(end..LOT_WIDTH).any(|x| self.stays(floor, x) && self.leaves(floor, x - 1))
    }

    /// Whether the tower's floor or lobby tile at (`floor`, `x`) is one the
    /// step takes out.
    fn leaves(&self, floor: i64, x: i64) -> bool {
        self.tower
            .structure
            .get(&(floor, x))
            .is_some_and(|id| self.leaving.contains(id))
    }

    /// The kind of the tower's floor or lobby tile at (`floor`, `x`) when it
    /// stays, which is all a sale of what the step takes out leaves there.
    fn kind_staying(&self, floor: i64, x: i64) -> Option<Kind> {
        self.tower
            .structure_kind_at(floor, x)
            .filter(|_| self.stays(floor, x))
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
