//! Small pure helpers for the `.TDT` import (`tdtImportHelpers.ts`): the
//! file sniff, the tower-name derivation and the deterministic seed hash.

use super::format::TDT_MAGIC;

/// `looksLikeLegacyTower`: the `.TDT` extension, else the header magic.
pub fn looks_like_legacy_tower(filename: &str, bytes: Option<&[u8]>) -> bool {
    // A byte slice would panic when the last four bytes start inside a
    // multibyte character; `get` answers None there, as the TypeScript
    // `/\.tdt$/i` answers false.
    if filename
        .get(filename.len().wrapping_sub(4)..)
        .is_some_and(|tail| tail.eq_ignore_ascii_case(".tdt"))
    {
        return true;
    }
    bytes.is_some_and(|b| b.len() >= 2 && (b[0] as i64 | ((b[1] as i64) << 8)) == TDT_MAGIC)
}

/// `towerNameFromFilename`: basename minus extension, separators to spaces,
/// printable ASCII only, capped length.
pub fn tower_name_from_filename(filename: &str) -> String {
    let base = filename.rsplit(['\\', '/']).next().unwrap_or("");
    let stem = match base.rfind('.') {
        Some(i) => &base[..i],
        None => base,
    };
    let printable: String = stem.chars().filter(|&c| (' '..='~').contains(&c)).collect();
    // `[_\-.]+` to one space, then `\s+` to one space (only the plain space
    // survives the printable filter).
    let mut collapsed = String::new();
    let mut pending_space = false;
    for c in printable.chars() {
        if c == '_' || c == '-' || c == '.' || c == ' ' {
            pending_space = true;
        } else {
            if pending_space && !collapsed.is_empty() {
                collapsed.push(' ');
            }
            pending_space = false;
            collapsed.push(c);
        }
    }
    let name: String = collapsed.trim().chars().take(24).collect();
    let name = name.trim().to_string();
    if name.is_empty() {
        "SimTower Import".to_string()
    } else {
        name
    }
}

/// `hashSeed`: FNV-1a over the file bytes, masked to a positive 31-bit seed.
pub fn hash_seed(bytes: &[u8]) -> i64 {
    let mut h: u32 = 0x811c9dc5;
    for &b in bytes {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    let h = (h & 0x7fffffff) as i64;
    if h == 0 {
        1
    } else {
        h
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tower_names_follow_the_filename_rule() {
        assert_eq!(tower_name_from_filename("MY_TOWER.TDT"), "MY TOWER");
        assert_eq!(
            tower_name_from_filename("C:\\GAMES\\SIM\\towers\\alpha-one.tdt"),
            "alpha one"
        );
        assert_eq!(tower_name_from_filename("§§§.tdt"), "SimTower Import");
        assert!(
            tower_name_from_filename("a-very-long-tower-name-that-keeps-going.tdt").len() <= 24
        );
        assert_eq!(
            tower_name_from_filename("  spaced  name .tdt"),
            "spaced name"
        );
    }

    #[test]
    fn sniff_takes_the_extension_then_the_magic() {
        assert!(looks_like_legacy_tower("TOWER.TDT", None));
        assert!(!looks_like_legacy_tower("tower.sav", None));
        assert!(!looks_like_legacy_tower("ab€€", None));
        assert!(looks_like_legacy_tower("tøwer.TDT", None));
        assert!(looks_like_legacy_tower("tower.sav", Some(&[0x00, 0x24, 1])));
        assert!(!looks_like_legacy_tower("x.bin", Some(&[1, 2, 3])));
    }

    #[test]
    fn hash_seed_is_fnv1a_masked() {
        assert_eq!(hash_seed(&[]), 0x811c9dc5 & 0x7fffffff);
        assert_ne!(hash_seed(b"a"), hash_seed(b"b"));
    }
}
