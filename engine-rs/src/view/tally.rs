//! A running count of the population and the working recycling centers,
//! kept up from the tower's mark log the way the frame reader keeps its
//! population (`reader.rs`). The inspector's recycling reads answer from it
//! (`diagnostics/memo.rs`), and so does the scene sync's bin fill
//! (`towerReconcile.ts`, through `recyclingFill`), so a hover, a phone
//! refresh or a scene sync between edits visits the rooms marked since the
//! last read (or every room once, when the marks are many), and none when
//! nothing changed.
//!
//! Both counts read only marked fields: a room's census share reads its
//! state, residents and customers inside, and whether a recycling center
//! works reads its state (`marks_guard_tests.rs` holds the census share and
//! `is_operational` to marked fields and keeps engine code from writing a
//! kind, and `census_reads_tests.rs` reads their bodies and `share`'s). The
//! freshness test (`oracle_tests.rs`) checks the kept counts
//! against a fresh count after every step of the seeded sessions.
use std::sync::Arc;

use super::reader::compare_all;
use crate::facilities::Kind;
use crate::tower::{Tower, Unit};

/// The working recycling centers and the population.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RecyclingCounts {
    pub centers: i64,
    pub population: i64,
}

/// What one room adds to the counts.
#[derive(Clone, Copy)]
struct Share {
    census: i64,
    working_center: bool,
}

fn share(u: &Unit) -> Share {
    Share {
        census: u.census_share(),
        working_center: u.kind == Kind::Recycling && u.is_operational(),
    }
}

/// What a tally last counted: each unit's share by its index in `units`
/// (`None` for a floor or lobby tile, which the rooms index leaves out), the
/// rooms index those shares were counted from, the counts they sum to, what
/// they were counted against (the mark log's id, and the tower revision and
/// unit count the rooms index is keyed on), how far it has read the mark
/// log, and a buffer it reuses. A tally belongs to one simulation; one
/// handed another tower counts afresh, since the new tower's log has another
/// id.
#[derive(Default)]
pub struct CensusTally {
    keyed: Option<(u64, i64, usize)>,
    shares: Vec<Option<Share>>,
    counted: Option<Arc<[usize]>>,
    counts: RecyclingCounts,
    read: u64,
    marked: Vec<usize>,
    passes: Passes,
}

/// The ways through [`CensusTally::counts`].
#[derive(Clone, Copy)]
enum Way {
    /// A pass over the rooms index after the key moved.
    Full,
    /// A compare of every room, since the marks reached half the rooms.
    Compared,
    /// A compare of every room, since the log dropped marks this tally never
    /// read.
    Dropped,
    /// A visit to the marked units only.
    Marked,
}

/// What a tally keeps of the ways its reads took: a count of each in a test
/// build, so a test can tell which one ran, and nothing otherwise.
#[cfg(test)]
type Passes = TallyPasses;
#[cfg(not(test))]
type Passes = NoPasses;

/// How many reads took each [`Way`].
#[cfg(test)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct TallyPasses {
    pub full: u32,
    pub compared: u32,
    pub dropped: u32,
    pub marked: u32,
}

#[cfg(test)]
impl TallyPasses {
    fn count(&mut self, way: Way) {
        match way {
            Way::Full => self.full += 1,
            Way::Compared => self.compared += 1,
            Way::Dropped => self.dropped += 1,
            Way::Marked => self.marked += 1,
        }
    }
}

/// A build's stand-in for [`TallyPasses`] outside the tests, which keeps
/// nothing.
#[cfg(not(test))]
#[derive(Default)]
struct NoPasses;

#[cfg(not(test))]
impl NoPasses {
    fn count(&mut self, _: Way) {}
}

impl CensusTally {
    /// The counts for the tower as it stands.
    ///
    /// The first read, and a read after the revision, the unit count or the
    /// log's id moved, make one pass over the rooms index. Before it they
    /// clear the slots the last pass set, so the work follows the rooms,
    /// both passes' and any new units'; only the first read sizes one slot
    /// per unit. Any other read visits the units the mark
    /// log names since the last read, a constant amount of work each (a unit
    /// marked twice is visited twice, which changes nothing, so the marks
    /// need no sort); with nothing marked it visits no room. When the marks
    /// reach half the rooms, it compares every room once instead
    /// (`compare_all`), which then costs at most twice what the marks would.
    /// When the log has dropped marks this tally never read, the marks are
    /// lost, so it compares every room as well: one visit per room, whatever
    /// the number of marks. A write that skips the
    /// setters leaves its room unmarked, so it is not counted until a read
    /// next compares every room or makes a full pass, the frame reader's
    /// contract.
    pub fn counts(&mut self, tower: &Tower) -> RecyclingCounts {
        let rooms = tower.room_index();
        let marks = &tower.view.marks;
        let key = (marks.id(), tower.revision, tower.units.len());
        if self.keyed != Some(key) || self.shares.len() != tower.units.len() {
            // Only the slots the last pass set hold a share, so clearing
            // those leaves every slot empty, and the resize writes only a
            // grown tail.
            match self.counted.take() {
                Some(last) => {
                    for &i in last.iter() {
                        if let Some(slot) = self.shares.get_mut(i) {
                            *slot = None;
                        }
                    }
                }
                None => self.shares.clear(),
            }
            self.shares.resize(tower.units.len(), None);
            self.counts = RecyclingCounts::default();
            for &i in rooms.iter() {
                let s = share(&tower.units[i]);
                self.counts.population += s.census;
                self.counts.centers += i64::from(s.working_center);
                self.shares[i] = Some(s);
            }
            self.counted = Some(rooms.clone());
            self.passes.count(Way::Full);
        } else {
            let mut marked = std::mem::take(&mut self.marked);
            marked.clear();
            // The count decides first, so a read that compares every room
            // copies no mark.
            let way = match marks.unread(self.read) {
                None => Way::Dropped,
                Some(n) if compare_all(n, rooms.len()) => Way::Compared,
                Some(_) if marks.read_since(self.read, &mut marked) => Way::Marked,
                Some(_) => Way::Dropped,
            };
            if matches!(way, Way::Marked) {
                for &i in &marked {
                    self.update(i, &tower.units);
                }
            } else {
                for &i in rooms.iter() {
                    self.update(i, &tower.units);
                }
            }
            self.passes.count(way);
            self.marked = marked;
        }
        self.read = marks.end();
        self.keyed = Some(key);
        self.counts
    }

    /// How many reads took each way through [`Self::counts`].
    #[cfg(test)]
    pub(crate) fn passes(&self) -> TallyPasses {
        self.passes
    }

    /// Bring the room at index `i` in `units` up to date, correcting the
    /// counts by the change in its share. A floor or lobby tile, which has
    /// no share, is left alone.
    fn update(&mut self, i: usize, units: &[Unit]) {
        let (Some(Some(was)), Some(u)) = (self.shares.get(i).copied(), units.get(i)) else {
            return;
        };
        let now = share(u);
        self.shares[i] = Some(now);
        self.counts.population += now.census - was.census;
        self.counts.centers += i64::from(now.working_center) - i64::from(was.working_center);
    }
}
