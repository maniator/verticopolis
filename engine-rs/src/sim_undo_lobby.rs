//! The lobby rule of the ground a step leaves (`sim_undo_ground.rs`): a
//! step that takes out ground-floor lobby tiles leaves nothing laid since
//! hanging from them.
use super::{Ground, GROUND_FLOOR};
use crate::crowd::fasthash::{FastMap, FastSet};
use crate::facilities::{Kind, LOT_WIDTH};

impl Ground<'_> {
    /// Whether the ground floor and the basement still hang from the tower once
    /// the step takes out its ground-floor lobby tiles. A tile there hangs from
    /// a tile beside, above or below it, as its build asked
    /// (`Tower::is_supported`). The lobby tiles, and the ground-floor and
    /// basement tiles the step takes out that touch them through each other,
    /// are one piece the step takes away. The ground-floor and basement tiles
    /// that hold beside, above or below it once the step applies form runs
    /// through each other (`walk_run`), and the piece's root is the oldest
    /// ground-floor tile of their part (`root_of`): in play the tower's first
    /// lobby tile, which no sale takes out, unless a sale parted the ground
    /// floor. A run with a tile built since the piece must reach that root,
    /// when it is older than the piece; a run all built before the piece hung
    /// from something else and is left as it was. One run with a ground-floor
    /// lobby tile may stand on its own, as a tower's first lobby tile does,
    /// where no older ground-floor tile of the part stays, nor comes back with
    /// the step outside that run; no other run with a tile built since may be
    /// left then. No sale takes a lobby tile out, so this rule is the check's
    /// own; a floor tile taken out without one keeps to the sale's rule
    /// (`Tower::removal_reason`), which lets what it held go.
    pub(crate) fn lobbies_leave_nothing_hanging(&self) -> bool {
        if self.lobbies_taken.is_empty() {
            return true;
        }
        // The tiles the step takes out on the ground floor and below, as
        // (floor, x), which the piece may grow into.
        let low: FastSet<(i64, i64)> = self
            .taken
            .iter()
            .filter(|&&(_, floor)| floor <= GROUND_FLOOR)
            .map(|&(x, floor)| (floor, x))
            .collect();
        let mut piece: Vec<(i64, i64)> = self
            .lobbies_taken
            .iter()
            .map(|&x| (GROUND_FLOOR, x))
            .collect();
        let mut in_piece: FastSet<(i64, i64)> = piece.iter().copied().collect();
        let mut left_beside = Vec::new();
        let mut next = 0;
        while let Some(&tile) = piece.get(next) {
            next += 1;
            for near in beside(tile).into_iter().filter(|&(f, _)| f <= GROUND_FLOOR) {
                if low.contains(&near) {
                    if in_piece.insert(near) {
                        piece.push(near);
                    }
                } else if self.holds(near.0, near.1) {
                    left_beside.push(near);
                }
            }
        }
        let structure = &self.tower.structure;
        let Some(&oldest) = piece.iter().filter_map(|tile| structure.get(tile)).min() else {
            return true;
        };
        let mut runs = Runs::default();
        let starts: Vec<usize> = left_beside
            .into_iter()
            .map(|start| {
                runs.of(start)
                    .unwrap_or_else(|| self.walk_run(start, oldest, &low, &mut runs))
            })
            .collect();
        if runs.found.iter().all(|run| !run.built_since) {
            return true;
        }
        let (root, laid_in_part) = self.root_of(&runs, &in_piece);
        let root = root.filter(|&(id, _)| id < oldest);
        // A ground-floor tile older than the piece that the step lays again
        // where a bridge joined the runs' part counts as left, as one that
        // stays there would, though it is never the root (#1843), so no run
        // stands as a first. One the step lays in a run is `stands_first`'s to
        // judge. In play every tile an undo lays is older than the piece; only
        // a redo or tooling can lay a newer one.
        let older_laid = laid_in_part.is_some_and(|id| id < oldest);
        // Whether a run has been offered the place of the tower's first.
        let mut offered = false;
        let mut judged = vec![false; runs.found.len()];
        starts.into_iter().all(|index| {
            // A run is judged once, where its first tile beside the piece
            // comes, and a no ends the check.
            if std::mem::replace(&mut judged[index], true) {
                return true;
            }
            let run = &runs.found[index];
            let reaches = root.is_some_and(|(_, x)| runs.of((GROUND_FLOOR, x)) == Some(index));
            let founds = || root.is_none() && !older_laid && run.on_lobby;
            reaches
                || !run.built_since
                || (founds() && self.stands_first(oldest, index, &runs, &mut offered))
        })
    }

    /// Walks the run of ground-floor and basement tiles that hold from
    /// `start`, through tiles beside, above or below each other (a story
    /// above joins nothing the ground floor under it does not), into `runs`
    /// as a new run, and answers its index. Each tile is walked once.
    fn walk_run(
        &self,
        start: (i64, i64),
        oldest: i64,
        low: &FastSet<(i64, i64)>,
        runs: &mut Runs,
    ) -> usize {
        let index = runs.found.len();
        let mut run = Run::default();
        // The tiles met so far, in order; those before `next` are walked.
        let mut met = vec![start];
        runs.run_of.insert(start, index);
        let mut next = 0;
        while let Some(&(floor, x)) = met.get(next) {
            next += 1;
            // The walk meets only tiles that hold, so each has its unit;
            // were one missing, the tile would count as built since.
            let (id, kind) = self.built_by((floor, x)).unwrap_or((i64::MAX, Kind::Floor));
            run.built_since |= id > oldest;
            if floor == GROUND_FLOOR {
                run.on_lobby |= kind == Kind::Lobby;
                // A tile the step lays is never a root, since the check
                // does not yet ask what it hangs from (#1843).
                let stays = !self.laid.contains_key(&(floor, x));
                if stays && run.oldest_ground.is_none_or(|(old, _)| id < old) {
                    run.oldest_ground = Some((id, x));
                }
            }
            // A bridge joins only where the run's tile stood before the step:
            // a tile the step does not lay stays, so it stood, and one it lays
            // stood only where the tower had a tile.
            let stood = !self.laid.contains_key(&(floor, x))
                || self.tower.structure.contains_key(&(floor, x));
            for tile in beside((floor, x))
                .into_iter()
                .filter(|&(f, _)| f <= GROUND_FLOOR)
            {
                if !self.holds(tile.0, tile.1) {
                    if stood && low.contains(&tile) {
                        runs.bridges.push(tile);
                    }
                } else if runs.of(tile).is_none() {
                    runs.run_of.insert(tile, index);
                    met.push(tile);
                }
            }
        }
        runs.found.push(run);
        index
    }

    /// The id and x of the root of the piece's part, with the oldest id of a
    /// ground-floor tile the step lays beside the tiles the flood meets (a
    /// bridge is never one, since the step takes it out). The root is the
    /// oldest ground-floor tile that stays in the runs beside the piece, or in
    /// what the step's other taken tiles beside them (`Runs::bridges`) joined
    /// to them through the tower's ground-floor and basement tiles before the
    /// step, flooded here once. A tile the step lays is never the root (#1843).
    /// Where the tower has no tile before the step, the flood crosses none and
    /// a bridge joins none: a tile the step lays there was out all the time
    /// since the edits it undoes, so nothing built since hung from it. The runs
    /// share one root, so where the piece, or a tile the step lays again beside
    /// it, joined parts a sale had divided, a run in a part without the oldest
    /// root counts as cut off from it, which only refuses more (#1848).
    fn root_of(
        &self,
        runs: &Runs,
        in_piece: &FastSet<(i64, i64)>,
    ) -> (Option<(i64, i64)>, Option<i64>) {
        let structure = &self.tower.structure;
        let mut root = runs.found.iter().filter_map(|run| run.oldest_ground).min();
        let mut oldest_laid: Option<i64> = None;
        let mut seen: FastSet<(i64, i64)> = FastSet::default();
        let mut met: Vec<(i64, i64)> = runs
            .bridges
            .iter()
            .copied()
            .filter(|&tile| !in_piece.contains(&tile) && seen.insert(tile))
            .collect();
        let mut next = 0;
        while let Some(&tile) = met.get(next) {
            next += 1;
            let stays = structure
                .get(&tile)
                .filter(|&id| !self.leaving.contains(id));
            if let Some(&id) = stays.filter(|_| tile.0 == GROUND_FLOOR) {
                if root.is_none_or(|(old, _)| id < old) {
                    root = Some((id, tile.1));
                }
            }
            for near in beside(tile) {
                let new = !in_piece.contains(&near) && runs.of(near).is_none();
                if !new || near.0 > GROUND_FLOOR {
                    continue;
                }
                // A ground-floor tile the step lays beside the flood is noted
                // whether or not the tower had one there; the flood crosses
                // only the tower's tiles.
                if near.0 == GROUND_FLOOR {
                    if let Some(&(id, _)) = self.laid.get(&near) {
                        oldest_laid = Some(oldest_laid.map_or(id, |old| old.min(id)));
                    }
                }
                if structure.contains_key(&near) && seen.insert(near) {
                    met.push(near);
                }
            }
        }
        (root, oldest_laid)
    }

    /// Whether run `run`, with a ground-floor lobby tile, may stand on its own
    /// as the tower's first, once no ground-floor tile of the piece's part
    /// older than unit `oldest` stays, or comes back with the step outside the
    /// runs: no run has been offered the place before (`offered`), and no
    /// ground-floor tile older than that unit comes back with the step in
    /// another run beside the piece either.
    fn stands_first(&self, oldest: i64, run: usize, runs: &Runs, offered: &mut bool) -> bool {
        let first_offer = !*offered;
        *offered = true;
        first_offer
            && !(0..LOT_WIDTH).any(|x| {
                let tile = (GROUND_FLOOR, x);
                self.laid.get(&tile).is_some_and(|&(id, _)| {
                    id < oldest && runs.of(tile).is_some_and(|other| other != run)
                })
            })
    }
}

