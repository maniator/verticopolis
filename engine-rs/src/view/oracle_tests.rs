//! The view freshness test: a view kept the way a host keeps it (the
//! structure refetched only when the tower revision moves, the metadata
//! only when the meta revision moves, the rooms patched from each frame's
//! changed records) equals a fresh read after every step of the seeded
//! sessions, and every fresh read decodes back to the tower it came from.
//!
//! The structure comparison is the proof that the floor and lobby tiles'
//! frame fields move only with the revision: the kept structure carries
//! them as they stood at its revision, so a tile whose fields changed
//! without a revision fails it.
use std::collections::HashMap;

use super::layout::{
    header, room, run, shaft, structure, unit, HEADER, PERSON_RECORD, ROOM_RECORD, RUN_RECORD,
    SHAFT_FIXED, STRUCTURE_HEADER, UNIT_RECORD,
};
use super::session_tests::{run as run_session, starts};
use super::signature_tests::ts_sig;
use super::*;
use crate::frame::{transports_len, unit_fields};
use crate::tower::Tower;
use sha2::{Digest, Sha256};

/// Bitwise equality, so a NaN equals itself and a `-0` is not a `0`.
pub(super) fn same(a: &[f64], b: &[f64]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits())
}

/// The metadata a host holds: the units a listing named, by id.
type Meta = HashMap<i64, (String, Option<String>)>;

fn apply_meta(meta: &mut Meta, doc: &serde_json::Value) {
    if doc["full"] == true {
        meta.clear();
    }
    for r in doc["units"].as_array().unwrap() {
        let id = r[0].as_i64().unwrap();
        let label = r[1].as_str().unwrap().to_string();
        let subtype = r[2].as_str().map(str::to_string);
        meta.insert(id, (label, subtype));
    }
}

/// A view kept between reads, as a host keeps it, and how many of its reads
/// took the incremental paths.
struct Kept {
    structure: Vec<f64>,
    reader: ViewReader,
    seq: f64,
    rooms: Vec<[f64; 5]>,
    meta_revision: f64,
    meta: Meta,
    delta_frames: usize,
    meta_deltas: usize,
}

impl Kept {
    fn new(sim: &Simulation) -> Kept {
        decode_structure(sim, &structure_view(sim), "the first structure");
        let mut kept = Kept {
            structure: structure_view(sim),
            reader: ViewReader::new(),
            seq: 0.0,
            rooms: Vec::new(),
            meta_revision: f64::NAN,
            meta: Meta::new(),
            delta_frames: 0,
            meta_deltas: 0,
        };
        kept.read(sim);
        kept
    }

    /// One rendered frame's reads.
    fn read(&mut self, sim: &Simulation) {
        let frame = self.reader.frame(sim, false);
        assert_eq!(frame[header::FRAME_SEQ], self.seq + 1.0, "frames count up");
        self.seq += 1.0;
        if frame[header::TOWER_REVISION] != self.structure[structure::REVISION] {
            self.structure = structure_view(sim);
            decode_structure(sim, &self.structure, "a refetched structure");
        }
        let units = frame[header::UNITS] as usize;
        let at = HEADER + frame[header::PEOPLE] as usize * PERSON_RECORD;
        let full = frame[header::FULL] == 1.0;
        if full {
            assert_eq!(
                units,
                frame[header::ROOMS] as usize,
                "a full frame sends every room"
            );
            self.rooms.clear();
        } else if units > 0 {
            self.delta_frames += 1;
        }
        let mut last_slot = -1.0;
        for k in 0..units {
            let r = &frame[at + k * UNIT_RECORD..at + (k + 1) * UNIT_RECORD];
            let slot = r[unit::SLOT];
            assert!(slot > last_slot, "room records go in slot order");
            last_slot = slot;
            let fields: [f64; 5] = r[unit::STATE..].try_into().unwrap();
            if full {
                assert_eq!(slot as usize, k, "a full frame sends every slot");
                self.rooms.push(fields);
            } else {
                let was = &mut self.rooms[slot as usize];
                assert!(!same(was, &fields), "slot {slot} sent unchanged");
                *was = fields;
            }
        }
        if frame[header::META_REVISION] != self.meta_revision {
            let since = whole_revision(Some(self.meta_revision));
            let doc = meta_since(&sim.tower, since);
            if doc["full"] == false && !doc["units"].as_array().unwrap().is_empty() {
                self.meta_deltas += 1;
            }
            apply_meta(&mut self.meta, &doc);
            self.meta_revision = doc["revision"].as_f64().unwrap();
        }
    }

