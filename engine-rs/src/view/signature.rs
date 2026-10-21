//! The tower signature: undo's per-command fingerprint. Today undo
//! fingerprints the TypeScript instance with `towerStateSig`
//! (`src/engine/UndoHistory.ts`) at a gesture's capture and commit, and
//! drops the step when the two match. The signature answers the same
//! question for the tower half of that string, as a number: it is a pure
//! read of the fields `towerStateSig` reads, so a capture and a commit
//! compare equal when those fields are equal, whatever was read in between.
//! Money, the other half, stays a value compare beside it, since income
//! moves it every tick and the view's header carries it (compare it as the
//! string prints it: `Object.is`, so a NaN equals a NaN). `stateDigest` would
//! answer too, but it costs about 108 ms on the large tower.
use crate::sim::Simulation;
use crate::tower::Tower;

impl Simulation {
    /// The tower signature (see the module docs): read it at a gesture's
    /// capture and at its commit, beside money, and the step changed the
    /// tower if and only if the two differ. Equal fields always give equal
    /// signatures; a change to one field always gives a different one (each
    /// step of the hash is a bijection), and any other change does but for a
    /// 64-bit collision. One pass over units and transports per read, so it
    /// is a per-command read, never a per-frame one.
    pub fn tower_signature(&self) -> u64 {
        fingerprint(&self.tower)
    }
}

/// A 64-bit multiply-rotate hash over the fields, written word by word.
/// Deterministic and seedless: it is compared only with itself in the same
/// engine, and never saved or hashed.
struct Fingerprint(u64);

impl Fingerprint {
    const K: u64 = 0x9e37_79b9_7f4a_7c15;

    fn word(&mut self, w: u64) {
        self.0 = (self.0.rotate_left(5) ^ w).wrapping_mul(Self::K);
    }

    fn int(&mut self, n: i64) {
        self.word(n as u64);
    }

    /// A number as `towerStateSig` prints it: `-0` prints as `0`, and every
    /// NaN as `NaN`.
    fn num(&mut self, x: f64) {
        let x = if x == 0.0 { 0.0 } else { x };
        self.word(if x.is_nan() {
            f64::NAN.to_bits()
        } else {
            x.to_bits()
        });
    }

    /// An optional value, tagged so an absent one differs from any present.
    fn opt<T>(&mut self, v: Option<T>, f: impl FnOnce(&mut Self, T)) {
        match v {
            None => self.word(0),
            Some(t) => {
                self.word(1);
                f(self, t);
            }
        }
    }

    fn text(&mut self, s: &str) {
        let bytes = s.as_bytes();
        self.word(bytes.len() as u64);
        let mut chunks = bytes.chunks_exact(8);
        for c in &mut chunks {
            self.word(u64::from_le_bytes(c.try_into().unwrap()));
        }
        let rest = chunks.remainder();
        if !rest.is_empty() {
            let mut last = [0u8; 8];
            last[..rest.len()].copy_from_slice(rest);
            self.word(u64::from_le_bytes(last));
        }
    }

    /// A list as `towerStateSig` joins it: an absent list reads as an empty
    /// one.
    fn list<T: Copy>(&mut self, v: Option<&[T]>, f: impl Fn(&mut Self, T)) {
        let v = v.unwrap_or(&[]);
        self.word(v.len() as u64);
        for &x in v {
            f(self, x);
        }
    }
}

/// The fields `towerStateSig` reads, in its order: per unit its kind, floor,
/// x, label, rent, No Rate flag, film policy and subtype; per transport its
/// kind, x, bottom, top, cars, skipped floors and schedule (`schedSig`'s
/// five player-set fields).
fn fingerprint(tower: &Tower) -> u64 {
    let mut h = Fingerprint(0);
    h.word(tower.units.len() as u64);
    for u in &tower.units {
        h.word(u.kind as u64);
        h.int(u.floor);
        h.int(u.x);
        h.text(&u.label);
        h.opt(u.rent, Fingerprint::num);
        h.word(u.no_rate as u64);
        h.opt(u.film_policy, Fingerprint::text);
        h.opt(u.subtype, Fingerprint::text);
    }
    h.word(tower.transports.len() as u64);
    for t in &tower.transports {
        h.word(t.kind as u64);
        h.int(t.x);
        h.int(t.bottom);
        h.int(t.top);
        h.int(t.cars);
        h.list(t.skip_floors.as_deref(), Fingerprint::num);
        h.opt(t.schedule.as_ref(), |h, s| {
            h.list(s.weekday.as_deref(), Fingerprint::int);
            h.list(s.weekend.as_deref(), Fingerprint::int);
            h.opt(s.waiting_car_response, Fingerprint::num);
            h.opt(s.standard_floor_departure, Fingerprint::num);
            h.list(s.home_floors.as_deref(), Fingerprint::int);
        });
    }
    h.0
}
