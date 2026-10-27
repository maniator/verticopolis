//! A fast hasher for maps that are only written and looked up (#1143 item
//! 3, HP-5 in `docs/performance/hot-path-review.md`).
//!
//! The standard maps hash with SipHash, which is built to resist hash
//! flooding and costs tens of instructions per small integer key. The route
//! search inserts and looks up a segment id or a walk state for every node
//! it visits, once per trip, per reachability query and per staff route
//! attempt, so that hashing was most of the search's cost. These keys come
//! from the tower's own layout, so flooding is not a concern: each word is
//! mixed in with an add and a multiply (the integer mix `rustc-hash` 2
//! uses), and `finish` scrambles the result with the `splitmix64`
//! finalizer, a few instructions in all.
//!
//! The tower's `by_id` (unit id to list index) uses `FastMap` too: a removal
//! rewrites the entries after the removed unit, up to the whole list on a
//! large tower (#1290), and the step looks units up by id per person. Its
//! ids come from the save, so a crafted save could pick colliding ids and
//! slow its own load; std's fixed keys on the wasm32 build allowed as much.
//!
//! `FastMap` and `FastSet` offer no iteration: their order would follow the
//! hash, so a result that read it could differ between builds. `FastMap`
//! inserts, looks up, removes and clears; `FastSet` only adds.

use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hash, Hasher};
use std::ops::Index;

/// The `rustc-hash` 2 multiplier for 64-bit words.
const K: u64 = 0xf135_7aea_2e62_a9c5;
/// The `splitmix64` finalizer's multipliers.
const M1: u64 = 0xbf58_476d_1ce4_e5b9;
const M2: u64 = 0x94d0_49bb_1331_11eb;

#[derive(Default, Clone)]
pub struct FastHasher(u64);

impl FastHasher {
    #[inline]
    fn add(&mut self, word: u64) {
        self.0 = self.0.wrapping_add(word).wrapping_mul(K);
    }
}

impl Hasher for FastHasher {
    /// Bytes go in eight at a time, then their count, so a shorter run with
    /// trailing zeros does not hash as a longer one.
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        for chunk in bytes.chunks(8) {
            let mut word = [0u8; 8];
            word[..chunk.len()].copy_from_slice(chunk);
            self.add(u64::from_le_bytes(word));
        }
        self.add(bytes.len() as u64);
    }

    #[inline]
    fn write_u8(&mut self, i: u8) {
        self.add(i as u64);
    }

    #[inline]
    fn write_u32(&mut self, i: u32) {
        self.add(i as u64);
    }

    #[inline]
    fn write_u64(&mut self, i: u64) {
        self.add(i);
    }

    #[inline]
    fn write_i64(&mut self, i: i64) {
        self.add(i as u64);
    }

    #[inline]
    fn write_usize(&mut self, i: usize) {
        self.add(i as u64);
    }

    #[inline]
    fn write_isize(&mut self, i: isize) {
        self.add(i as u64);
    }

    /// The running product mixes its words well only into its high bits,
    /// while a table picks the bucket from the low bits and a 7-bit tag
    /// from bits 57 to 63, or bits 25 to 31 on a 32-bit target such as the
    /// WebAssembly build. The finalizer makes every output bit depend on
    /// every bit of the state, so all of those come out well mixed.
    #[inline]
    fn finish(&self) -> u64 {
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(M1);
        z = (z ^ (z >> 27)).wrapping_mul(M2);
        z ^ (z >> 31)
    }
}

type Build = BuildHasherDefault<FastHasher>;

/// A map keyed with `FastHasher` that can only be written and looked up.
pub struct FastMap<K, V>(HashMap<K, V, Build>);

impl<K, V> Default for FastMap<K, V> {
    fn default() -> Self {
        Self(HashMap::default())
    }
}

impl<K: Hash + Eq, V> FastMap<K, V> {
    #[inline]
    pub fn insert(&mut self, key: K, value: V) -> Option<V> {
        self.0.insert(key, value)
    }

    #[inline]
    pub fn get(&self, key: &K) -> Option<&V> {
        self.0.get(key)
    }

