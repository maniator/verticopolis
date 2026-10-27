//! The structural snapshot: what a view rebuilds when `tower.revision`
//! moves. Rooms go one record each, in the order of the rooms index
//! (`Tower::room_index`), which is the slot order of the dynamic frame's
//! room records. Floor and lobby tiles,
//! most of a large tower's units, go as runs per floor, so the snapshot
//! grows with the rooms and the floors rather than with every tile.
use super::layout::{ROOM_RECORD, RUN_RECORD, SHAFT_FIXED, STRUCTURE_HEADER};
use crate::clock::{CalendarKind, GameMode};
use crate::facilities::{LOT_WIDTH, MAX_FLOOR, MIN_FLOOR};
use crate::frame::unit_fields;
use crate::sim::Simulation;
use crate::tower::{Tower, Unit};

/// A run of floor or lobby tiles being collected.
struct Run {
    kind: usize,
    floor: i64,
    x: i64,
    width: i64,
    count: i64,
    fields: [f64; 5],
}

impl Run {
    fn start(u: &Unit) -> Run {
        Run {
            kind: u.kind as usize,
            floor: u.floor,
            x: u.x,
            width: u.width,
            count: 1,
            fields: unit_fields(u),
        }
    }

    /// Whether `u` has this run's kind, floor, width and frame fields.
    fn matches(&self, u: &Unit) -> bool {
        u.kind as usize == self.kind
            && u.floor == self.floor
            && u.width == self.width
            && unit_fields(u) == self.fields
    }

    /// Add `u` to this run when it sits right after its last tile or right
    /// before its first one, with the same kind, floor, width and fields.
    /// Whether it did.
    fn take(&mut self, u: &Unit) -> bool {
        if !self.matches(u) {
            return false;
        }
        if u.x == self.x + self.count * self.width {
            self.count += 1;
        } else if u.x + self.width == self.x {
            self.x = u.x;
            self.count += 1;
        } else {
            return false;
        }
        true
    }

    /// Whether `next` starts where this run ends, with the same kind, floor,
    /// width and frame fields.
    fn continues_with(&self, next: &Run) -> bool {
        next.kind == self.kind
            && next.floor == self.floor
            && next.width == self.width
            && next.x == self.x + self.count * self.width
            && next.fields == self.fields
    }

    fn push(&self, v: &mut Vec<f64>) {
        v.extend_from_slice(&[
            self.kind as f64,
            self.floor as f64,
            self.x as f64,
            self.width as f64,
            self.count as f64,
        ]);
        v.extend_from_slice(&self.fields);
    }
}

/// Floors a tower can have, `MIN_FLOOR` to `MAX_FLOOR`.
const FLOORS: usize = (MAX_FLOOR - MIN_FLOOR + 1) as usize;

/// The fewest raw runs past which the walk stops and the runs are read off
/// the grid instead; `run_limit` raises it with the tower. The limit bounds
/// the sort, which grows with the scatter while the grid does not: the grid
/// is one more pass over the units and its `FLOORS * LOT_WIDTH` cells
/// (41,250). The round 3 review measured where the grid starts to win, on
/// a list scattered on purpose: at about 4,000 to 5,500 raw runs on medium
/// (12,062 units), and only past about 29,000 on large (43,358), where the
/// pass over the units is the larger cost.
const RUN_LIMIT: usize = 4096;

/// The raw runs past which `tower`'s walk gives way to the grid: half its
/// units, or `RUN_LIMIT` on a small tower. No reference save comes near it
/// (110 raw runs on large, 639 on medium, 1,132 on the owner's).
fn run_limit(tower: &Tower) -> usize {
    RUN_LIMIT.max(tower.units.len() / 2)
}

