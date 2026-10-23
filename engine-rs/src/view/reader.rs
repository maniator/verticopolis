//! The dynamic frame: what a view reads every rendered frame. The header,
//! the crowd's people and every transport's cars go in full each time; the
//! rooms go only when their frame fields changed since this reader's last
//! frame. The reader finds them by comparing over the rooms index, so it
//! never walks the floor and lobby tiles (their fields move only with the
//! revision, which the structural snapshot covers).
use std::sync::Arc;

use super::layout::{HEADER, PERSON_RECORD, UNIT_RECORD};
use crate::frame::{person_state_code, push_transports, transports_len, unit_fields, weather_code};
use crate::sim::Simulation;

/// The room records a reader last sent, by slot, the structure they were
/// sent against (the tower revision and unit count the rooms index is keyed
/// on), the frames it has written, and a buffer it reuses for the changed
/// rooms. A reader belongs to one simulation: a host that loads another
/// starts a new reader (the binding's lives on the tower, which every load
/// builds afresh).
///
/// This keeps the hot path simple and predictable: it compares the room slots
/// the host has already indexed, and it only emits the ones whose frame fields
/// changed. That is the measured tradeoff in this branch. The alternative is a
/// wider write-site dirty-mark rollout, which would need explicit owner
/// approval because it spreads a room-dirty signal through many game systems.
#[derive(Default)]
pub struct ViewReader {
    sent: Option<(i64, usize)>,
    last: Vec<[u64; 5]>,
    seq: u64,
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
    /// One pass over the rooms index (the compare and the population), and
    /// one allocation, made after that pass at the frame's size.
    pub fn frame(&mut self, sim: &Simulation, full: bool) -> Vec<f64> {
        let tower = &sim.tower;
        let rooms: Arc<[usize]> = tower.room_index();
        let key = (tower.revision, tower.units.len());
        let full = full || self.sent != Some(key) || self.last.len() != rooms.len();
        if full {
            self.last.clear();
            self.last.reserve(rooms.len());
        }
        self.changed.clear();
        let mut population = 0i64;
        for (slot, &i) in rooms.iter().enumerate() {
            let u = &tower.units[i];
            if u.is_present() {
                population += u.census_count();
            }
            let fields = unit_fields(u);
            let bits = fields.map(f64::to_bits);
            if full {
                self.last.push(bits);
            } else if self.last[slot] != bits {
                self.last[slot] = bits;
            } else {
                continue;
            }
            self.changed.push(slot as f64);
            self.changed.extend_from_slice(&fields);
        }
        self.sent = Some(key);
        self.seq += 1;
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
