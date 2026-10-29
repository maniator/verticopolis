//! Replays `conformance/tdt-cases.json`, the lock
//! `src/tests/integration/tdtCases.integration.test.ts` writes: every
//! import case through `parse_tdt` against its pinned save hash and
//! warnings, every export case through `build_tdt` against its pinned
//! SHA-256. Shared by the `tdt` binary and the `cargo test` run.

use std::io::Read;
use std::path::Path;

use base64::Engine as _;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::export::build_tdt;
use super::parse::parse_tdt;
use crate::canonical::digest;
use crate::load::{decode_vctower, deserialize};

#[derive(Deserialize)]
pub struct ImportExpected {
    pub save: String,
    pub warnings: Vec<String>,
}

#[derive(Deserialize)]
pub struct ImportCase {
    pub id: String,
    pub filename: String,
    /// Raw deflate, base64.
    pub bytes: String,
    pub expected: Option<ImportExpected>,
    pub throws: Option<String>,
}

#[derive(Deserialize)]
pub struct ExportCase {
    pub id: String,
    pub save: Option<Value>,
    pub base: Option<String>,
    pub patch: Option<serde_json::Map<String, Value>>,
    pub fixture: Option<String>,
    pub expected: Option<String>,
    pub throws: Option<String>,
}

#[derive(Deserialize)]
pub struct Lock {
    pub import: Vec<ImportCase>,
    pub export: Vec<ExportCase>,
}

/// One case's verdict: `Ok(())` or the first mismatch, in words.
pub type Verdict = Result<(), String>;

pub(crate) fn inflate(b64: &str) -> Result<Vec<u8>, String> {
    let packed = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("base64: {e}"))?;
    let mut out = Vec::new();
    flate2::read::DeflateDecoder::new(&packed[..])
        .read_to_end(&mut out)
        .map_err(|e| format!("inflate: {e}"))?;
    Ok(out)
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn replay_import(case: &ImportCase) -> Verdict {
    let bytes = inflate(&case.bytes)?;
    match (
        parse_tdt(&bytes, &case.filename),
        &case.expected,
        &case.throws,
    ) {
        (Ok(parsed), Some(want), _) => {
            let got = digest(&parsed.save);
            if got != want.save {
                return Err(format!("save hash {got} vs {}", want.save));
            }
            let mut warnings = parsed.warnings.clone();
            warnings.sort();
            if warnings != want.warnings {
                return Err(format!("warnings {warnings:?} vs {:?}", want.warnings));
            }
            Ok(())
        }
        (Ok(_), None, Some(msg)) => Err(format!("parsed, expected the refusal {msg:?}")),
        (Err(e), _, Some(msg)) => {
            if e.0 == *msg {
                Ok(())
            } else {
                Err(format!("refused with {:?} vs {msg:?}", e.0))
            }
        }
        (Err(e), Some(_), None) => Err(format!("refused with {:?}, expected a parse", e.0)),
        _ => Err("case pins neither a result nor a refusal".into()),
    }
}

/// The export menu's path for a fixture: decode, load and re-serialize.
fn fixture_save(suite: &Path, fixture: &str) -> Result<Value, String> {
    let path = crate::suite::fixture_path(suite, fixture)?;
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {fixture}: {e}"))?;
    let raw = decode_vctower(&text)?;
    let sim = deserialize(&raw)?;
    Ok(sim.serialize())
}

/// The save one export case builds from: its fixture, its base with the
/// patch applied, or the one it embeds.
fn export_case_save(case: &ExportCase, lock: &Lock, suite: &Path) -> Result<Value, String> {
    if let Some(fixture) = &case.fixture {
        fixture_save(suite, fixture)
    } else if let Some(base) = &case.base {
        let base_case = lock
            .export
            .iter()
            .find(|c| c.id == *base)
            .ok_or_else(|| format!("base case {base} is not in the lock"))?;
        let mut save = base_case
            .save
            .clone()
            .ok_or_else(|| format!("base case {base} embeds no save"))?;
        if let (Some(obj), Some(patch)) = (save.as_object_mut(), &case.patch) {
            for (k, v) in patch {
                obj.insert(k.clone(), v.clone());
            }
        }
        Ok(save)
    } else {
        case.save
            .clone()
            .ok_or_else(|| "case embeds no save".to_string())
    }
}