/// The runs of the floor and lobby tiles, by floor and then x, and
/// maximal: no run continues the one before it. One walk in unit-list
/// order makes them (`walk_runs`) unless the list is so scattered that it
/// makes more than `limit`; then the runs come off a grid of the tiles
/// (`grid_runs`), or, should a tile stand outside the grid or two share a
/// cell (no save the loader accepts holds either), from a walk with no
/// limit. The runs are sorted by where they start when they come out of
/// order, and the ones that continue each other joined. The join
/// runs whatever the order: a run that grew left can end where the run
/// before it starts with the two still in order (a drag over 0 to 4, then
/// one from 9 down to 5), and a floor outside the grid gets one run per
/// tile. The sort and the join are over the runs, at most `limit` of them
/// from the walk, and leave the tiles alone.
fn tile_runs(tower: &Tower, limit: usize) -> Vec<Run> {
    let mut runs = walk_runs(tower, limit)
        .or_else(|| grid_runs(tower))
        .unwrap_or_else(|| walk_runs(tower, usize::MAX).unwrap_or_default());
    let ordered = runs
        .windows(2)
        .all(|w| (w[0].floor, w[0].x) < (w[1].floor, w[1].x));
    if !ordered {
        // A stable sort, so runs that start on the same tile (stacked
        // tiles, which no accepted save holds) would keep their list order.
        runs.sort_by_key(|r| (r.floor, r.x));
    }
    // `dedup_by` hands the later run first: fold it into the earlier one
    // when it continues it.
    runs.dedup_by(|next, last| {
        let joins = last.continues_with(next);
        if joins {
            last.count += next.count;
        }
        joins
    });
    runs
}

/// The runs from one walk in unit-list order, or `None` once there are more
/// than `limit`. Each floor keeps the run its last tile went into, and a
/// tile joins that run when it sits right after or right before it, so a
/// floor built in one drag in either direction is one run however the list
/// interleaves floors. A floor built in separate drags gives one run per
/// drag.
fn walk_runs(tower: &Tower, limit: usize) -> Option<Vec<Run>> {
    let mut runs: Vec<Run> = Vec::new();
    let mut open: [Option<usize>; FLOORS] = [None; FLOORS];
    for u in &tower.units {
        if !u.kind.is_structural() {
            continue;
        }
        // A floor outside the grid, which no save the loader accepts holds,
        // still gets its runs, without the per-floor memory.
        let slot = usize::try_from(u.floor - MIN_FLOOR)
            .ok()
            .filter(|&f| f < FLOORS);
        let open_run = slot.and_then(|f| open[f]);
        if let Some(r) = open_run {
            if runs[r].take(u) {
                continue;
            }
        }
        if runs.len() == limit {
            return None;
        }
        if let Some(f) = slot {
            open[f] = Some(runs.len());
        }
        runs.push(Run::start(u));
    }
    Some(runs)
}

/// The runs read off a dense grid of the tiles by floor and x: one more pass
/// over the units and one over the grid's cells, whatever the list's order.
/// `None` when a tile stands outside the grid or two share a cell, which no
/// save the loader accepts holds; `tile_runs` then walks with no limit.
fn grid_runs(tower: &Tower) -> Option<Vec<Run>> {
    let width = LOT_WIDTH as usize;
    let mut grid = vec![u32::MAX; FLOORS * width];
    for (i, u) in tower.units.iter().enumerate() {
        if !u.kind.is_structural() {
            continue;
        }
        let f = usize::try_from(u.floor - MIN_FLOOR)
            .ok()
            .filter(|&f| f < FLOORS)?;
        let x = usize::try_from(u.x).ok().filter(|&x| x < width)?;
        let cell = &mut grid[f * width + x];
        if *cell != u32::MAX {
            return None;
        }
        *cell = u32::try_from(i).ok()?;
    }
    let mut runs: Vec<Run> = Vec::new();
    for &i in grid.iter().filter(|&&i| i != u32::MAX) {
        let u = &tower.units[i as usize];
        if runs.last_mut().is_some_and(|r| r.take(u)) {
            continue;
        }
        runs.push(Run::start(u));
    }
    Some(runs)
}

/// The runs as `structure_view` writes them, from the walk with `limit` (so
/// a test reads the walk's path with `usize::MAX` and the grid's with 0).
#[cfg(test)]
pub(super) fn run_records(tower: &Tower, limit: usize) -> Vec<f64> {
    let mut v = Vec::new();
    for run in tile_runs(tower, limit) {
        run.push(&mut v);
    }
    v
}

