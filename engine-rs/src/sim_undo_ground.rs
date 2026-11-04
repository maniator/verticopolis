//! The ground a step leaves (`sim_undo_check.rs`): the tower's floor and
//! lobby tiles, less those of the units the step takes out, with those of
//! the units it puts back. A room, a shaft or a story the step puts back
//! must stand where building it could, and one it leaves standing must keep
//! standing.
use crate::crowd::fasthash::{FastMap, FastSet};
use crate::facilities::{is_sky_lobby_floor, Kind, MAX_FLOOR};
use crate::tower::{Tower, Transport, Unit};
use crate::undo::{Step, UnitChange};

pub(crate) struct Ground<'a> {
    tower: &'a Tower,
    leaving: &'a FastSet<i64>,
    /// The floor and lobby tiles the step puts back.
    laid: FastSet<(i64, i64)>,
    /// The floor and lobby tiles the step takes out and does not lay again,
    /// as (x, floor) in order, so a shaft finds those in its column with a
    /// search.
    taken: Vec<(i64, i64)>,
    /// The lobby tiles the step adds to each floor, less those it takes out.
    lobbies_added: FastMap<i64, i64>,
    /// The floor the tower's metro station stands on, unless the step takes
    /// it out.
    station: Option<i64>,
}

impl<'a> Ground<'a> {
    pub(crate) fn of(tower: &'a Tower, step: &Step, leaving: &'a FastSet<i64>) -> Self {
        let put_back = || {
            step.units.iter().filter_map(|img| match &img.change {
                UnitChange::PutBack(u) => Some(u),
                _ => None,
            })
        };
        let taken_out = || {
            step.units
                .iter()
                .filter(|img| matches!(img.change, UnitChange::TakeOut(_)))
                .filter_map(|img| tower.get_unit(img.id))
        };
        let laid: FastSet<(i64, i64)> = put_back()
            .filter(|u| u.kind.is_structural())
            .flat_map(tiles_of)
            .collect();
        let mut taken: Vec<(i64, i64)> = taken_out()
            .filter(|u| u.kind.is_structural())
            .flat_map(tiles_of)
            .filter(|tile| !laid.contains(tile))
            .map(|(floor, x)| (x, floor))
            .collect();
        taken.sort_unstable();
        let mut lobbies_added = FastMap::default();
        let lobbies = |u: &Unit| (u.kind == Kind::Lobby).then_some((u.floor, u.width));
        for (floor, n) in put_back().filter_map(lobbies) {
            *lobbies_added.get_or_insert_with(floor, || 0) += n;
        }
        for (floor, n) in taken_out().filter_map(lobbies) {
            *lobbies_added.get_or_insert_with(floor, || 0) -= n;
        }
        let station = tower
            .metro_floor()
            .filter(|_| !taken_out().any(|u| u.kind == Kind::Metro));
        Ground {
            tower,
            leaving,
            laid,
            taken,
            lobbies_added,
            station,
        }
    }

    fn holds(&self, floor: i64, x: i64) -> bool {
        self.laid.contains(&(floor, x))
            || self
                .tower
                .structure
                .get(&(floor, x))
                .is_some_and(|id| !self.leaving.contains(id))
    }

    /// Whether `floor` has a lobby tile once the step applies.
    fn has_lobby(&self, floor: i64) -> bool {
        let added = self.lobbies_added.get(&floor).copied().unwrap_or(0);
        self.tower.lobby_tile_count(floor) + added > 0
    }

    /// Whether unit `u` stands where building it could, by the support and
    /// site rules of `Tower::is_supported` and `room_placement_reason`. A
    /// floor or lobby tile above the ground floor rests on the story below.
    /// A room has floor under every tile, as its build laid
    /// (`Tower::ensure_floor_under`), sits on no sky lobby floor that holds
    /// a lobby (so never on a lobby tile, which goes only on those floors
    /// and the ground floor, where no room goes), and stands above the
    /// metro station's row. A wedding hall's upper story stands above the
    /// top slab.
    pub(crate) fn under_room(&self, u: &Unit) -> bool {
        if u.kind.is_structural() {
            return u.floor < 2 || (u.x..u.x + u.width).all(|x| self.holds(u.floor - 1, x));
        }
        let stories = u.kind.floors().min(MAX_FLOOR + 1 - u.floor);
        let floored = (u.floor..u.floor + stories).all(|f| {
            !(is_sky_lobby_floor(f) && self.has_lobby(f))
                && (u.x..u.x + u.width).all(|x| self.holds(f, x))
        });
        floored && self.station.is_none_or(|station| u.floor > station)
    }

    /// Whether shaft `t` has floor or lobby in its column on every story it
    /// spans, as `Tower::validate_transport` asks.
    pub(crate) fn under_shaft(&self, t: &Transport) -> bool {
        (t.bottom..=t.top).all(|f| (t.x..t.x + t.width).any(|x| self.holds(f, x)))
    }

    /// Whether shaft `t`, which stood on the tower's tiles, still has floor
    /// or lobby in its column on each story where the step takes a tile
    /// from under it. Each column of the shaft is a run of `taken`, found by
    /// a search.
    pub(crate) fn still_under_shaft(&self, t: &Transport) -> bool {
        let columns = t.x..t.x + t.width;
        columns.clone().all(|x| {
            let from = self.taken.partition_point(|&tile| tile < (x, t.bottom));
            let to = self.taken.partition_point(|&tile| tile <= (x, t.top));
            self.taken[from..to]
                .iter()
                .all(|&(_, f)| columns.clone().any(|x| self.holds(f, x)))
        })
    }

    /// Whether every run of basement tiles under a ground-floor tile the
    /// step takes out still hangs from the tower: some tile of the run keeps
    /// a ground-floor tile above it or a story below it. No sale takes a
    /// lobby tile out, so this rule is the check's own. `taken` is in x
    /// order, so each run is walked once.
    pub(crate) fn leaves_no_basement_hanging(&self) -> bool {
        let mut walked_to = i64::MIN;
        self.taken.iter().all(|&(x, floor)| {
            if floor != 1 || x <= walked_to || !self.holds(0, x) {
                return true;
            }
            let (mut low, mut high) = (x, x);
            while self.holds(0, low - 1) {
                low -= 1;
            }
            while self.holds(0, high + 1) {
                high += 1;
            }
            walked_to = high;
            (low..=high).any(|x| self.holds(1, x) || self.holds(-1, x))
        })
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
            self.laid.contains(&(f, x)) || (!room_stays && !(f >= 1 && self.holds(f + 1, x)))
        })
    }
}

/// The tiles floor or lobby unit `u` covers.
fn tiles_of(u: &Unit) -> impl Iterator<Item = (i64, i64)> + '_ {
    (u.x..u.x + u.width).map(move |x| (u.floor, x))
}
