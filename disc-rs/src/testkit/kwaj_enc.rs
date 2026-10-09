//! A KWAJ encoder written from the same format description as the decoder.
//! It is deliberately simple (greedy matching, plain Huffman) because its job
//! is coverage: every table encoding, both match tables, short and
//! full literal runs, matches reaching into the initial space fill, and
//! window wraparound. Its output is trusted only once libmspack agrees.
use super::Rng;
use crate::kwaj::SIGNATURE;

/// A KWAJ file around an already-encoded payload.
pub fn kwaj_file(method: u16, payload: &[u8], expanded_len: Option<u32>) -> Vec<u8> {
    let mut out = SIGNATURE.to_vec();
    let flags: u16 = if expanded_len.is_some() { 1 } else { 0 };
    let data_offset: u16 = if expanded_len.is_some() { 18 } else { 14 };
    out.extend_from_slice(&method.to_le_bytes());
    out.extend_from_slice(&data_offset.to_le_bytes());
    out.extend_from_slice(&flags.to_le_bytes());
    if let Some(len) = expanded_len {
        out.extend_from_slice(&len.to_le_bytes());
    }
    out.extend_from_slice(payload);
    out
}

/// Method 1: every byte XORed with 0xFF.
pub fn xor(data: &[u8]) -> Vec<u8> {
    data.iter().map(|b| b ^ 0xff).collect()
}

/// Method 2: the QBasic SZDD LZSS. Matches use absolute window positions.
pub fn lzss(data: &[u8]) -> Vec<u8> {
    let mut window = [0x20u8; 4096];
    let mut pos: usize = 4096 - 18;
    let mut out = Vec::new();
    let mut i = 0;
    while i < data.len() {
        let control_at = out.len();
        out.push(0u8);
        for bit in 0..8 {
            if i >= data.len() {
                break;
            }
            let (from, len) = best_lzss(&window, pos, &data[i..]);
            if len >= 3 {
                out.push(from as u8);
                out.push((((from >> 4) & 0xf0) | (len - 3)) as u8);
                for k in 0..len {
                    window[(pos + k) & 4095] = data[i + k];
                }
                pos = (pos + len) & 4095;
                i += len;
            } else {
                out[control_at] |= 1 << bit;
                out.push(data[i]);
                window[pos] = data[i];
                pos = (pos + 1) & 4095;
                i += 1;
            }
        }
    }
    out
}

fn best_lzss(window: &[u8; 4096], pos: usize, rest: &[u8]) -> (usize, usize) {
    let max = rest.len().min(18);
    let (mut best_from, mut best_len) = (0, 0);
    for from in 0..4096 {
        let mut len = 0;
        while len < max {
            let src = (from + len) & 4095;
            // A source byte this match has already overwritten reads back
            // what the match wrote there.
            let written = (src + 4096 - pos) & 4095;
            let b = if written < len {
                rest[written]
            } else {
                window[src]
            };
            if b != rest[len] {
                break;
            }
            len += 1;
        }
        if len > best_len {
            (best_from, best_len) = (from, len);
        }
    }
    (best_from, best_len)
}

/// How an LZH stream should be shaped.
#[derive(Clone, Copy, Debug)]
pub struct LzhShape {
    /// The code-length encoding (0 to 3) for each of the five tables.
    pub kinds: [u8; 5],
    /// Give every symbol a code (a full table) instead of only used ones.
    pub full_tables: bool,
    /// Skip one in this many matches as literals, to vary run lengths.
    pub skip_match_one_in: u64,
    /// Split literal runs into random shorter runs, so a run can follow a
    /// short run and its code is read from MATCHLEN2.
    pub split_runs: bool,
}

impl LzhShape {
    pub fn random(rng: &mut Rng) -> LzhShape {
        let mut kinds = [0u8; 5];
        for k in &mut kinds {
            *k = rng.below(4) as u8;
        }
        LzhShape {
            kinds,
            full_tables: rng.chance(2),
            skip_match_one_in: 2 + rng.below(8),
            split_runs: rng.chance(3),
        }
    }
}

enum Token {
    /// A match: (length 3..=17, distance 0..=4095 as stored).
    Match(usize, usize),
    /// A literal run of 1..=32 bytes.
    Run(Vec<u8>),
}

const SIZES: [usize; 5] = [16, 16, 32, 64, 256];
const FIXED: [u8; 5] = [4, 4, 5, 6, 8];
const MATCHLEN: usize = 0;
const MATCHLEN2: usize = 1;
const LITLEN: usize = 2;
const OFFSET: usize = 3;
const LITERAL: usize = 4;