/// The structural snapshot as one flat number array.
///
/// Header (`STRUCTURE_HEADER` slots): the tower revision, the room count, the
/// run count, the shaft count, the highest and the lowest floor any unit
/// stands on with floor 1 always counted (so 1 on an empty tower), read from
/// the tower's cached floor bounds (`Tower::floor_bounds`, which
/// `highest_floor` and `lowest_floor` answer from), then the game mode and
/// the Modern calendar as codes
/// (`layout::MODES`, `layout::CALENDARS`), fixed when the tower was founded
/// and carried here so a host reads them with the structure it reads at
/// load. Then the rooms (`ROOM_RECORD` each: id,
/// kind code, floor, x, width), in the order of the rooms index: the room in
/// slot k is the one a dynamic frame's record with slot k describes. Then the
/// floor and lobby tiles as runs (`RUN_RECORD` each: kind code, floor, x,
/// width, count, then the five frame fields every tile of the run holds),
/// ordered by floor and then x, so every tile is in exactly one run, and
/// maximal: no run continues the one before it. A run carries no ids: a host that needs a tile's id asks for the unit at its
/// floor and x. Then every transport (`SHAFT_FIXED` plus its skipped floors:
/// id, kind code, x, width, bottom, top, cars, the skip count, then the
/// skipped floors as the save carries them).
///
/// A field belongs here only if every write to it moves the revision. The
/// tiles' frame fields are here on the strength of the view freshness test
/// (`oracle_tests.rs`), which fails if one changes with the revision still.
///
/// A host reads it when it starts on an engine (a load or an attach builds a
/// new tower, whose revision starts over) and whenever the frame header's
/// tower revision moves. The unit count, which the dynamic frame's reader
/// also keys on, moves only with the revision.
///
/// One pass over the units (the runs) and one over the rooms index, plus a
/// sort of the runs when a floor was built in several drags (at most
/// `run_limit` of them; a list more scattered than that is read off the
/// grid in one more pass); the floor bounds and the rooms index are the
/// tower's per-revision caches, shared with every other reader. The output
/// is allocated once, after the walk, at its size. A read for each
/// revision, too slow for each frame.
pub fn structure_view(sim: &Simulation) -> Vec<f64> {
    let tower = &sim.tower;
    let rooms = tower.room_index();
    let skips: usize = tower
        .transports
        .iter()
        .map(|t| t.skip_floors.as_ref().map_or(0, Vec::len))
        .sum();
    let runs = tile_runs(tower, run_limit(tower));
    let (low, high) = tower.floor_bounds();
    let mut v = Vec::with_capacity(
        STRUCTURE_HEADER
            + rooms.len() * ROOM_RECORD
            + runs.len() * RUN_RECORD
            + tower.transports.len() * SHAFT_FIXED
            + skips,
    );
    v.extend_from_slice(&[
        tower.revision as f64,
        rooms.len() as f64,
        runs.len() as f64,
        tower.transports.len() as f64,
        high as f64,
        low as f64,
        mode_code(sim.mode),
        calendar_code(sim.modern_calendar),
    ]);
    for &i in rooms.iter() {
        let u = &tower.units[i];
        v.extend_from_slice(&[
            u.id as f64,
            u.kind as usize as f64,
            u.floor as f64,
            u.x as f64,
            u.width as f64,
        ]);
    }
    for run in &runs {
        run.push(&mut v);
    }
    for t in &tower.transports {
        let skip = t.skip_floors.as_deref().unwrap_or(&[]);
        v.extend_from_slice(&[
            t.id as f64,
            t.kind as usize as f64,
            t.x as f64,
            t.width as f64,
            t.bottom as f64,
            t.top as f64,
            t.cars as f64,
            skip.len() as f64,
        ]);
        v.extend_from_slice(skip);
    }
    v
}

/// A game mode's code: its index in `layout::MODES`.
pub(crate) fn mode_code(mode: GameMode) -> f64 {
    match mode {
        GameMode::Classic => 0.0,
        GameMode::Modern => 1.0,
    }
}

/// A Modern calendar's code: its index in `layout::CALENDARS`.
pub(crate) fn calendar_code(calendar: CalendarKind) -> f64 {
    match calendar {
        CalendarKind::Canon => 0.0,
        CalendarKind::RealWorld => 1.0,
    }
}
