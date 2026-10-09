//! libmspack as the oracle. Our decoder was written from the format
//! description; these tests check it against a decoder we did not write.
//!
//! `VC_KWAJ_ORACLE` names a `kwajd` binary: `tools/simtower/docker/kwajd.c`
//! compiled against libmspack (`cc kwajd.c -lmspack`). Without it the tests
//! skip, unless `VC_REQUIRE_KWAJ_ORACLE=1`, which CI sets so a missing oracle
//! fails instead. libmspack is a test-time tool only; nothing links it.
//!
//! The comparison rule and its listed exceptions are documented and
//! implemented once, in `verticopolis_disc::testkit::oracle`, which the
//! fuzzer shares. The one place libmspack departs from the format
//! description, its early stop near the end of the input, is pinned by
//! `libmspack_drops_a_final_short_run_that_the_format_keeps` (a well-formed
//! stream) and `libmspack_stops_early_on_a_cut_stream_that_ends_in_a_match`
//! (fuzz seed 3560, which showed the rule is general).
#![cfg(feature = "testkit")]

use verticopolis_disc::kwaj;
use verticopolis_disc::source::Bytes;
use verticopolis_disc::testkit::kwaj_enc::{self, LzhShape};
use verticopolis_disc::testkit::oracle::{self, binary as oracle_binary};
use verticopolis_disc::testkit::{kwaj_vector, mutate, synthetic_disc, Rng};
use verticopolis_disc::{Code, Disc, Limits};

fn generous() -> Limits {
    Limits {
        max_expansion_ratio: verticopolis_disc::limits::HARD_LIMITS.max_expansion_ratio,
        ..Limits::default()
    }
}

