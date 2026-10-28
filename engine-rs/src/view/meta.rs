//! Unit metadata: each unit's label and subtype. Neither moves
//! `tower.revision`, so they have their own revision, `tower.meta_revision`,
//! and one setter each that every engine write goes through (the save loader
//! and a new unit's construction aside). A setter that changes a value bumps
//! the revision and logs the unit's id, so a view fetches the metadata of
//! just the units that changed since its last read.
//!
//! Every tower starts at meta revision 1 with an empty log, so a host that
//! has read nothing yet (it passes no `since`, or 0) gets a full listing,
//! including the labels and subtypes a loaded save carried.
use serde_json::{json, Value};

use crate::tower::Tower;

/// The most ids the log holds before it drops its older half. A view reads
/// the log every frame the meta revision moves, so it never falls this far
/// behind in play; a reader that does gets a full listing.
pub(super) const LOG_CAP: usize = 4096;

/// The meta revision a tower starts at.
pub(crate) const FIRST_META_REVISION: i64 = 1;

/// The ids the setters changed, oldest first, each with the meta revision
/// its change made. `floor` is the oldest revision the log answers from: it
/// answers "what changed after `since`" only for `since >= floor`, which
/// starts at the tower's first meta revision and rises as the log drops
/// entries.
pub struct MetaLog {
    entries: Vec<(i64, i64)>,
    pub(super) floor: i64,
}

impl MetaLog {
    /// An empty log for a tower at its first meta revision.
    pub(crate) fn new() -> MetaLog {
        MetaLog {
            entries: Vec::new(),
            floor: FIRST_META_REVISION,
        }
    }

    fn push(&mut self, revision: i64, id: i64) {
        if self.entries.len() >= LOG_CAP {
            let drop = self.entries.len() / 2;
            self.floor = self.entries[drop - 1].0;
            self.entries.drain(..drop);
        }
        self.entries.push((revision, id));
    }

    /// The ids changed after `since`, oldest change first, each once, or
    /// `None` when the log no longer reaches back to `since`.
    fn since(&self, since: i64) -> Option<Vec<i64>> {
        if since < self.floor {
            return None;
        }
        let start = self.entries.partition_point(|&(rev, _)| rev <= since);
        let mut seen = std::collections::HashSet::new();
        Some(
            self.entries[start..]
                .iter()
                .map(|&(_, id)| id)
                .filter(|id| seen.insert(*id))
                .collect(),
        )
    }
}

impl Tower {
    /// Set the label of the unit at `i` in `units`, an index the caller
    /// holds. The one write path for a label besides the save loader and
    /// `place`, which gives a new unit its catalog name. Returns whether the
    /// label changed; only a change bumps `meta_revision` and logs the unit.
    pub(crate) fn set_unit_label_at(&mut self, i: usize, label: String) -> bool {
        let u = &mut self.units[i];
        if u.label == label {
            return false;
        }
        u.label = label;
        let id = u.id;
        self.note_meta(id);
        true
    }

    /// Set the subtype of the unit with this id: the one write path for a
    /// subtype besides the save loader. Returns whether it changed; only a
    /// change bumps `meta_revision` and logs the unit. False for an unknown
    /// id.
    pub(crate) fn set_unit_subtype(&mut self, id: i64, subtype: Option<&'static str>) -> bool {
        let Some(&i) = self.by_id.get(&id) else {
            return false;
        };
        let u = &mut self.units[i];
        if u.subtype == subtype {
            return false;
        }
        u.subtype = subtype;
        self.note_meta(id);
        true
    }

    /// `u.label = label`, the editor's rename: trimmed as JavaScript trims,
    /// an empty name falling back to the catalog name. False for an unknown
    /// id; true otherwise, the name unchanged included.
    pub fn set_label(&mut self, id: i64, label: &str) -> bool {
        let Some(&i) = self.by_id.get(&id) else {
            return false;
        };
        let trimmed = crate::load::js_trim(label);
        let name = if trimmed.is_empty() {
            self.units[i].kind.facility().name.to_string()
        } else {
            trimmed.to_string()
        };
        self.set_unit_label_at(i, name);
        true
    }

    fn note_meta(&mut self, id: i64) {
        self.meta_revision += 1;
        self.view.meta_log.push(self.meta_revision, id);
    }
}

/// One unit's metadata as the listing carries it: `[id, label, subtype]`,
/// the subtype `null` when the unit has none.
fn record(id: i64, label: &str, subtype: Option<&str>) -> Value {
    json!([id, label, subtype])
}

/// A meta revision read from a raw JavaScript number: a whole number from 0
/// up to 2^53, or `None` for anything else (a fraction, a negative, NaN, an
/// infinity, a number past exact integers, or no number at all), which
/// `meta_since` answers with a full listing.
pub fn whole_revision(raw: Option<f64>) -> Option<i64> {
    const EXACT: f64 = 9_007_199_254_740_992.0;
    raw.filter(|s| s.fract() == 0.0 && (0.0..=EXACT).contains(s))
        .map(|s| s as i64)
}

/// The metadata a view needs after `since`, as
/// `{ "revision", "full", "units": [[id, label, subtype], ...] }`
/// (`layout::META_RECORD` names the record's fields).
///
/// For a `since` the log can answer (from the log's floor up to
/// `meta_revision`), `full` is false and `units` lists every unit changed
/// after it that still exists, once each, with its current values. For any
/// other `since` (`None`, a revision this tower never reached, or one older
/// than the log answers from, 0 included), `full` is true and `units` lists
/// every unit whose label differs from its catalog name or that has a
/// subtype, in unit-list order: a unit it leaves out has its catalog name and
/// no subtype. `revision` is `meta_revision`, the `since` of the next read.
/// A removed unit is never listed, and an id is never given to another unit
/// (`Tower::next_id` only grows), so what a host still holds for a removed
/// id goes unused. A `since` belongs to one engine: a load or an attach
/// builds a tower that starts again at revision 1, so a host on a new
/// engine asks with nothing or 0, as it reads a fresh structure.
pub fn meta_since(tower: &Tower, since: Option<i64>) -> Value {
    let (full, ids) = meta_changed(tower, since);
    let units: Vec<Value> = ids
        .iter()
        .filter_map(|id| tower.get_unit(*id))
        .map(|u| record(u.id, &u.label, u.subtype))
        .collect();
    json!({
        "revision": tower.meta_revision,
        "full": full,
        "units": units,
    })
}

/// The ids `meta_since` lists, with whether the listing is full: the units
/// changed after `since` when the log still reaches it, else every unit
/// whose label or subtype is not its kind's default.
pub fn meta_changed(tower: &Tower, since: Option<i64>) -> (bool, Vec<i64>) {
    let reachable = since.filter(|&s| s <= tower.meta_revision);
    match reachable.and_then(|s| tower.view.meta_log.since(s)) {
        Some(ids) => (
            false,
            ids.into_iter()
                .filter(|id| tower.get_unit(*id).is_some())
                .collect(),
        ),
        None => (
            true,
            tower
                .units
                .iter()
                .filter(|u| u.subtype.is_some() || u.label != u.kind.facility().name)
                .map(|u| u.id)
                .collect(),
        ),
    }
}