/// Method 3: LZ + Huffman, payload only (wrap it with `kwaj_file`).
pub fn lzh(data: &[u8], shape: LzhShape, rng: &mut Rng) -> Vec<u8> {
    let tokens = tokenize(data, shape, rng);
    // Which match table each token's leading code uses, as the decoder sees it.
    let mut freq: Vec<Vec<u64>> = SIZES.iter().map(|&n| vec![0; n]).collect();
    let mut use2 = false;
    for t in &tokens {
        let table = if use2 { MATCHLEN2 } else { MATCHLEN };
        match t {
            Token::Match(len, dist) => {
                freq[table][len - 2] += 1;
                freq[OFFSET][dist >> 6] += 1;
                use2 = false;
            }
            Token::Run(bytes) => {
                freq[table][0] += 1;
                freq[LITLEN][bytes.len() - 1] += 1;
                for &b in bytes {
                    freq[LITERAL][b as usize] += 1;
                }
                use2 = bytes.len() != 32;
            }
        }
    }
    let mut lengths: Vec<Vec<u8>> = (0..5)
        .map(|t| {
            if shape.kinds[t] == 0 {
                vec![FIXED[t]; SIZES[t]]
            } else {
                huffman_lengths(&freq[t], shape.full_tables)
            }
        })
        .collect();
    let mut kinds = shape.kinds;
    loop {
        if let Some(stream) = emit(&tokens, &kinds, &lengths) {
            return stream;
        }
        // The final padding would complete a code: give both match tables a
        // code longer than any padding (lengths 1..=15 and 15 is complete).
        let skew: Vec<u8> = (1..=15).chain(std::iter::once(15)).collect();
        lengths[MATCHLEN] = skew.clone();
        lengths[MATCHLEN2] = skew;
        kinds[MATCHLEN] = 3;
        kinds[MATCHLEN2] = 3;
    }
}

fn tokenize(data: &[u8], shape: LzhShape, rng: &mut Rng) -> Vec<Token> {
    let mut ring = [0x20u8; 4096];
    let mut pos: usize = 4096 - 17;
    let mut tokens = Vec::new();
    let mut literals: Vec<u8> = Vec::new();
    let flush = |literals: &mut Vec<u8>, tokens: &mut Vec<Token>, rng: &mut Rng| {
        let mut rest = &literals[..];
        while !rest.is_empty() {
            let max = rest.len().min(32);
            let n = if shape.split_runs {
                1 + rng.below(max as u64) as usize
            } else {
                max
            };
            tokens.push(Token::Run(rest[..n].to_vec()));
            rest = &rest[n..];
        }
        literals.clear();
    };
    let mut i = 0;
    while i < data.len() {
        let (dist, len) = best_lzh(&ring, pos, &data[i..]);
        if len >= 3 && !rng.chance(shape.skip_match_one_in) {
            flush(&mut literals, &mut tokens, rng);
            tokens.push(Token::Match(len, dist));
            for k in 0..len {
                ring[(pos + k) & 4095] = data[i + k];
            }
            pos = (pos + len) & 4095;
            i += len;
        } else {
            literals.push(data[i]);
            ring[pos] = data[i];
            pos = (pos + 1) & 4095;
            i += 1;
        }
    }
    flush(&mut literals, &mut tokens, rng);
    tokens
}

/// The longest match for `rest` at ring position `pos`, as (stored distance,
/// length). A stored distance of 0 reaches back a full 4096 bytes.
fn best_lzh(ring: &[u8; 4096], pos: usize, rest: &[u8]) -> (usize, usize) {
    let max = rest.len().min(17);
    let (mut best_dist, mut best_len) = (0, 0);
    for dist in 0..4096 {
        let back = if dist == 0 { 4096 } else { dist };
        let mut len = 0;
        while len < max {
            let b = if len >= back {
                rest[len - back]
            } else {
                ring[(pos + 4096 - back + len) & 4095]
            };
            if b != rest[len] {
                break;
            }
            len += 1;
        }
        if len > best_len {
            (best_dist, best_len) = (dist, len);
        }
    }
    (best_dist, best_len)
}

/// Code lengths for `freq`, at most 15 bits. Unused symbols get no code
/// unless `full`; at least two symbols always get one.
fn huffman_lengths(freq: &[u64], full: bool) -> Vec<u8> {
    let mut f: Vec<u64> = freq.iter().map(|&x| if full { x + 1 } else { x }).collect();
    let used = f.iter().filter(|&&x| x > 0).count();
    for x in f
        .iter_mut()
        .filter(|x| **x == 0)
        .take(2usize.saturating_sub(used))
    {
        *x = 1;
    }
    loop {
        let lengths = plain_huffman(&f);
        if lengths.iter().all(|&l| l <= 15) {
            return lengths;
        }
        for x in f.iter_mut().filter(|x| **x > 0) {
            *x = (*x >> 1) + 1;
        }
    }
}

