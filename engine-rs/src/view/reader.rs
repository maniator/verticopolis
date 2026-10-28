//! The dynamic frame: what a view reads every rendered frame. The header,
//! the crowd's people and every transport's cars go in full each time; the
//! rooms go only when their frame fields changed since this reader's last
//! frame. The reader finds them in the tower's mark log (`marks.rs`), which
//! the setters of those fields write, so a frame visits only the rooms that
//! changed (a full frame aside) and no floor or lobby tile (their fields
//! move only with the revision, which the structural snapshot covers).
use std::sync::Arc;

use super::layout::{HEADER, PERSON_RECORD, UNIT_RECORD};
use crate::frame::{person_state_code, push_transports, transports_len, unit_fields, weather_code};
use crate::sim::Simulation;
use crate::tower::Unit;

/// What a reader last sent, by slot: each room's frame fields (as bits) and
/// its census share, with their sum, the population. Also what they were
/// sent against (the mark log's id, and the tower revision and unit count
/// the rooms index is keyed on), how far it has read the mark log, the
/// frames it has written, and buffers it reuses. A reader belongs to one
/// simulation: a host that loads another starts a new reader (the binding's
/// lives on the tower, which every load builds afresh); one handed another
/// tower sends a full frame, since the new tower's log has another id.
#[derive(Default)]
pub struct ViewReader {
    sent: Option<(u64, i64, usize)>,
    last: Vec<[u64; 5]>,
    census: Vec<i64>,
    population: i64,
    read: u64,
    seq: u64,
    marked: Vec<usize>,
    changed: Vec<f64>,
}

impl ViewReader {
    /// A reader that has sent nothing, so its first frame is full.
    pub fn new() -> ViewReader {
        ViewReader::default()
    }

    /// The dynamic frame as one flat number array.
    ///
    /// Header (`HEADER` slots, see `layout::header`): minutes, tower
    /// revision, meta revision, meal overlay revision, logSeq, money, star,
    /// the unlocked kinds (bit k set when the kind with code k is unlocked),
    /// the population (as `Simulation::population` counts it), weather, the
    /// Santa, explosion, thief, treasure and VIP effects and the event
    /// counts as `frameView` carries them, a pending choice (0 or 1),
    /// onHourRuns, the room count the slots index, the full flag, this
    /// reader's frame number (1 for its first), then the people, room record
    /// and transport counts.
    ///
    /// Then `people` records of `PERSON_RECORD`, every person in the crowd
    /// as `frameView` sends them: id, seed, staff (0 or 1), state, floor, x,
    /// fy, wait. Then `units` room records of `UNIT_RECORD`:
    /// the room's slot (its position in the structural snapshot's room list),
    /// then state, occupants, customersIn, hotelCustomersIn, outForMeal (an
    /// absent counter is -1). Then every transport as `frameView` writes it.
    ///
    /// The room records are every room, in slot order, with the full flag
    /// set, when `full` is true, on this reader's first frame, or when the
    /// revision or the unit count moved since its last frame (the slots then
    /// index a new structure). Otherwise they are the rooms whose fields
    /// changed since its last frame, in slot order, a field compared bit for
    /// bit.
    ///
    /// A full frame makes one pass over the rooms index, which happens once
    /// per revision move (a command), on a new tower, or when the host asks.
    /// Any other frame visits the rooms the mark log names since this
    /// reader's last frame, each once, plus a binary search of the rooms
    /// index for each; with nothing marked it visits no room. When the marks
    /// it reads reach half the rooms (an hour can mark nearly all of them),
    /// or the log has dropped marks this reader never read (it fell more than
    /// `MARK_CAP` marks behind), the frame compares every room once instead,
    /// which sends the same rooms for less (`compare_all`). The population
    /// is a running total that each visited room corrects. One allocation,
    /// made at the frame's size.
    ///
    /// The engine's own writes go through the setters, which mark the room.
    /// A native host that writes a unit's frame fields or residents itself,
    /// outside the commands and the tick, leaves the room unmarked, so its
    /// next frame passes `full`.
    pub fn frame(&mut self, sim: &Simulation, full: bool) -> Vec<f64> {
        let tower = &sim.tower;
        let rooms: Arc<[usize]> = tower.room_index();
        let marks = &tower.view.marks;
        let key = (marks.id(), tower.revision, tower.units.len());
        let full = full || self.sent != Some(key) || self.last.len() != rooms.len();
        self.changed.clear();
        if full {
            self.last.clear();
            self.last.reserve(rooms.len());
            self.census.clear();
            self.census.reserve(rooms.len());
            self.changed.reserve(rooms.len() * UNIT_RECORD);
            self.population = 0;
            for (slot, &i) in rooms.iter().enumerate() {
                let u = &tower.units[i];
                let fields = unit_fields(u);
                self.last.push(fields.map(f64::to_bits));
                let census = u.census_share();
                self.census.push(census);
                self.population += census;
                self.changed.push(slot as f64);
                self.changed.extend_from_slice(&fields);
            }
        } else {
            let mut marked = std::mem::take(&mut self.marked);
            marked.clear();
            // The count decides first, so a frame that compares every room
            // copies no mark.
            let few = marks
                .unread(self.read)
                .is_some_and(|n| !compare_all(n, rooms.len()));
            if few && marks.read_since(self.read, &mut marked) {
                // Unit-list order is the rooms index's order, so sorted
                // indices give the slots in order.
                marked.sort_unstable();
                marked.dedup();
                for &i in &marked {
                    if let Ok(slot) = rooms.binary_search(&i) {
                        self.update(slot, &tower.units[i]);
                    }
                }
            } else {
                for (slot, &i) in rooms.iter().enumerate() {
                    self.update(slot, &tower.units[i]);
                }
            }
            self.marked = marked;
        }
        self.read = marks.end();
        self.sent = Some(key);
        self.seq += 1;
        let population = self.population;
        let people = &sim.crowd.people;
        let size = HEADER
            + people.len() * PERSON_RECORD
            + self.changed.len()
            + transports_len(&tower.transports);
        let mut v = Vec::with_capacity(size);
        let fx = &sim.fx;
        v.extend_from_slice(&[
            sim.clock.minutes,
            tower.revision as f64,
            tower.meta_revision as f64,
            tower.meal_overlay_revision as f64,
            sim.log_seq as f64,
            sim.money,
            sim.star as f64,
            unlocked_mask(sim),
            population as f64,
            weather_code(sim.weather),
            fx.santa_seq as f64,
            fx.explosion.seq as f64,
            fx.explosion.floor as f64,
            fx.explosion.x,
            fx.thief.seq as f64,
            if fx.thief.caught { 1.0 } else { 0.0 },
            fx.thief.floor as f64,
            fx.treasure.seq as f64,
            fx.treasure.floor as f64,
            fx.treasure.x,
            fx.vip_seq as f64,
            sim.events.fires_started as f64,
            sim.events.fires_gut_rooms as f64,
            sim.events.bombs_detonated as f64,
            if sim.events.pending.is_some() {
                1.0
            } else {
                0.0
            },
            sim.on_hour_runs as f64,
            rooms.len() as f64,
            if full { 1.0 } else { 0.0 },
            self.seq as f64,
            people.len() as f64,
            (self.changed.len() / UNIT_RECORD) as f64,
            tower.transports.len() as f64,
        ]);
        debug_assert_eq!(v.len(), HEADER);
        for p in people {
            v.extend_from_slice(&[
                p.id as f64,
                p.seed as f64,
                if p.staff { 1.0 } else { 0.0 },
                person_state_code(p.state),
                p.floor as f64,
                p.x,
                p.fy,
                p.wait,
            ]);
        }
        v.extend_from_slice(&self.changed);
        push_transports(&mut v, &tower.transports);
        debug_assert_eq!(v.len(), size);
        v
    }

