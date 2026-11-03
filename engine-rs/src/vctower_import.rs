//! A `.vctower` file the player opens, read into a game or refused in the
//! player's words (#1498). The checks that used to run in the page's
//! TypeScript run here, in front of the same loader every save goes through,
//! so the engine alone decides what a tower file is.

use crate::load::{inflate_container, is_js_whitespace, js_trim, InflateError, TOWER_FILE_MAGIC};
use crate::load_stream::{read_tower_file_json, TowerReadError};
use crate::sim::Simulation;

/// Not a `VCTOWER` file at all.
pub const NOT_A_TOWER_FILE: &str = "Not a Verticopolis tower file.";
/// A container from a later format version (`VCTOWER2` and up).
pub const NEWER_FILE_REFUSAL: &str =
    "This tower file was made by a newer version of Verticopolis. Update the game to load it.";
/// The container is ours but its contents cannot be read.
pub const DAMAGED_FILE: &str = "This tower file is damaged and can't be read.";
/// The file inflates past the size cap.
pub const TOO_LARGE_FILE: &str = "This tower file is too large to open safely.";
/// The most file text the engine takes. The inflate cap (32 MiB) as base64 is
/// under 43 MiB, which is what the game writes; the 48 MiB limit leaves room
/// for the line wraps and spaces a hand-edited or mailed file can carry. The
/// check keeps a huge pick from growing the engine's memory before it is read.
const MAX_FILE_TEXT_BYTES: usize = 48 * 1024 * 1024;
/// The contents are JSON but have no clock or no units list.
pub const NOT_A_TOWER_SAVE: &str = "Not a valid tower save file.";

/// The `.vctower` text the player opened, read into a game. Every refusal is
/// a sentence for the player: the container checks first, then the shape of
/// the save, then the loader's own refusals (a save from a newer build, a
/// `null` save, too many units), which are passed through unchanged.
///
/// A file that starts `VCTOWER1` is read as a version 1 file first. The digits
/// after the stamp cannot tell a later version from a version 1 payload that
/// starts with a digit and has no newline in front of it, so the bytes decide:
/// only when they are no version 1 file do the digits name a later version.
pub fn import_vctower(text: &str) -> Result<Simulation, String> {
    if text.len() > MAX_FILE_TEXT_BYTES {
        return Err(TOO_LARGE_FILE.into());
    }
    let trimmed = js_trim(text);
    let digits = stamp_digits(trimmed).ok_or(NOT_A_TOWER_FILE)?;
    if !trimmed.starts_with(TOWER_FILE_MAGIC) {
        return if is_later_version(digits) {
            Err(NEWER_FILE_REFUSAL.into())
        } else {
            Err(NOT_A_TOWER_FILE.into())
        };
    }
    let unreadable = || {
        if claims_later_version(trimmed) {
            NEWER_FILE_REFUSAL.to_string()
        } else {
            DAMAGED_FILE.to_string()
        }
    };
    let json = inflate_container(trimmed).map_err(|e| match e {
        InflateError::ExpandsTooFar => TOO_LARGE_FILE.to_string(),
        InflateError::NotAContainer | InflateError::Damaged(_) => unreadable(),
    })?;
    read_tower_file_json(&json).map_err(|e| match e {
        TowerReadError::Unparseable(_) => unreadable(),
        TowerReadError::NotASave => NOT_A_TOWER_SAVE.to_string(),
        TowerReadError::Refused(why) => why,
    })
}

/// The digits right after `VCTOWER`, as the file starts with them.
fn stamp_digits(trimmed: &str) -> Option<&str> {
    let rest = trimmed.strip_prefix("VCTOWER")?;
    let len = rest.bytes().take_while(u8::is_ascii_digit).count();
    (len > 0).then(|| &rest[..len])
}

/// Whether the digits name a version after 1: no leading zero (`VCTOWER0` and
/// `VCTOWER01` name no version) and not 1 itself.
fn is_later_version(digits: &str) -> bool {
    !digits.starts_with('0') && digits != "1"
}

/// Whether a file that starts `VCTOWER1` but is no version 1 file names a
/// later version: its digits are followed by white space or the end, so they
/// cannot be the start of a payload.
fn claims_later_version(trimmed: &str) -> bool {
    let Some(digits) = stamp_digits(trimmed) else {
        return false;
    };
    let after = &trimmed["VCTOWER".len() + digits.len()..];
    let ends_digits = after.is_empty() || after.starts_with(is_js_whitespace);
    ends_digits && is_later_version(digits)
}
