//! A set of floors, one bit per floor slot ([`crate::tower_index::floor_slot`]).
//! The spawn step dedupes its floor lists with it, and the daily Auto-tune
//! finds a shaft's twins with one comparison per pair of shafts. Each
//! shaft's stops are one too (`Tower::stop_bits`, #1984).

/// A bit per floor slot, in two words: a `u128` shift is a library call on
/// wasm32.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct FloorBits([u64; 2]);

/// Slot `i`'s word and its bit in that word.
#[inline]
fn word_and_bit(i: usize) -> (usize, u64) {
    (i >> 6, 1u64 << (i & 63))
}

impl FloorBits {
    /// Sets slot `i`'s bit; whether it was clear.
    #[inline]
    pub(crate) fn insert(&mut self, i: usize) -> bool {
        let (word, bit) = word_and_bit(i);
        let new = self.0[word] & bit == 0;
        self.0[word] |= bit;
        new
    }

    /// Whether slot `i`'s bit is set; false past the last slot.
    #[inline]
    pub(crate) fn contains(&self, i: usize) -> bool {
        let (word, bit) = word_and_bit(i);
        self.0.get(word).is_some_and(|w| w & bit != 0)
    }

    /// Sets every slot set in `other`.
    #[inline]
    pub(crate) fn union_with(&mut self, other: &FloorBits) {
        for (mine, theirs) in self.0.iter_mut().zip(&other.0) {
            *mine |= theirs;
        }
    }

    /// Whether every slot set in `other` is set here too.
    #[inline]
    pub(crate) fn covers(&self, other: &FloorBits) -> bool {
        self.0
            .iter()
            .zip(&other.0)
            .all(|(mine, theirs)| theirs & !mine == 0)
    }
}

#[cfg(test)]
mod tests {
    use super::FloorBits;

    #[test]
    fn a_set_covers_its_subsets_only() {
        let of = |slots: &[usize]| {
            let mut b = FloorBits::default();
            for &i in slots {
                b.insert(i);
            }
            b
        };
        let (wide, narrow, apart) = (of(&[0, 5, 64, 127]), of(&[5, 64]), of(&[5, 70]));
        assert!(wide.covers(&narrow), "both words checked");
        assert!(!narrow.covers(&wide));
        assert!(!wide.covers(&apart), "slot 70 is missing");
        assert!(wide.covers(&FloorBits::default()), "the empty set");
        let mut b = FloorBits::default();
        assert!(
            b.insert(3) && !b.insert(3),
            "insert says whether it was new"
        );
        assert!(wide.contains(127) && wide.contains(64) && !wide.contains(63));
        assert!(!wide.contains(128), "past the last slot");
    }
}
