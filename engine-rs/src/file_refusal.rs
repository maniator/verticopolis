//! The closed code of a tower file the engine refused to read or write
//! (#2075), for the page's `import_failed` and `export_failed` analytics.
//! `lastReason()` is the player's sentence and may quote the file, so it never
//! leaves the page; `lastRefusalCode()` is one of these words and nothing else.

use crate::load::{NEWER_SAVE_REFUSAL, NOT_A_SAVE_REFUSAL};
use crate::vctower_import::{
    DAMAGED_FILE, NEWER_FILE_REFUSAL, NOT_A_TOWER_FILE, NOT_A_TOWER_SAVE, TOO_LARGE_FILE,
};

/// The file is larger than the engine reads.
pub(crate) const TOO_LARGE: &str = "too_large";
/// The file is no Verticopolis tower file at all.
pub(crate) const NOT_A_TOWER: &str = "not_tower";
/// A tower file whose contents cannot be read.
pub(crate) const DAMAGED: &str = "damaged";
/// A file or save from a later version of the game.
pub(crate) const NEWER_VERSION: &str = "newer_version";
/// Readable contents that hold no saved game.
pub(crate) const NOT_A_SAVE: &str = "not_save";
/// A 1994 `.TDT` file the reader could not walk.
pub(crate) const UNREADABLE: &str = "unreadable";
/// A Modern tower, which a 1994 `.TDT` cannot hold.
pub(crate) const MODERN: &str = "modern";
/// Any other refusal: the loader's or the writer's own.
pub(crate) const REFUSED: &str = "refused";

/// Every code, in the order the data map lists them.
#[cfg(test)]
pub(crate) const ALL: [&str; 8] = [
    TOO_LARGE,
    NOT_A_TOWER,
    DAMAGED,
    NEWER_VERSION,
    NOT_A_SAVE,
    UNREADABLE,
    MODERN,
    REFUSED,
];

/// The code of a `.vctower` import's refusal. The sentences are the engine's
/// own constants (`vctower_import`, `load::reader`), so a sentence reworded
/// there keeps its code; any other refusal the loader passes through is
/// [`REFUSED`].
pub(crate) fn of_vctower_import(reason: &str) -> &'static str {
    match reason {
        TOO_LARGE_FILE => TOO_LARGE,
        NOT_A_TOWER_FILE => NOT_A_TOWER,
        DAMAGED_FILE => DAMAGED,
        NEWER_FILE_REFUSAL | NEWER_SAVE_REFUSAL => NEWER_VERSION,
        NOT_A_TOWER_SAVE | NOT_A_SAVE_REFUSAL => NOT_A_SAVE,
        _ => REFUSED,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_import_sentence_has_its_own_code() {
        let cases = [
            (TOO_LARGE_FILE, TOO_LARGE),
            (NOT_A_TOWER_FILE, NOT_A_TOWER),
            (DAMAGED_FILE, DAMAGED),
            (NEWER_FILE_REFUSAL, NEWER_VERSION),
            (NEWER_SAVE_REFUSAL, NEWER_VERSION),
            (NOT_A_TOWER_SAVE, NOT_A_SAVE),
            (NOT_A_SAVE_REFUSAL, NOT_A_SAVE),
            ("The save has too many rooms.", REFUSED),
        ];
        for (reason, code) in cases {
            assert_eq!(of_vctower_import(reason), code, "{reason}");
        }
    }

    #[test]
    fn the_codes_are_distinct_snake_case_words() {
        for (i, code) in ALL.iter().enumerate() {
            assert!(
                code.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'),
                "{code}"
            );
            assert!(!ALL[..i].contains(code), "{code} twice");
        }
    }
}