    #[inline]
    pub fn remove(&mut self, key: &K) -> Option<V> {
        self.0.remove(key)
    }

    #[inline]
    pub fn clear(&mut self) {
        self.0.clear()
    }

    /// For tests that check an index against its list.
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.0.len()
    }
}

impl<K: Hash + Eq, V> Index<&K> for FastMap<K, V> {
    type Output = V;

    #[inline]
    fn index(&self, key: &K) -> &V {
        &self.0[key]
    }
}

/// A set keyed with `FastHasher` that can only be added to.
pub struct FastSet<T>(HashSet<T, Build>);

impl<T> Default for FastSet<T> {
    fn default() -> Self {
        Self(HashSet::default())
    }
}

impl<T: Hash + Eq> FastSet<T> {
    /// Adds `value`; whether it was new.
    #[inline]
    pub fn insert(&mut self, value: T) -> bool {
        self.0.insert(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facilities::LOT_WIDTH;
    use std::hash::BuildHasher;

    fn hash_of<T: Hash>(v: T) -> u64 {
        Build::default().hash_one(v)
    }

    #[test]
    fn the_hash_is_the_same_on_every_run_and_target() {
        // Pinned values: a per-process seed, a changed mix or a word that
        // hashes differently on a 32-bit target would move them.
        assert_eq!(hash_of(1_i64), 0xbd88_9c9c_11d5_d361);
        assert_eq!(hash_of((7_i64, 2_i64, Some(4_i64))), 0xef3d_2497_0fc6_5b23);
        // The walk state's cap: `None` and `Some(0)` stay apart.
        assert_eq!(hash_of((7_i64, 0_i64, None::<i64>)), 0x8643_31ee_665a_73eb);
        assert_eq!(hash_of((7_i64, 0_i64, Some(0_i64))), 0x6c67_05cd_853c_49c8);
    }

    /// How many distinct values `bits` takes over the hashes of `keys`.
    fn spread(keys: &[u64], bits: impl Fn(u64) -> u64) -> usize {
        let mut seen: Vec<u64> = keys.iter().map(|&h| bits(h)).collect();
        seen.sort_unstable();
        seen.dedup();
        seen.len()
    }

    #[test]
    fn keys_that_share_their_low_bits_spread_across_buckets_and_tags() {
        // A table picks the bucket from the low bits and a 7-bit tag from
        // bits 57 to 63 on a 64-bit target and 25 to 31 on a 32-bit one.
        // Each family here shares its low bits, which an identity hash
        // leaves in one bucket, or has a stride that a multiply alone maps
        // onto a few tag values.
        let families: [Vec<u64>; 3] = [
            (0..4096_i64).map(|i| hash_of(i << 12)).collect(),
            (0..4096_i64).map(|i| hash_of(i * 64 * LOT_WIDTH)).collect(),
            (0..4096_i64)
                .map(|i| hash_of((i << 8, 0_i64, Some(4_i64))))
                .collect(),
        ];
        for keys in &families {
            // About 2,589 of 4,096 for a random hash.
            assert!(spread(keys, |h| h & 4095) > 2450);
            assert!(spread(keys, |h| h >> 57) >= 124);
            assert!(spread(keys, |h| (h >> 25) & 0x7f) >= 124);
        }
    }

    #[test]
    fn the_map_and_set_answer_as_the_standard_ones() {
        let mut fast: FastMap<i64, i64> = FastMap::default();
        let mut std_map: HashMap<i64, i64> = HashMap::new();
        let mut fast_set: FastSet<(i64, i64, Option<i64>)> = FastSet::default();
        let mut std_set: HashSet<(i64, i64, Option<i64>)> = HashSet::new();
        for i in -500..500_i64 {
            let key = i * 7919 % 4001;
            assert_eq!(fast.insert(key, i), std_map.insert(key, i));
            let state = (key % 50, i % 5, (i % 3 != 0).then_some(i % 4));
            assert_eq!(fast_set.insert(state), std_set.insert(state));
        }
        for (k, v) in &std_map {
            assert_eq!(fast[k], *v);
        }
    }
}