    /// The kept view equals a fresh one and says what the tower holds. The
    /// structure is decoded against the tower when it is fetched; equal to
    /// a fresh one, it still holds.
    fn check(&self, sim: &Simulation, what: &str) {
        let fresh_structure = structure_view(sim);
        assert!(
            same(&self.structure, &fresh_structure),
            "{what}: the structure kept at revision {} differs from a fresh one at revision {}",
            self.structure[structure::REVISION],
            sim.tower.revision
        );
        let fresh = ViewReader::new().frame(sim, true);
        let rooms = sim.tower.room_index();
        assert_eq!(self.rooms.len(), rooms.len(), "{what}: room count");
        let at = HEADER + fresh[header::PEOPLE] as usize * PERSON_RECORD;
        for (slot, &i) in rooms.iter().enumerate() {
            let r = &fresh[at + slot * UNIT_RECORD..at + (slot + 1) * UNIT_RECORD];
            let want = unit_fields(&sim.tower.units[i]);
            assert!(same(&r[unit::STATE..], &want), "{what}: fresh room {slot}");
            assert!(same(&self.rooms[slot], &want), "{what}: kept room {slot}");
        }
        assert_eq!(fresh[header::POPULATION], sim.population() as f64, "{what}");
        let tail = at + rooms.len() * UNIT_RECORD;
        assert_eq!(
            fresh.len() - tail,
            transports_len(&sim.tower.transports),
            "{what}"
        );
        for u in &sim.tower.units {
            let (label, subtype) = match self.meta.get(&u.id) {
                Some((label, subtype)) => (label.as_str(), subtype.as_deref()),
                None => (u.kind.facility().name, None),
            };
            assert_eq!(label, u.label, "{what}: kept label of unit {}", u.id);
            assert_eq!(subtype, u.subtype, "{what}: kept subtype of unit {}", u.id);
        }
    }
}

