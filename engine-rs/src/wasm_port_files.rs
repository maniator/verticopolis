//! The port's file members (facade slice 7, PR 1d; the contract is
//! `architecture-rust-facade-2026-10-20/engine-port-contract.md`): the
//! `.vctower` file in and out, and the 1994 `.TDT` file in and out. A `.TDT`
//! import is two calls, because the game shows the fidelity report before
//! the player opens the tower: `loadTdt` reads and stages the file and
//! answers the report's numbers, and `adoptTdt` swaps the staged tower in.
//! The report's sentences stay in TypeScript (`tdtImportReport.ts`,
//! `tdtExportReport.ts`), built from these numbers and the note texts.
use serde_json::Value;

use crate::charges::{whole, INVALID_REQUEST};
use crate::sim::Simulation;
use crate::tdt::import_report::ImportCounts;

use super::Engine;

/// `loadTdt`'s record: the status, the import tally in `ImportCounts`
/// order, the transport decode's losses, the save's own facts the report
/// reads, and the number of `notes` (the header's) and `warnings` (the
/// walk's) that `tdtNote(i)` reads, notes first. NaN marks a count the file
/// does not carry. A refused file answers `[0]`.
pub(crate) const LOAD_TDT: [&str; 43] = [
    "status",
    "rooms",
    "offices",
    "occupiedOffices",
    "condos",
    "soldCondos",
    "hotelRooms",
    "hotelAsleep",
    "hotelDirty",
    "hotelBooked",
    "asleepConverted",
    "infested",
    "venues",
    "services",
    "parkingStalls",
    "construction",
    "rentsApplied",
    "twinRooms",
    "secom",
    "cathedral",
    "burned",
    "unknown",
    "droppedFloors",
    "offLot",
    "overlapping",
    "misplaced",
    "clamped",
    "widthMismatch",
    "decoded",
    "droppedShafts",
    "adjustedShafts",
    "droppedFlights",
    "parkingConnected",
    "peopleCount",
    "floors",
    "basements",
    "minutes",
    "shafts",
    "flights",
    "star",
    "money",
    "notes",
    "warnings",
];

/// `tdtExport`'s record: the status, the gather tally, the encoder's
/// stats, and the floors the file holds. A refused tower answers `[0]`.
pub(crate) const TDT_EXPORT: [&str; 23] = [
    "status",
    "rooms",
    "rentsSnapped",
    "namesDropped",
    "hotelStates",
    "occupied",
    "construction",
    "parkingStalls",
    "burnedOut",
    "vacancyHistoryLost",
    "outOfRange",
    "balance",
    "money",
    "star",
    "shaftsDropped",
    "shaftsColliding",
    "flightsDropped",
    "transportsDropped",
    "elevatorsLen",
    "walkwaysLen",
    "expressLen",
    "topFloor",
    "basements",
];

/// The file records, beside the port's others in the layout.
pub(crate) fn add_file_records(layout: &mut Value) {
    let records = &mut layout["records"];
    records["loadTdt"] = serde_json::json!(&LOAD_TDT[..]);
    records["adoptTdt"] = serde_json::json!(["status", "generation"]);
    records["loadVctower"] = serde_json::json!(["status", "generation"]);
    records["tdtExport"] = serde_json::json!(TDT_EXPORT);
}

/// A `.TDT` file read and checked, waiting for the player to open it.
pub(crate) struct StagedTdt {
    sim: Simulation,
    /// The header's notes, then the walk's warnings.
    notes: Vec<String>,
    name: Option<String>,
}

fn counts(c: &ImportCounts) -> [f64; 27] {
    [
        c.rooms,
        c.offices,
        c.occupied_offices,
        c.condos,
        c.sold_condos,
        c.hotel_rooms,
        c.hotel_asleep,
        c.hotel_dirty,
        c.hotel_booked,
        c.asleep_converted,
        c.infested,
        c.venues,
        c.services,
        c.parking_stalls,
        c.construction,
        c.rents_applied,
        c.twin_rooms,
        c.secom,
        c.cathedral,
        c.burned,
        c.unknown,
        c.dropped_floors,
        c.off_lot,
        c.overlapping,
        c.misplaced,
        c.clamped,
        c.width_mismatch,
    ]
    .map(|n| n as f64)
}

/// The save's facts `buildReport` reads off it: the floors and basements
/// built, the clock, the shafts and flights, the star and the funds.
fn save_facts(save: &Value) -> [f64; 7] {
    let num = |v: &Value, k: &str| v.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    let list = |k: &str| {
        save.get(k)
            .and_then(Value::as_array)
            .map_or(&[][..], Vec::as_slice)
    };
    let (mut floors, mut basements) = (0.0_f64, 0.0_f64);
    for u in list("units") {
        let floor = num(u, "floor");
        floors = floors.max(floor);
        if floor < 1.0 {
            basements = basements.max(1.0 - floor);
        }
    }
    let flights = list("transports")
        .iter()
        .filter(|t| {
            matches!(
                t.get("kind").and_then(Value::as_str),
                Some("stairs" | "escalator")
            )
        })
        .count();
    let shafts = list("transports").len() - flights;
    [
        floors,
        basements,
        num(save, "minutes"),
        shafts as f64,
        flights as f64,
        num(save, "star"),
        num(save, "money"),
    ]
}

impl Engine {
    /// Load a `.vctower` file (the `stored` source from a file): a save from
    /// before 2.0 is marked as a founder's tower, as `SaveGame` does.
    pub(crate) fn port_load_vctower(&mut self, text: &str) -> Vec<f64> {
        self.reason = None;
        match crate::load_stream::load_vctower_text(text, None) {
            Ok(next) => {
                self.adopt(next);
                self.swap_record(true)
            }
            Err(e) => self.refuse_swap(e),
        }
    }

