//! Writer-side tables and helpers for the `.TDT` exporter
//! (`tdtExportTables.ts`): the inverses of the shared reader tables, the DOS
//! filename rule and the pre-encoding tenant shape.

use super::tables::{rent_from_class, tenant_kind, TENANT_IDS};
use crate::facilities::Kind;

/// Kind to canonical single-story tenant ID (`KIND_TENANT`): `TENANT_KIND`
/// inverted, lowest ID wins, so security exports as 14 (never 17).
pub fn kind_tenant(kind: Kind) -> Option<i64> {
    TENANT_IDS
        .iter()
        .copied()
        .filter(|&id| tenant_kind(id) == Some(kind))
        .min()
}

/// Multi-story kinds to part IDs from the bottom story up (`PART_STACKS`).
pub fn part_stack(kind: Kind) -> Option<&'static [i64]> {
    Some(match kind {
        Kind::Cinema => &[19, 18],
        Kind::Recycling => &[21, 20],
        Kind::PartyHall => &[30, 29],
        Kind::Metro => &[33, 32, 31],
        Kind::WeddingHall => &[36, 37, 38, 39, 40],
        _ => return None,
    })
}

/// `classFromRent`: a unit's rent to the nearest 1994 rent class (ties round
/// up); 4 (No Rate) for a kind with no ladder, 2 (Average) for no override.
/// `rent` is the JavaScript value coerced to a number (`None` for undefined).
pub fn class_from_rent(kind: Kind, rent: Option<f64>) -> i64 {
    let anchors: Vec<Option<f64>> = (0..4).map(|cls| rent_from_class(kind, cls)).collect();
    if anchors[0].is_none() {
        return 4;
    }
    let Some(rent) = rent else {
        return 2;
    };
    let mut best = 2;
    let mut best_dist = f64::INFINITY;
    for (cls, anchor) in anchors.iter().enumerate() {
        let d = (rent - anchor.unwrap_or(0.0)).abs();
        if d <= best_dist {
            best_dist = d;
            best = cls as i64;
        }
    }
    best
}

const DOS_RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// `legacyFilename`: A-Z0-9 from the tower name, upper-cased, capped at 8
/// characters, never empty and never a reserved device name.
pub fn legacy_filename(tower_name: &str) -> String {
    let stem: String = tower_name
        .to_uppercase()
        .chars()
        .filter(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        .take(8)
        .collect();
    if stem.is_empty() || DOS_RESERVED.contains(&stem.as_str()) {
        "TOWER1.TDT".to_string()
    } else {
        format!("{stem}.TDT")
    }
}

/// One tenant record, pre-encoding (`OutTenant`). Extents stay doubles
/// because the encoder clamps and masks them the way the TypeScript does.
#[derive(Clone, Debug, PartialEq)]
pub struct OutTenant {
    pub left: f64,
    pub right: f64,
    /// Negative = under construction.
    pub type_id: i64,
    pub status: i64,
    pub rent_class: i64,
    /// Canon variant byte for retail; `None` for every other kind.
    pub subtype_idx: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rent_classes_invert_the_ladder() {
        assert_eq!(class_from_rent(Kind::Office, None), 2);
        assert_eq!(class_from_rent(Kind::Office, Some(2_000.0)), 0);
        assert_eq!(class_from_rent(Kind::Office, Some(7_500.0)), 2);
        assert_eq!(class_from_rent(Kind::Office, Some(12_500.0)), 3);
        assert_eq!(class_from_rent(Kind::Shop, Some(1.0)), 4);
        assert_eq!(class_from_rent(Kind::Office, Some(f64::NAN)), 2);
    }

    #[test]
    fn filenames_are_dos_safe() {
        assert_eq!(legacy_filename("My Tower!"), "MYTOWER.TDT");
        assert_eq!(legacy_filename("a very long name"), "AVERYLON.TDT");
        assert_eq!(legacy_filename("con"), "TOWER1.TDT");
        assert_eq!(legacy_filename("§§"), "TOWER1.TDT");
        assert_eq!(kind_tenant(Kind::Security), Some(14));
    }
}