/// A structural snapshot holds the tower: the rooms in the rooms index's
/// order, every floor and lobby tile in exactly one run (by floor, then
/// x), and every shaft.
fn decode_structure(sim: &Simulation, v: &[f64], what: &str) {
    let tower = &sim.tower;
    assert_eq!(v[structure::REVISION], tower.revision as f64, "{what}");
    let rooms = tower.room_index();
    assert_eq!(v[structure::ROOMS] as usize, rooms.len(), "{what}");
    assert_eq!(
        v[structure::SHAFTS] as usize,
        tower.transports.len(),
        "{what}"
    );
    assert_eq!(
        v[structure::HIGHEST_FLOOR],
        sim.highest_floor() as f64,
        "{what}"
    );
    assert_eq!(
        v[structure::LOWEST_FLOOR],
        sim.lowest_floor() as f64,
        "{what}"
    );
    let mut at = STRUCTURE_HEADER;
    for &i in rooms.iter() {
        let u = &tower.units[i];
        let r = &v[at..at + ROOM_RECORD];
        let want = [u.id, u.kind as i64, u.floor, u.x, u.width].map(|n| n as f64);
        assert!(same(r, &want), "{what}: room {}", u.id);
        assert_eq!(r[room::ID], u.id as f64);
        at += ROOM_RECORD;
    }
    let mut tiles = Vec::new();
    let mut last: Option<&[f64]> = None;
    for _ in 0..v[structure::RUNS] as usize {
        let r = &v[at..at + RUN_RECORD];
        if let Some(l) = last {
            assert!(
                (l[run::FLOOR], l[run::X]) <= (r[run::FLOOR], r[run::X]),
                "{what}: runs by floor, then x"
            );
            let continues = l[run::FLOOR] == r[run::FLOOR]
                && l[run::KIND] == r[run::KIND]
                && l[run::WIDTH] == r[run::WIDTH]
                && l[run::X] + l[run::COUNT] * l[run::WIDTH] == r[run::X]
                && same(&l[run::STATE..], &r[run::STATE..]);
            assert!(!continues, "{what}: a run continues the one before it");
        }
        last = Some(r);
        assert!(r[run::COUNT] >= 1.0, "{what}: an empty run");
        let fields: [f64; 5] = r[run::STATE..].try_into().unwrap();
        for k in 0..r[run::COUNT] as i64 {
            let x = r[run::X] as i64 + k * r[run::WIDTH] as i64;
            let key = [r[run::FLOOR], x as f64, r[run::KIND], r[run::WIDTH]];
            tiles.push((key.map(f64::to_bits), fields.map(f64::to_bits)));
        }
        at += RUN_RECORD;
    }
    let mut want: Vec<_> = tower
        .units
        .iter()
        .filter(|u| u.kind.is_structural())
        .map(|u| {
            let key = [
                u.floor as f64,
                u.x as f64,
                u.kind as usize as f64,
                u.width as f64,
            ];
            (key.map(f64::to_bits), unit_fields(u).map(f64::to_bits))
        })
        .collect();
    tiles.sort_unstable();
    want.sort_unstable();
    assert!(tiles == want, "{what}: the runs hold every tile once");
    for t in &tower.transports {
        let r = &v[at..at + SHAFT_FIXED];
        let want = [t.id, t.kind as i64, t.x, t.width, t.bottom, t.top, t.cars].map(|n| n as f64);
        assert!(same(&r[..shaft::SKIPS], &want), "{what}: shaft {}", t.id);
        let skips = t.skip_floors.as_deref().unwrap_or(&[]);
        assert_eq!(r[shaft::SKIPS], skips.len() as f64, "{what}");
        at += SHAFT_FIXED;
        assert!(
            same(&v[at..at + skips.len()], skips),
            "{what}: shaft {} skips",
            t.id
        );
        at += skips.len();
    }
    assert_eq!(at, v.len(), "{what}: the snapshot ends after the shafts");
}

/// How often each claim was put to the test, so a corpus that never moves
/// a revision, or never leaves one alone, or never takes an incremental
/// path, cannot pass vacuously. Each counts steps.
#[derive(Default, Debug)]
struct Tally {
    revision_moved: usize,
    revision_still: usize,
    signature_moved: usize,
    signature_still: usize,
    meta_moved: usize,
    delta_frames: usize,
    meta_deltas: usize,
}

/// The `towerStateSig` tower half, hashed so a session can keep every one
/// it saw.
fn sig_key(tower: &Tower) -> [u8; 16] {
    Sha256::digest(ts_sig(tower).as_bytes())[..16]
        .try_into()
        .unwrap()
}

/// The floor and lobby tiles' frame fields, straight off the tower.
fn tiles(tower: &Tower) -> Vec<[u64; 5]> {
    tower
        .units
        .iter()
        .filter(|u| u.kind.is_structural())
        .map(|u| unit_fields(u).map(f64::to_bits))
        .collect()
}

