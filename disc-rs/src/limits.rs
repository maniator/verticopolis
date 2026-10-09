//! The budgets every parse runs under, all checked before the allocation or
//! the loop they bound. The defaults are the ones the reviewed TypeScript
//! reader shipped with: generous for a real CD, finite for a hostile one.
//! Tests pass small values to reach the guards without large fixtures.
use serde::{Deserialize, Serialize};

use crate::refusal::{refuse, Code, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    /// The largest image accepted. A CD never exceeds this.
    pub max_image_bytes: u64,
    /// Volume descriptors scanned before giving up on finding the primary.
    pub max_volume_descriptors: u32,
    /// Directory nesting below the root (the root is depth 0).
    pub max_dir_depth: u32,
    /// Total directory records parsed plus empty-sector skips in one walk.
    pub max_records: u32,
    /// The largest single file read, stored or expanded.
    pub max_file_bytes: u32,
    /// Expanded size may be at most this multiple of the stored size.
    pub max_expansion_ratio: u32,
}

pub const DEFAULT_LIMITS: Limits = Limits {
    max_image_bytes: 900 * 1024 * 1024,
    max_volume_descriptors: 64,
    max_dir_depth: 16,
    max_records: 50_000,
    max_file_bytes: 8 * 1024 * 1024,
    max_expansion_ratio: 256,
};

/// The most any host may ask for. A host can tighten every limit; it can
/// widen one only up to here, so no configuration lets a crafted image drive
/// a multi-gigabyte allocation or an unbounded walk.
pub const HARD_LIMITS: Limits = Limits {
    max_image_bytes: 8 * 1024 * 1024 * 1024,
    max_volume_descriptors: 256,
    max_dir_depth: 64,
    max_records: 1_000_000,
    max_file_bytes: 64 * 1024 * 1024,
    max_expansion_ratio: 4096,
};

impl Default for Limits {
    fn default() -> Limits {
        DEFAULT_LIMITS
    }
}

impl Limits {
    /// Refuse any limit past `HARD_LIMITS`.
    pub fn check(&self) -> Result<()> {
        let h = HARD_LIMITS;
        let over = [
            ("maxImageBytes", self.max_image_bytes > h.max_image_bytes),
            (
                "maxVolumeDescriptors",
                self.max_volume_descriptors > h.max_volume_descriptors,
            ),
            ("maxDirDepth", self.max_dir_depth > h.max_dir_depth),
            ("maxRecords", self.max_records > h.max_records),
            ("maxFileBytes", self.max_file_bytes > h.max_file_bytes),
            (
                "maxExpansionRatio",
                self.max_expansion_ratio > h.max_expansion_ratio,
            ),
        ];
        match over.iter().find(|(_, past)| *past) {
            Some((name, _)) => refuse(Code::BadRequest, format!("{name} is past the hard limit")),
            None => Ok(()),
        }
    }

    /// The output cap for one expansion of `stored` input bytes.
    pub fn output_cap(&self, stored: usize) -> usize {
        let ratio = (stored as u64).saturating_mul(self.max_expansion_ratio as u64);
        ratio.min(self.max_file_bytes as u64) as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_can_tighten_but_not_widen_past_the_hard_limits() {
        assert!(DEFAULT_LIMITS.check().is_ok());
        assert!(HARD_LIMITS.check().is_ok());
        let wide = Limits {
            max_file_bytes: HARD_LIMITS.max_file_bytes + 1,
            ..DEFAULT_LIMITS
        };
        assert_eq!(wide.check().unwrap_err().code, Code::BadRequest);
        let tight = Limits {
            max_records: 1,
            ..DEFAULT_LIMITS
        };
        assert!(tight.check().is_ok());
    }
}