    /// The current tower as `.vctower` file text, stamped the way
    /// `SaveGame.export` stamps it; undefined, with the reason in
    /// `lastReason()`, for a build name or time the stamp refuses.
    pub(crate) fn port_export_vctower(
        &mut self,
        app_version: &str,
        saved_at_ms: f64,
    ) -> Option<String> {
        self.reason = None;
        let text = crate::load::encode_simulation_vctower(&self.sim, app_version, saved_at_ms)
            .map(|bytes| String::from_utf8(bytes).map_err(|e| e.to_string()));
        match text {
            Ok(Ok(text)) => Some(text),
            Ok(Err(e)) | Err(e) => {
                self.reason = Some(e);
                None
            }
        }
    }

    /// Read and stage a `.TDT` file, answering [`LOAD_TDT`]. The live tower
    /// is untouched until `adoptTdt`; a refused file drops any staged one.
    pub(crate) fn port_load_tdt(&mut self, bytes: &[u8], filename: &str) -> Vec<f64> {
        self.reason = None;
        self.staged_tdt = None;
        let parsed = match crate::tdt::parse::parse_tdt(bytes, filename) {
            Ok(p) => p,
            Err(e) => {
                self.reason = Some(e.0);
                return vec![0.0];
            }
        };
        // The importer's output goes through the trust boundary every save
        // does, and is never marked as a founder's tower.
        let sim = match crate::load::deserialize(&parsed.save) {
            Ok(sim) => sim,
            Err(e) => {
                self.reason = Some(format!("This SimTower save couldn't be read. ({e})"));
                return vec![0.0];
            }
        };
        let tail = &parsed.tower.tail;
        let mut r = Vec::with_capacity(LOAD_TDT.len());
        r.push(1.0);
        r.extend_from_slice(&counts(&parsed.counts));
        let d = &parsed.decode_stats;
        r.extend_from_slice(&[
            f64::from(u8::from(parsed.decoded)),
            d.dropped_shafts as f64,
            d.adjusted_shafts as f64,
            d.dropped_flights as f64,
            tail.parking_connected.map_or(f64::NAN, |n| n as f64),
            tail.people_count.map_or(f64::NAN, |n| n as f64),
        ]);
        r.extend_from_slice(&save_facts(&parsed.save));
        r.extend_from_slice(&[parsed.header_notes.len() as f64, tail.warnings.len() as f64]);
        let mut notes = parsed.header_notes;
        notes.extend(tail.warnings.iter().cloned());
        let name = sim.tower.tower_name.clone();
        self.staged_tdt = Some(Box::new(StagedTdt { sim, notes, name }));
        r
    }

    /// Note `i` of the staged file: the header's notes, then the walk's
    /// warnings; undefined past the end or with nothing staged.
    pub(crate) fn port_tdt_note(&self, i: f64) -> Option<String> {
        let i = usize::try_from(whole(i)?).ok()?;
        self.staged_tdt.as_ref()?.notes.get(i).cloned()
    }

    /// The staged file's tower name; undefined when it has none or with
    /// nothing staged.
    pub(crate) fn port_tdt_tower_name(&self) -> Option<String> {
        self.staged_tdt.as_ref()?.name.clone()
    }

    /// Swap the staged `.TDT` tower in (the `legacy` source); refused with
    /// nothing staged.
    pub(crate) fn port_adopt_tdt(&mut self) -> Vec<f64> {
        self.reason = None;
        match self.staged_tdt.take() {
            Some(staged) => {
                self.adopt(staged.sim);
                self.swap_record(true)
            }
            None => self.refuse_swap(INVALID_REQUEST.into()),
        }
    }

    /// Write the current tower as a `.TDT` file, answering [`TDT_EXPORT`];
    /// the bytes wait for `tdtFile()`. A tower the format cannot hold is
    /// refused with the player-readable reason.
    pub(crate) fn port_tdt_export(&mut self) -> Vec<f64> {
        self.reason = None;
        self.tdt_file = None;
        let (rest, units) = self.sim.save_without_units();
        let built = match crate::tdt::export::build_tdt_streamed(&rest, units) {
            Ok(b) => b,
            Err(e) => {
                self.reason = Some(e.0);
                return vec![0.0];
            }
        };
        let (c, s) = (&built.counts, &built.stats);
        let mut r = vec![1.0];
        r.extend(
            [
                c.rooms,
                c.rents_snapped,
                c.names_dropped,
                c.hotel_states,
                c.occupied,
                c.construction,
                c.parking_stalls,
                c.burned_out,
                c.vacancy_history_lost,
                c.out_of_range,
                s.balance,
            ]
            .map(|n| n as f64),
        );
        r.push(s.money);
        r.extend(
            [
                s.star,
                s.shafts_dropped,
                s.shafts_colliding,
                s.flights_dropped,
                s.transports_dropped,
                s.elevators_len,
                s.walkways_len,
                s.express_len,
            ]
            .map(|n| n as f64),
        );
        r.extend_from_slice(&[built.top_floor, built.basements]);
        self.tdt_file = Some(built.bytes);
        r
    }

    /// The bytes the last done `tdtExport` wrote, handed over once.
    pub(crate) fn port_tdt_file(&mut self) -> Option<Vec<u8>> {
        self.tdt_file.take()
    }
}

#[cfg(test)]
#[path = "wasm_port_files_tests.rs"]
mod tests;