#[test]
fn libmspack_expands_every_encoder_vector_to_its_input_and_so_do_we() {
    let Some(kwajd) = oracle_binary() else { return };
    let mut failures = Vec::new();
    for seed in 0..400u64 {
        let (data, file) = kwaj_vector(seed);
        match oracle::expand(&kwajd, &file, &format!("v{seed}")) {
            Some(theirs) if theirs == data => {}
            Some(theirs) => failures.push(format!(
                "seed {seed}: libmspack gave {} bytes, input was {}",
                theirs.len(),
                data.len()
            )),
            None => failures.push(format!("seed {seed}: libmspack refused our vector")),
        }
        match kwaj::expand(&file, &generous()) {
            Ok(ours) if ours == data => {}
            Ok(ours) => failures.push(format!(
                "seed {seed}: we gave {} bytes, input was {}",
                ours.len(),
                data.len()
            )),
            Err(e) => failures.push(format!("seed {seed}: we refused: {e}")),
        }
    }
    assert!(
        failures.is_empty(),
        "{} disagreements:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

struct BitWriter {
    out: Vec<u8>,
    used: u32,
}

impl BitWriter {
    fn put(&mut self, v: u32, n: u32) {
        for i in (0..n).rev() {
            if self.used.is_multiple_of(8) {
                self.out.push(0);
            }
            if (v >> i) & 1 == 1 {
                let last = self.out.len() - 1;
                self.out[last] |= 0x80 >> (self.used % 8);
            }
            self.used += 1;
        }
    }
}

#[test]
fn libmspack_drops_a_final_short_run_that_the_format_keeps() {
    let Some(kwajd) = oracle_binary() else { return };
    // Both match tables skewed (lengths 1..=15 and 15, so symbol 0 is the
    // one-bit code 0 and the padding can be a strict prefix of a 15-bit
    // code); a literal table where 'A' is the one-bit code 0.
    let skew: Vec<u32> = (1..=15).chain(std::iter::once(15)).collect();
    let mut literal = vec![0u32; 256];
    for (i, s) in (65..81).enumerate() {
        literal[s] = if i < 15 { i as u32 + 1 } else { 15 };
    }
    let mut w = BitWriter {
        out: Vec::new(),
        used: 0,
    };
    for kind in [3, 3, 0, 0, 3, 0] {
        w.put(kind, 4);
    }
    for &l in skew.iter().chain(skew.iter()).chain(literal.iter()) {
        w.put(l, 4);
    }
    // A run of three 'A', then (from MATCHLEN2) a final run of one 'A'.
    w.put(0, 1);
    w.put(2, 5);
    w.put(0, 3);
    w.put(0, 1);
    w.put(0, 5);
    w.put(0, 1);
    let pad = (8 - w.used % 8) % 8;
    w.put((1 << pad) - 1, pad);
    let file = kwaj_enc::kwaj_file(3, &w.out, None);
    assert_eq!(kwaj::expand(&file, &Limits::default()).unwrap(), b"AAAA");
    assert_eq!(oracle::expand(&kwajd, &file, "quirk").unwrap(), b"AAA");
}

#[test]
fn mutated_streams_expand_the_same_or_refuse_where_libmspack_does() {
    let Some(kwajd) = oracle_binary() else { return };
    let mut failures = Vec::new();
    let mut rng = Rng::new(0x5eed);
    for case in 0..2000u64 {
        let (_, file) = kwaj_vector(1000 + case);
        let bad = mutate(&mut rng, &file);
        if let Err(why) = oracle::compare(&kwajd, &bad, &format!("m{case}"), &generous()) {
            failures.push(format!("case {case}: {why}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} disagreements:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn the_cap_refuses_what_libmspack_would_expand_past_it() {
    let Some(kwajd) = oracle_binary() else { return };
    let mut rng = Rng::new(7);
    let data = vec![b'x'; 50_000];
    // A fixed shape: one literal, then full-length matches to the end, so the
    // stream ends on a match and libmspack's end quirk cannot apply.
    let shape = LzhShape {
        kinds: [0; 5],
        full_tables: true,
        skip_match_one_in: 1_000_000,
        split_runs: false,
    };
    let file = kwaj_enc::kwaj_file(3, &kwaj_enc::lzh(&data, shape, &mut rng), None);
    assert_eq!(
        oracle::expand(&kwajd, &file, "cap").as_deref(),
        Some(&data[..])
    );
    let tight = Limits {
        max_file_bytes: 10_000,
        ..generous()
    };
    assert_eq!(
        kwaj::expand(&file, &tight).unwrap_err().code,
        Code::OutputCap
    );
}

#[test]
fn the_committed_fixtures_kwaj_members_expand_the_same_under_libmspack() {
    let Some(kwajd) = oracle_binary() else { return };
    let image = synthetic_disc();
    let mut disc = Disc::open(Bytes(&image), Limits::default()).unwrap();
    for e in disc
        .opened()
        .entries
        .into_iter()
        .filter(|e| e.stored == "kwaj" && e.method != Some(4))
    {
        let stored = disc.read_stored(e.token).unwrap();
        let ours = disc.read(e.token).unwrap().1;
        assert_eq!(
            oracle::expand(&kwajd, &stored, "fixture").as_deref(),
            Some(&ours[..]),
            "{}",
            e.path
        );
    }
}

/// Fuzz seed 3560: a cut stream whose last whole token is a match, starting
/// 11 bits before the end. libmspack's prefetch reaches past the end on the
/// literal before it, so it stops there and drops the match; we keep it.
#[test]
fn libmspack_stops_early_on_a_cut_stream_that_ends_in_a_match() {
    let Some(kwajd) = oracle_binary() else { return };
    let sub = |role: u64| Rng::new(3560 ^ role.wrapping_mul(0x9e37_79b9_7f4a_7c15)).next_u64();
    let mut rng = Rng::new(sub(2));
    let (_, file) = kwaj_vector(sub(3));
    let cut = mutate(&mut rng, &file);
    let theirs = oracle::expand(&kwajd, &cut, "seed3560").expect("libmspack expands it");
    let (ours, tail) = kwaj::expand_with_tail(&cut, &generous());
    let ours = ours.expect("we expand it");
    assert!(theirs.len() < ours.len(), "libmspack stops early here");
    assert!(oracle::is_end_quirk(&theirs, &ours, &tail));
    assert_eq!(
        oracle::compare(&kwajd, &cut, "seed3560", &generous()),
        Ok(())
    );
}