/// The runs of ground-floor and basement tiles a step leaves beside the
/// piece it takes away (`Ground::lobbies_leave_nothing_hanging`).
#[derive(Default)]
struct Runs {
    /// What each run holds, by its index.
    found: Vec<Run>,
    /// The run each tile walked, as (floor, x), is in.
    run_of: FastMap<(i64, i64), usize>,
    /// The tiles the step takes out beside a run's tiles that stood before
    /// the step, the piece's among them.
    bridges: Vec<(i64, i64)>,
}

impl Runs {
    /// The index of the run `tile` is in, once walked.
    fn of(&self, tile: (i64, i64)) -> Option<usize> {
        self.run_of.get(&tile).copied()
    }
}

/// What a run of ground-floor and basement tiles holds.
#[derive(Default)]
struct Run {
    /// Whether a tile of the run was built after the piece's oldest unit.
    built_since: bool,
    /// Whether the run has a ground-floor lobby tile.
    on_lobby: bool,
    /// The id and x of its oldest ground-floor tile that stays.
    oldest_ground: Option<(i64, i64)>,
}

/// The tiles beside `tile`, as (floor, x): left, right, below and above.
fn beside((floor, x): (i64, i64)) -> [(i64, i64); 4] {
    [
        (floor, x - 1),
        (floor, x + 1),
        (floor - 1, x),
        (floor + 1, x),
    ]
}