/// The seeded sessions, each checked at every step for three claims:
///
/// - the freshness test: the kept view equals a fresh read;
/// - the tiles' fields stand still between revisions: read straight off
///   the tower, they change only in a step that moved the revision (the
///   structure comparison implies it; this states it on its own);
/// - two states anywhere in a session have the same tower signature exactly
///   when they have the same `towerStateSig` tower half
///   (`signature_tests::ts_sig`), so a capture compares with a commit
///   whatever came between.
///
/// One test, since playing the sessions is the slow part.
#[test]
fn a_kept_view_matches_a_fresh_read_after_every_step() {
    let mut t = Tally::default();
    for (n, (name, mut sim, steps)) in starts().into_iter().enumerate() {
        let mut kept = Kept::new(&sim);
        kept.check(&sim, &format!("{name} at the start"));
        let mut tiles_then = (sim.tower.revision, tiles(&sim.tower));
        let mut sig_then = (sim.tower_signature(), sig_key(&sim.tower));
        let mut by_key = HashMap::from([(sig_then.1, sig_then.0)]);
        let mut by_sig = HashMap::from([(sig_then.0, sig_then.1)]);
        let mut meta_then = sim.tower.meta_revision;
        run_session(&mut sim, 7 + n as u64, steps, |sim, what| {
            let what = format!("{name} {what}");
            kept.read(sim);
            kept.check(sim, &what);
            let tiles_now = (sim.tower.revision, tiles(&sim.tower));
            if tiles_now.0 == tiles_then.0 {
                assert!(
                    tiles_now.1 == tiles_then.1,
                    "{what}: tiles changed, revision still"
                );
                t.revision_still += 1;
            } else {
                t.revision_moved += 1;
            }
            tiles_then = tiles_now;
            let sig_now = (sim.tower_signature(), sig_key(&sim.tower));
            assert_eq!(
                *by_key.entry(sig_now.1).or_insert(sig_now.0),
                sig_now.0,
                "{what}: one signature string, two signatures"
            );
            assert_eq!(
                *by_sig.entry(sig_now.0).or_insert(sig_now.1),
                sig_now.1,
                "{what}: two signature strings, one signature"
            );
            if sig_now.1 != sig_then.1 {
                t.signature_moved += 1;
            } else {
                t.signature_still += 1;
            }
            sig_then = sig_now;
            if sim.tower.meta_revision != meta_then {
                t.meta_moved += 1;
            }
            meta_then = sim.tower.meta_revision;
        });
        t.delta_frames += kept.delta_frames;
        t.meta_deltas += kept.meta_deltas;
    }
    eprintln!("{t:?}");
    assert!(t.revision_moved > 30 && t.revision_still > 200, "{t:?}");
    assert!(t.signature_moved > 30 && t.signature_still > 200, "{t:?}");
    assert!(t.meta_moved > 20 && t.meta_deltas > 20, "{t:?}");
    assert!(t.delta_frames > 80, "{t:?}");
}

/// The runs do not depend on the order the unit list gives the tiles in: a
/// list reversed, or ordered by column so it interleaves the floors, gives
/// the same runs as the tower's own order.
#[test]
fn the_runs_do_not_depend_on_the_unit_order() {
    let mut sim = super::session_tests::at("events-classic", "built");
    let runs = |sim: &Simulation| {
        let v = structure_view(sim);
        let at = STRUCTURE_HEADER + v[structure::ROOMS] as usize * ROOM_RECORD;
        v[at..at + v[structure::RUNS] as usize * RUN_RECORD].to_vec()
    };
    let want = runs(&sim);
    assert!(!want.is_empty());
    sim.tower.units.reverse();
    sim.tower.reindex();
    assert!(same(&runs(&sim), &want), "a reversed list");
    sim.tower.units.sort_by_key(|u| (u.x, u.floor));
    sim.tower.reindex();
    assert!(same(&runs(&sim), &want), "a list by column");
}

#[test]
fn adjacent_runs_are_coalesced_before_the_order_fast_path_returns() {
    let mut sim = Simulation::new_game(1, crate::clock::GameMode::Classic);
    for x in 0..=2 {
        assert!(sim.tower.place(crate::facilities::Kind::Lobby, 1, x).ok);
    }
    for x in [0, 2, 1] {
        assert!(sim.tower.place(crate::facilities::Kind::Floor, 2, x).ok);
    }
    let v = structure_view(&sim);
    let at = STRUCTURE_HEADER + v[structure::ROOMS] as usize * ROOM_RECORD;
    let runs = &v[at..at + v[structure::RUNS] as usize * RUN_RECORD];
    let floor2 = runs
        .chunks_exact(RUN_RECORD)
        .filter(|r| r[run::FLOOR] == 2.0)
        .collect::<Vec<_>>();
    assert_eq!(floor2.len(), 1, "the floor-2 tiles are one maximal run");
    assert_eq!(floor2[0][run::X], 0.0);
    assert_eq!(floor2[0][run::COUNT], 3.0);
}
