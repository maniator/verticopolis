//! The 1994 `.TDT` save format: a port of `src/storage/tdt*.ts`, held to
//! `conformance/tdt-cases.json` by the `tdt` referee binary and the test in
//! `referee.rs`. Bytes in, the serialized game out (`import_tdt`); the
//! serialized game in, bytes out (`export_tdt`). The engine never depends on
//! this module; a tower that never touches a 1994 file carries none of it.

pub mod byte_reader;
pub mod byte_writer;
#[cfg(test)]
mod cathedral_tests;
pub mod encoder;
pub mod export;
pub mod export_gather;
pub mod export_parking;
pub mod export_report;
pub mod export_tables;
#[cfg(any(test, feature = "conformance"))]
pub mod fixtures;
#[cfg(test)]
mod fixtures_tests;
pub mod format;
pub mod import;
pub mod import_report;
pub mod pacing;
pub mod parse;
pub mod part_merge;
#[cfg(any(test, feature = "conformance"))]
pub mod referee;
pub mod resync;
pub mod retail;
pub mod stair_scan;
pub mod stamp;
pub mod tables;
pub mod tail;
#[cfg(test)]
mod theatre_tests;
pub mod transports;
pub mod types;
pub mod venue_export;
pub mod venue_people;
pub mod venues;

/// A `.TDT` file that cannot be read; the message is player-readable.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LegacyImportError(pub String);

/// A tower the 1994 format cannot hold; the message is player-readable.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LegacyExportError(pub String);

impl std::fmt::Display for LegacyImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::fmt::Display for LegacyExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Reads a 1994 SimTower `.TDT` save into this engine's save JSON, plus
/// warnings about anything it could not carry over. Load the JSON with
/// [`deserialize_tdt`](crate::load::deserialize_tdt) after parsing it. The
/// error is a sentence a player can read.
///
/// ```
/// use verticopolis_engine::clock::GameMode;
/// use verticopolis_engine::sim::Simulation;
/// use verticopolis_engine::{export_tdt, import_tdt};
///
/// let sim = Simulation::new_game(1, GameMode::Classic);
/// let bytes = export_tdt(&sim.serialize().to_string()).unwrap();
/// let (json, _warnings) = import_tdt(&bytes, "TOWER.TDT").unwrap();
/// let save: serde_json::Value = serde_json::from_str(&json).unwrap();
/// let tower = verticopolis_engine::load::deserialize_tdt(&save).unwrap();
/// assert_eq!(tower.mode, GameMode::Classic);
/// ```
pub fn import_tdt(bytes: &[u8], filename: &str) -> Result<(String, Vec<String>), String> {
    let parsed = parse::parse_tdt(bytes, filename).map_err(|e| e.0)?;
    Ok((parsed.save.to_string(), parsed.warnings))
}

/// Writes a Classic game's save JSON (the text of
/// [`Simulation::serialize`](crate::sim::Simulation::serialize)) as a 1994
/// SimTower `.TDT` file. The error is a sentence a player can read, or says
/// what made the JSON unusable.
pub fn export_tdt(save_json: &str) -> Result<Vec<u8>, String> {
    let save: serde_json::Value =
        crate::load::parse_save_json(save_json.as_bytes()).map_err(|e| format!("save: {e}"))?;
    export::build_tdt(&save)
        .map(|built| built.bytes)
        .map_err(|e| e.0)
}