    /// Bring the room in `slot` up to date: correct the population by the
    /// change in its census, and queue its record when a frame field
    /// changed, compared bit for bit.
    fn update(&mut self, slot: usize, u: &Unit) {
        let census = u.census_share();
        self.population += census - self.census[slot];
        self.census[slot] = census;
        let fields = unit_fields(u);
        let bits = fields.map(f64::to_bits);
        let last = &mut self.last[slot];
        if (0..5).any(|k| bits[k] != last[k]) {
            *last = bits;
            self.changed.push(slot as f64);
            self.changed.extend_from_slice(&fields);
        }
    }
}

/// Whether a frame that read `marks` marks (repeats counted, before the
/// sort) compares every room instead of finding each marked one. From
/// about half the rooms the sort and a binary search per mark cost more
/// than one compare over the rooms. The review measured two frames after an
/// hour on the large tower (2,900 rooms): 2,886 marks cost 875K
/// instructions on the marks and 489K with this threshold, the compare's
/// cost; 1,377 marks cost 406.6K on the marks against 339.4K for a compare.
/// The compare's cost moves with the rooms that changed, so no one share of
/// the rooms breaks even on every frame, and just below half the marks cost
/// up to 1.2 times a compare on the frames measured. Both branches send the
/// same rooms, since every write of a frame field marks.
pub(super) fn compare_all(marks: usize, rooms: usize) -> bool {
    marks * 2 >= rooms
}

/// The unlocked kinds as a bitmask by kind code: bit k is set when the kind
/// with code k (`Kind as usize`) is unlocked (`Simulation::is_unlocked`).
/// A double holds 53 bits exactly, and `layout_tests.rs` keeps the catalog
/// inside them.
fn unlocked_mask(sim: &Simulation) -> f64 {
    let mut mask = 0u64;
    for (k, f) in crate::facilities::FACILITIES.iter().enumerate() {
        if sim.is_unlocked(f.kind) {
            mask |= 1 << k;
        }
    }
    mask as f64
}
