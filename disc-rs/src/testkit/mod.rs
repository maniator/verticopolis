//! Our own bytes for tests, fixtures and the fuzzer: a KWAJ encoder and an
//! ISO9660 image builder. Behind the `testkit` feature, never in a shipped
//! build. Nothing here is derived from original game files; the encoder's
//! output counts as a ground-truth vector only after libmspack has expanded
//! it back to its input (`tests/oracle.rs`).
pub mod iso_build;
pub mod kwaj_enc;
pub mod oracle;

/// SplitMix64: a small seeded generator, so every vector and fuzz case is
/// reproducible from its seed.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// A value in `0..n` (n > 0).
    pub fn below(&mut self, n: u64) -> u64 {
        self.next_u64() % n
    }

    pub fn chance(&mut self, one_in: u64) -> bool {
        self.below(one_in) == 0
    }

    pub fn bytes(&mut self, n: usize) -> Vec<u8> {
        (0..n).map(|_| self.next_u64() as u8).collect()
    }
}

/// Text-like data with plenty of repeats, the shape real files compress
/// from: words drawn from a small vocabulary, with runs and noise mixed in.
pub fn sample_data(rng: &mut Rng, len: usize) -> Vec<u8> {
    const WORDS: [&[u8]; 12] = [
        b"tower ",
        b"floor ",
        b"lobby ",
        b"office ",
        b"condo ",
        b"hotel ",
        b"elevator ",
        b"stairs ",
        b"the ",
        b"and ",
        b"\r\n",
        b"    ",
    ];
    let mut out = Vec::with_capacity(len + 16);
    while out.len() < len {
        match rng.below(10) {
            0 => {
                let n = 1 + rng.below(6) as usize;
                out.extend(rng.bytes(n));
            }
            1 => {
                let b = rng.next_u64() as u8;
                out.extend(std::iter::repeat_n(b, 1 + rng.below(40) as usize));
            }
            _ => out.extend_from_slice(WORDS[rng.below(WORDS.len() as u64) as usize]),
        }
    }
    out.truncate(len);
    out
}

/// The committed synthetic disc (`fixtures/synthetic-disc.iso.bin`): a plain
/// tower-shaped file at the root and KWAJ members in a subdirectory, every
/// byte our own. `tests/fixtures.rs` checks the committed file is exactly
/// this, so the fixture can never drift into anything else.
pub fn synthetic_disc() -> Vec<u8> {
    synthetic_disc_parts().0
}

/// The synthetic disc and, for each readable file, the plaintext the test
/// kit put in it. The plaintexts pin the expected reads independently of
/// the decoder under test.
pub fn synthetic_disc_parts() -> (Vec<u8>, Vec<(&'static str, Vec<u8>)>) {
    use iso_build::{build, dir, file};
    use kwaj_enc::{kwaj_file, lzh, lzss, LzhShape};
    let mut rng = Rng::new(0x7d7);
    let tower = sample_data(&mut rng, 1500);
    let readme = sample_data(&mut rng, 2500);
    let manifest = b"[files]\r\nSAMPLE1.TDT=1800\r\nREADME.TXT=2500\r\n".to_vec();
    let sample = sample_data(&mut rng, 1800);
    let shape = LzhShape {
        kinds: [1, 2, 3, 2, 1],
        full_tables: false,
        skip_match_one_in: 5,
        split_runs: false,
    };
    let image = build(&[
        file("SETUP.INF", &manifest),
        file("TOWER1.TDT", &tower),
        dir(
            "SAMPLES",
            vec![
                file(
                    "SAMPLE1.TD_",
                    &kwaj_file(3, &lzh(&sample, shape, &mut rng), Some(1800)),
                ),
                file("README.TX_", &kwaj_file(2, &lzss(&readme), Some(2500))),
                file("ZIPPED.EX_", &kwaj_file(4, b"\x00\x00CK", None)),
            ],
        ),
    ]);
    let plain = vec![
        ("SETUP.INF", manifest),
        ("TOWER1.TDT", tower),
        ("SAMPLES/SAMPLE1.TD_", sample),
        ("SAMPLES/README.TX_", readme),
    ];
    (image, plain)
}

/// One encoder vector per seed, rotating through every method (LZH in a
/// random shape), sometimes declaring the expanded length: (input, file).
pub fn kwaj_vector(seed: u64) -> (Vec<u8>, Vec<u8>) {
    use kwaj_enc::{kwaj_file, lzh, lzss, xor, LzhShape};
    let mut rng = Rng::new(seed);
    let len = match rng.below(4) {
        0 => rng.below(40) as usize,
        1 => rng.below(600) as usize,
        _ => 600 + rng.below(6000) as usize,
    };
    let data = if rng.chance(5) {
        rng.bytes(len)
    } else {
        sample_data(&mut rng, len)
    };
    let declared = rng.chance(3).then_some(data.len() as u32);
    let file = match seed % 4 {
        0 => kwaj_file(0, &data, declared),
        1 => kwaj_file(1, &xor(&data), declared),
        2 => kwaj_file(2, &lzss(&data), declared),
        _ => {
            let shape = LzhShape::random(&mut rng);
            kwaj_file(3, &lzh(&data, shape, &mut rng), declared)
        }
    };
    (data, file)
}

/// Flip, overwrite, drop or insert a few bytes past the KWAJ header.
pub fn mutate(rng: &mut Rng, file: &[u8]) -> Vec<u8> {
    let mut f = file.to_vec();
    for _ in 0..1 + rng.below(4) {
        if f.len() <= 14 {
            break;
        }
        let at = 14 + rng.below((f.len() - 14) as u64) as usize;
        match rng.below(4) {
            0 => f[at] ^= 1 << rng.below(8),
            1 => f[at] = rng.next_u64() as u8,
            2 => f.truncate(at),
            _ => f.insert(at, rng.next_u64() as u8),
        }
    }
    f
}
