//! The 1994 `.TDT` save format: a port of `src/storage/tdt*.ts`, held to
//! `conformance/tdt-cases.json` by the `tdt` referee binary and the test in
//! `referee.rs`. Bytes in, the serialized game out (`import_tdt`); the
//! serialized game in, bytes out (`export_tdt`). The engine never depends on
//! this module; a tower that never touches a 1994 file carries none of it.

pub mod byte_reader;
pub mod byte_writer;
pub mod encoder;
pub mod export;
pub mod export_gather;
pub mod export_parking;
pub mod export_report;
pub mod export_tables;
pub mod format;
pub mod import;
pub mod import_report;
pub mod pacing;
pub mod parse;
pub mod part_merge;
pub mod referee;
pub mod stamp;
pub mod tables;
pub mod tail;
pub mod transports;
pub mod types;

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

/// Import a `.TDT` file: the serialized game as JSON text (what
/// `Simulation::deserialize` takes) plus the binary walk's warnings. The
/// error is the player-readable refusal.
pub fn import_tdt(bytes: &[u8], filename: &str) -> Result<(String, Vec<String>), String> {
    let parsed = parse::parse_tdt(bytes, filename).map_err(|e| e.0)?;
    Ok((parsed.save.to_string(), parsed.warnings))
}

/// Export a serialized game (JSON text, what `Simulation::serialize` writes)
/// as `.TDT` bytes. The error is the player-readable refusal, or what made
/// the JSON unusable. The input is `JSON.stringify` output: a number JSON
/// cannot carry (NaN, Infinity) arrives as `null`, and a literal like `1e400`
/// (which serde_json refuses and `JSON.parse` reads as Infinity) cannot.
pub fn export_tdt(save_json: &str) -> Result<Vec<u8>, String> {
    let save: serde_json::Value =
        serde_json::from_str(save_json).map_err(|e| format!("save: {e}"))?;
    export::build_tdt(&save)
        .map(|built| built.bytes)
        .map_err(|e| e.0)
}