/// Replay one export case; `suite` is the conformance directory its fixture
/// is read from (see [`crate::suite::fixture_path`]).
pub fn replay_export(case: &ExportCase, lock: &Lock, suite: &Path) -> Verdict {
    let save = export_case_save(case, lock, suite)?;
    match (build_tdt(&save), &case.expected, &case.throws) {
        (Ok(built), Some(want), _) => {
            let got = sha256_hex(&built.bytes);
            if got != *want {
                return Err(format!(
                    "bytes {got} vs {want} ({} bytes written)",
                    built.bytes.len()
                ));
            }
            Ok(())
        }
        (Ok(_), None, Some(msg)) => Err(format!("exported, expected the refusal {msg:?}")),
        (Err(e), _, Some(msg)) => {
            if e.0 == *msg {
                Ok(())
            } else {
                Err(format!("refused with {:?} vs {msg:?}", e.0))
            }
        }
        (Err(e), Some(_), None) => Err(format!("refused with {:?}, expected bytes", e.0)),
        _ => Err("case pins neither a result nor a refusal".into()),
    }
}

/// Every case's verdict in lock order, each run under `catch_unwind` so a
/// panic reads as that case's failure.
pub fn replay_all(lock: &Lock, suite: &Path) -> Vec<(String, Verdict)> {
    let guard = |f: &dyn Fn() -> Verdict| -> Verdict {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or_else(|p| {
            let msg = p
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| p.downcast_ref::<&str>().map(|s| s.to_string()))
                .unwrap_or_else(|| "panic".to_string());
            Err(format!("panicked: {msg}"))
        })
    };
    let mut out = vec![];
    for case in &lock.import {
        out.push((case.id.clone(), guard(&|| replay_import(case))));
    }
    for case in &lock.export {
        out.push((case.id.clone(), guard(&|| replay_export(case, lock, suite))));
    }
    out
}

pub fn read_lock(path: &Path) -> Result<Lock, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tdt::export::build_tdt_streamed;
    use std::path::PathBuf;

    /// Every case in the lock replays; the list of failures is the assertion
    /// message so one run names every divergent case.
    #[test]
    fn every_tdt_case_matches_the_lock() {
        let suite = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("conformance");
        let lock = read_lock(&suite.join("tdt-cases.json")).expect("lock");
        assert!(
            !lock.import.is_empty() && !lock.export.is_empty(),
            "the lock holds no cases"
        );
        let failures: Vec<String> = replay_all(&lock, &suite)
            .into_iter()
            .filter_map(|(id, v)| v.err().map(|e| format!("{id}: {e}")))
            .collect();
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    /// The streamed build (`build_tdt_streamed`, #1431) writes the lock's
    /// bytes, or its refusal, for every export case whose save lists its
    /// units: the save split into the tree without `units` and the entries.
    #[test]
    fn the_streamed_build_matches_the_whole_save_build_on_every_case() {
        let suite = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("conformance");
        let lock = read_lock(&suite.join("tdt-cases.json")).expect("lock");
        let mut compared = 0;
        for case in &lock.export {
            let save = export_case_save(case, &lock, &suite).expect("the case's save");
            let Some(units) = save.get("units").and_then(Value::as_array) else {
                continue;
            };
            let mut rest = save.clone();
            rest.as_object_mut().expect("an object").remove("units");
            let whole = build_tdt(&save);
            let streamed = build_tdt_streamed(&rest, units.iter());
            match (whole, streamed) {
                (Ok(a), Ok(b)) => {
                    assert_eq!(a.bytes, b.bytes, "{}: the bytes", case.id);
                    assert_eq!(a.stats, b.stats, "{}: the stats", case.id);
                    assert_eq!(a.counts, b.counts, "{}: the counts", case.id);
                    assert_eq!((a.top_floor, a.basements), (b.top_floor, b.basements));
                }
                (Err(a), Err(b)) => assert_eq!(a.0, b.0, "{}: the refusal", case.id),
                (a, b) => panic!("{}: {:?} vs {:?}", case.id, a.err(), b.err()),
            }
            compared += 1;
        }
        assert!(compared > 10, "only {compared} cases compared");
    }

    /// Six of `forged-transport-entries`' seven entries have no kind, and the
    /// codec drops all six, the count the TypeScript report gives
    /// (`tdtExportForged`).
    #[test]
    fn the_forged_transport_entries_drop_six() {
        let suite = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("conformance");
        let lock = read_lock(&suite.join("tdt-cases.json")).expect("lock");
        let case = lock
            .export
            .iter()
            .find(|c| c.id == "export-forged-transport-entries")
            .expect("the lock pins forged-transport-entries");
        let built = build_tdt(case.save.as_ref().expect("an embedded save")).expect("bytes");
        assert_eq!(built.stats.transports_dropped, 6);
    }
}