fn plain_huffman(f: &[u64]) -> Vec<u8> {
    // Nodes: leaves 0..n, then merges. Repeatedly join the two lightest.
    let mut weight: Vec<u64> = f.to_vec();
    let mut parent: Vec<usize> = vec![usize::MAX; f.len()];
    let mut live: Vec<usize> = (0..f.len()).filter(|&i| f[i] > 0).collect();
    while live.len() > 1 {
        live.sort_by_key(|&i| (std::cmp::Reverse(weight[i]), std::cmp::Reverse(i)));
        let a = live.pop().unwrap_or_else(|| unreachable!());
        let b = live.pop().unwrap_or_else(|| unreachable!());
        let node = weight.len();
        weight.push(weight[a] + weight[b]);
        parent.push(usize::MAX);
        parent[a] = node;
        parent[b] = node;
        live.push(node);
    }
    (0..f.len())
        .map(|i| {
            if f[i] == 0 {
                return 0;
            }
            let (mut depth, mut n) = (0u32, i);
            while parent[n] != usize::MAX {
                n = parent[n];
                depth += 1;
            }
            depth.min(255) as u8
        })
        .collect()
}

/// Canonical codes for `lengths`, as (code, length) per symbol.
fn canonical(lengths: &[u8]) -> Vec<(u32, u8)> {
    let mut count = [0u32; 16];
    for &l in lengths {
        count[l as usize] += 1;
    }
    count[0] = 0;
    let mut next = [0u32; 16];
    let mut code = 0;
    for len in 1..16 {
        code = (code + count[len - 1]) << 1;
        next[len] = code;
    }
    lengths
        .iter()
        .map(|&l| {
            if l == 0 {
                return (0, 0);
            }
            let c = next[l as usize];
            next[l as usize] += 1;
            (c, l)
        })
        .collect()
}

struct BitWriter {
    out: Vec<u8>,
    used: u32,
}

impl BitWriter {
    fn put(&mut self, value: u32, n: u8) {
        for i in (0..n).rev() {
            if self.used.is_multiple_of(8) {
                self.out.push(0);
            }
            if (value >> i) & 1 == 1 {
                let last = self.out.len() - 1;
                self.out[last] |= 0x80 >> (self.used % 8);
            }
            self.used += 1;
        }
    }
}

/// The stream for `tokens`, or `None` when the final padding would complete
/// a code in the table the decoder reads last (it would decode a token that
/// was never written).
fn emit(tokens: &[Token], kinds: &[u8; 5], lengths: &[Vec<u8>]) -> Option<Vec<u8>> {
    let codes: Vec<Vec<(u32, u8)>> = lengths.iter().map(|l| canonical(l)).collect();
    let mut w = BitWriter {
        out: Vec::new(),
        used: 0,
    };
    for &k in kinds {
        w.put(k as u32, 4);
    }
    w.put(0, 4);
    for t in 0..5 {
        let l = &lengths[t];
        match kinds[t] {
            0 => {}
            1 => {
                w.put(l[0] as u32, 4);
                for s in 1..l.len() {
                    if l[s] == l[s - 1] {
                        w.put(0, 1);
                    } else if l[s] == l[s - 1] + 1 {
                        w.put(0b10, 2);
                    } else {
                        w.put(0b11, 2);
                        w.put(l[s] as u32, 4);
                    }
                }
            }
            2 => {
                w.put(l[0] as u32, 4);
                for s in 1..l.len() {
                    let d = l[s] as i32 - l[s - 1] as i32;
                    if (-1..=1).contains(&d) {
                        w.put((d + 1) as u32, 2);
                    } else {
                        w.put(3, 2);
                        w.put(l[s] as u32, 4);
                    }
                }
            }
            _ => {
                for &x in l {
                    w.put(x as u32, 4);
                }
            }
        }
    }
    let sym = |w: &mut BitWriter, table: usize, s: usize| {
        let (c, n) = codes[table][s];
        assert!(n > 0, "symbol {s} of table {table} has no code");
        w.put(c, n);
    };
    let mut use2 = false;
    for t in tokens {
        let table = if use2 { MATCHLEN2 } else { MATCHLEN };
        match t {
            Token::Match(len, dist) => {
                sym(&mut w, table, len - 2);
                sym(&mut w, OFFSET, dist >> 6);
                w.put((dist & 63) as u32, 6);
                use2 = false;
            }
            Token::Run(bytes) => {
                sym(&mut w, table, 0);
                sym(&mut w, LITLEN, bytes.len() - 1);
                for &b in bytes {
                    sym(&mut w, LITERAL, b as usize);
                }
                use2 = bytes.len() != 32;
            }
        }
    }
    let pad = (8 - w.used % 8) % 8;
    if pad > 0 {
        // Pad with the head of the longest code in the last table read, so
        // the padding is a strict prefix of a code and never a whole one.
        let last = &codes[if use2 { MATCHLEN2 } else { MATCHLEN }];
        let &(code, len) = last.iter().max_by_key(|(_, l)| *l)?;
        if len as u32 <= pad {
            return None;
        }
        w.put(code >> (len as u32 - pad), pad as u8);
    }
    Some(w.out)
}
