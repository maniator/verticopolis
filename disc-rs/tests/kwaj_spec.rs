//! KWAJ against the format description: every method, every code-length
//! encoding for every table, and the stream features a real file leans on.
//! These run everywhere; `tests/oracle.rs` checks the same shapes against
//! libmspack where it is installed.
#![cfg(feature = "testkit")]

use verticopolis_disc::kwaj::{self, parse_header};
use verticopolis_disc::testkit::kwaj_enc::{self, LzhShape};
use verticopolis_disc::testkit::{sample_data, Rng};
use verticopolis_disc::{Code, Limits};

fn roundtrip_lzh(data: &[u8], shape: LzhShape, seed: u64) {
    let mut rng = Rng::new(seed);
    let file = kwaj_enc::kwaj_file(3, &kwaj_enc::lzh(data, shape, &mut rng), None);
    let limits = Limits {
        max_expansion_ratio: verticopolis_disc::limits::HARD_LIMITS.max_expansion_ratio,
        ..Limits::default()
    };
    assert_eq!(
        kwaj::expand(&file, &limits).unwrap(),
        data,
        "shape {shape:?}"
    );
}

#[test]
fn every_code_length_encoding_on_every_table() {
    let mut rng = Rng::new(1);
    let data = sample_data(&mut rng, 5000);
    for table in 0..5 {
        for kind in 0..4 {
            let mut kinds = [0u8; 5];
            kinds[table] = kind;
            for full_tables in [false, true] {
                let shape = LzhShape {
                    kinds,
                    full_tables,
                    skip_match_one_in: 4,
                    split_runs: full_tables,
                };
                roundtrip_lzh(&data, shape, table as u64 * 10 + kind as u64);
            }
        }
    }
}

#[test]
fn literal_runs_long_and_short_and_matches_after_them() {
    // Incompressible bytes make runs of every length up to the 32-byte
    // maximum; repeats between them exercise MATCHLEN2.
    let mut rng = Rng::new(2);
    let mut data = Vec::new();
    for n in 1..=70 {
        data.extend(rng.bytes(n));
        data.extend_from_slice(b"tower tower");
    }
    roundtrip_lzh(
        &data,
        LzhShape {
            kinds: [3, 2, 1, 0, 3],
            full_tables: true,
            skip_match_one_in: 1000,
            split_runs: false,
        },
        3,
    );
}

#[test]
fn matches_reach_into_the_initial_space_fill() {
    roundtrip_lzh(
        b"                    spaces first, then text",
        LzhShape {
            kinds: [0; 5],
            full_tables: true,
            skip_match_one_in: 1000,
            split_runs: false,
        },
        4,
    );
}

#[test]
fn the_window_wraps_past_4096_bytes() {
    let mut rng = Rng::new(5);
    let data = sample_data(&mut rng, 20_000);
    roundtrip_lzh(&data, LzhShape::random(&mut rng), 6);
}

#[test]
fn empty_and_tiny_inputs() {
    for data in [&b""[..], b"x", b"xy", b"xyz"] {
        roundtrip_lzh(
            data,
            LzhShape {
                kinds: [1; 5],
                full_tables: false,
                skip_match_one_in: 2,
                split_runs: true,
            },
            7,
        );
    }
}

#[test]
fn store_xor_and_lzss() {
    let mut rng = Rng::new(8);
    let data = sample_data(&mut rng, 6000);
    let limits = Limits::default();
    let stored = kwaj_enc::kwaj_file(0, &data, None);
    let xored = kwaj_enc::kwaj_file(1, &kwaj_enc::xor(&data), None);
    let lzss = kwaj_enc::kwaj_file(2, &kwaj_enc::lzss(&data), None);
    for f in [stored, xored, lzss] {
        assert_eq!(kwaj::expand(&f, &limits).unwrap(), data);
    }
}

#[test]
fn reads_the_expanded_length_extension() {
    let f = kwaj_enc::kwaj_file(0, b"hello", Some(5));
    let h = parse_header(&f).unwrap();
    assert_eq!((h.method, h.data_offset, h.expanded_len), (0, 18, Some(5)));
    assert_eq!(kwaj::expand(&f, &Limits::default()).unwrap(), b"hello");
}

#[test]
fn refuses_malformed_headers() {
    let limits = Limits::default();
    let mut short = kwaj_enc::kwaj_file(0, b"", None);
    short.truncate(12);
    assert_eq!(
        kwaj::expand(&short, &limits).unwrap_err().code,
        Code::CorruptStream
    );
    let mut inside = kwaj_enc::kwaj_file(0, b"x", None);
    inside[10] = 4; // data offset inside the header
    assert_eq!(
        kwaj::expand(&inside, &limits).unwrap_err().code,
        Code::CorruptStream
    );
    let mut past = kwaj_enc::kwaj_file(0, b"x", None);
    past[10] = 200; // data offset past the end
    assert_eq!(
        kwaj::expand(&past, &limits).unwrap_err().code,
        Code::CorruptStream
    );
    let mut no_ext = kwaj_enc::kwaj_file(0, b"x", Some(1));
    no_ext[10] = 14; // claims the length extension but leaves it no room
    assert_eq!(
        kwaj::expand(&no_ext, &limits).unwrap_err().code,
        Code::CorruptStream
    );
    let unknown = kwaj_enc::kwaj_file(9, b"x", None);
    assert_eq!(
        kwaj::expand(&unknown, &limits).unwrap_err().code,
        Code::UnsupportedCompression
    );
    assert_eq!(
        kwaj::expand(b"SZDD\x88\xf0\x27\x33", &limits)
            .unwrap_err()
            .code,
        Code::CorruptStream
    );
}

#[test]
fn refuses_a_stream_cut_inside_its_tables() {
    let mut rng = Rng::new(10);
    let data = sample_data(&mut rng, 500);
    let payload = kwaj_enc::lzh(
        &data,
        LzhShape {
            kinds: [3; 5],
            full_tables: true,
            skip_match_one_in: 4,
            split_runs: true,
        },
        &mut rng,
    );
    let cut = kwaj_enc::kwaj_file(3, &payload[..40], None);
    assert_eq!(
        kwaj::expand(&cut, &Limits::default()).unwrap_err().code,
        Code::CorruptStream
    );
}

#[test]
fn a_cut_stream_keeps_every_whole_symbol_before_the_cut() {
    let mut rng = Rng::new(11);
    let data = sample_data(&mut rng, 2000);
    let payload = kwaj_enc::lzh(&data, LzhShape::random(&mut rng), &mut rng);
    let limits = Limits::default();
    let mut previous = 0;
    for cut in (payload.len() / 2)..payload.len() {
        let got = kwaj::expand(&kwaj_enc::kwaj_file(3, &payload[..cut], None), &limits).unwrap();
        assert!(
            data.starts_with(&got),
            "a cut stream must expand to a prefix"
        );
        assert!(got.len() >= previous, "a longer cut never expands to less");
        previous = got.len();
    }
}

#[test]
fn every_cap_refuses_rather_than_truncates() {
    let data = vec![b'z'; 9000];
    let mut rng = Rng::new(12);
    let file = kwaj_enc::kwaj_file(
        3,
        &kwaj_enc::lzh(&data, LzhShape::random(&mut rng), &mut rng),
        None,
    );
    let cap = Limits {
        max_file_bytes: 8999,
        max_expansion_ratio: verticopolis_disc::limits::HARD_LIMITS.max_expansion_ratio,
        ..Limits::default()
    };
    assert_eq!(kwaj::expand(&file, &cap).unwrap_err().code, Code::OutputCap);
    let lzss = kwaj_enc::kwaj_file(2, &kwaj_enc::lzss(&data), None);
    assert_eq!(kwaj::expand(&lzss, &cap).unwrap_err().code, Code::OutputCap);
    let store = kwaj_enc::kwaj_file(0, &data, None);
    assert_eq!(
        kwaj::expand(&store, &cap).unwrap_err().code,
        Code::OutputCap
    );
}

#[test]
fn a_full_run_hands_the_next_code_back_to_matchlen() {
    // Split runs put literal runs straight after short ones, so run codes
    // are read from MATCHLEN2, and full runs read from either table.
    let mut rng = Rng::new(13);
    let data = rng.bytes(3000);
    for kinds in [[3, 2, 1, 0, 3], [1, 3, 2, 3, 0]] {
        roundtrip_lzh(
            &data,
            LzhShape {
                kinds,
                full_tables: true,
                skip_match_one_in: 3,
                split_runs: true,
            },
            14,
        );
    }
}

#[test]
fn a_declared_length_must_match_the_expansion() {
    let mut rng = Rng::new(15);
    let data = sample_data(&mut rng, 800);
    let payload = kwaj_enc::lzh(&data, LzhShape::random(&mut rng), &mut rng);
    let limits = Limits::default();
    assert_eq!(
        kwaj::expand(&kwaj_enc::kwaj_file(3, &payload, Some(800)), &limits).unwrap(),
        data
    );
    for declared in [799, 801, 0, u32::MAX] {
        let e =
            kwaj::expand(&kwaj_enc::kwaj_file(3, &payload, Some(declared)), &limits).unwrap_err();
        assert_eq!(e.code, Code::CorruptStream);
        assert!(e.detail.starts_with(kwaj::strict::DECLARED_LENGTH), "{e}");
    }
    // A cut stream that declares its length is caught, where one that does
    // not simply expands to a prefix.
    let cut = &payload[..payload.len() - 20];
    assert!(kwaj::expand(&kwaj_enc::kwaj_file(3, cut, Some(800)), &limits).is_err());
}

#[test]
fn the_expansion_ratio_counts_compressed_data_and_not_the_header() {
    let mut rng = Rng::new(16);
    let zeros = vec![0u8; 40_000];
    let payload = kwaj_enc::lzh(&zeros, LzhShape::random(&mut rng), &mut rng);
    // Pad the header out to a 60,000-byte data offset.
    let pad = 60_000 - 14;
    let mut file = kwaj_enc::kwaj_file(3, &payload, None);
    file[10..12].copy_from_slice(&60_000u16.to_le_bytes());
    file.splice(14..14, std::iter::repeat_n(0u8, pad));
    let ratio = Limits {
        max_expansion_ratio: 4,
        ..Limits::default()
    };
    assert!(
        payload.len() * 4 < zeros.len(),
        "the payload must compress past the ratio"
    );
    assert_eq!(
        kwaj::expand(&file, &ratio).unwrap_err().code,
        Code::OutputCap
    );
    assert_eq!(kwaj::output_cap(&file, &ratio), payload.len() * 4);
}
