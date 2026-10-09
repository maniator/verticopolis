//! The ISO walk and the `Disc` surface over images we build ourselves.
//!
//! The hostile cases port the TypeScript reader's suite (the desktop shell's
//! `legacyIso.test.ts`, reviewed before this crate replaced it), one test
//! each:
//!
//! | TypeScript case | Here |
//! | --- | --- |
//! | lists files across the root and a subdirectory, version-stripped and uppercased | `lists_files_across_the_root_and_a_subdirectory_version_stripped_and_uppercased` |
//! | listTowerFiles returns only the .TDT entries | not ported: the crate does not decide what a tower is; the importer does |
//! | reads each file's exact bytes | `reads_each_files_exact_bytes` |
//! | refuses a truncated image instead of throwing a RangeError | `refuses_a_truncated_image` |
//! | refuses a file that is not an ISO (bad CD001 identifier) | `refuses_a_file_that_is_not_an_iso` |
//! | read refuses an entry whose extent runs past the image | `an_entry_whose_extent_runs_past_the_image_lists_as_unreadable_and_refuses_on_read` |
//! | refuses a directory record with a length below the 34-byte minimum | `refuses_a_directory_record_below_the_34_byte_minimum` |
//! | refuses an oversized tower extent before allocating | `refuses_an_oversized_file_before_allocating_it` |
//! | bounds directory traversal by the record budget | `bounds_directory_traversal_by_the_record_budget` |
//!
//! The rest cover what a sector-at-a-time reader, the KWAJ peek and the
//! review rounds added.
#![cfg(feature = "testkit")]

use verticopolis_disc::iso::SECTOR;
use verticopolis_disc::source::Bytes;
use verticopolis_disc::testkit::iso_build::{
    build, dir, dir_record, file, PVD_SECTOR, ROOT_SECTOR,
};
use verticopolis_disc::testkit::kwaj_enc::{self, LzhShape};
use verticopolis_disc::testkit::{sample_data, Rng};
use verticopolis_disc::{Code, Disc, Limits};

const S: usize = SECTOR as usize;
const DATA1: &[u8] = b"TDT1";
const DATA2: &[u8] = b"TDT5!";

/// The TypeScript suite's image: one tower at the root, one in `SUB`.
fn two_towers() -> Vec<u8> {
    build(&[
        file("TOWER1.TDT", DATA1),
        dir("SUB", vec![file("TOWER5.TDT", DATA2)]),
    ])
}

fn open(image: &[u8], limits: Limits) -> Result<Disc<Bytes<'_>>, verticopolis_disc::Refusal> {
    Disc::open(Bytes(image), limits)
}

fn paths(image: &[u8]) -> Vec<String> {
    open(image, Limits::default())
        .unwrap()
        .opened()
        .entries
        .into_iter()
        .map(|e| e.path)
        .collect()
}

fn code(r: Result<Disc<Bytes<'_>>, verticopolis_disc::Refusal>) -> Code {
    r.err().expect("refused").code
}

#[test]
fn lists_files_across_the_root_and_a_subdirectory_version_stripped_and_uppercased() {
    assert_eq!(paths(&two_towers()), vec!["TOWER1.TDT", "SUB/TOWER5.TDT"]);
}

#[test]
fn reads_each_files_exact_bytes() {
    let image = two_towers();
    let mut disc = open(&image, Limits::default()).unwrap();
    let opened = disc.opened();
    assert_eq!(opened.schema, 1);
    for (entry, want) in opened.entries.iter().zip([DATA1, DATA2]) {
        assert_eq!(entry.stored, "plain");
        let (info, bytes) = disc.read(entry.token).unwrap();
        assert_eq!(bytes, want);
        assert_eq!(info.size as usize, want.len());
    }
}

#[test]
fn refuses_a_truncated_image() {
    assert_eq!(
        code(open(&[0u8; 1024], Limits::default())),
        Code::NotAnImage
    );
}

#[test]
fn refuses_a_file_that_is_not_an_iso() {
    let mut image = two_towers();
    image[PVD_SECTOR * S + 1] = 0; // the "C" of "CD001"
    assert_eq!(code(open(&image, Limits::default())), Code::NotAnImage);
}

#[test]
fn an_entry_whose_extent_runs_past_the_image_lists_as_unreadable_and_refuses_on_read() {
    let mut image = two_towers();
    // Point TOWER1.TDT (the third root record, after "." and "..") far away,
    // in both halves of its both-endian address.
    let at = ROOT_SECTOR * S + 34 + 34 + 2;
    image[at..at + 4].copy_from_slice(&999_999u32.to_le_bytes());
    image[at + 4..at + 8].copy_from_slice(&999_999u32.to_be_bytes());
    let mut disc = open(&image, Limits::default()).unwrap();
    let entries = disc.opened().entries;
    assert_eq!(entries[0].stored, "unreadable");
    assert_eq!(disc.read(0).unwrap_err().code, Code::Truncated);
    // The rest of the disc stays readable.
    assert_eq!(disc.read(1).unwrap().1, DATA2);
}

#[test]
fn an_empty_file_lists_without_a_peek_even_at_an_odd_address() {
    let mut image = build(&[file("EMPTY.TXT", b""), file("TOWER1.TDT", DATA1)]);
    let at = ROOT_SECTOR * S + 34 + 34 + 2;
    image[at..at + 4].copy_from_slice(&999_999u32.to_le_bytes());
    image[at + 4..at + 8].copy_from_slice(&999_999u32.to_be_bytes());
    let disc = open(&image, Limits::default()).unwrap();
    assert_eq!(disc.opened().entries[1].stored, "plain");
}

#[test]
fn refuses_a_logical_block_size_other_than_2048() {
    let mut image = two_towers();
    let at = PVD_SECTOR * S + 128;
    image[at..at + 2].copy_from_slice(&512u16.to_le_bytes());
    image[at + 2..at + 4].copy_from_slice(&512u16.to_be_bytes());
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
}

#[test]
fn a_record_whose_endian_halves_disagree_lists_as_unreadable() {
    let mut image = two_towers();
    let size_le = ROOT_SECTOR * S + 34 + 34 + 10;
    image[size_le] ^= 1; // the size's little-endian half only
    let mut disc = open(&image, Limits::default()).unwrap();
    assert_eq!(disc.opened().entries[0].stored, "unreadable");
    assert_eq!(disc.read(0).unwrap_err().code, Code::CorruptImage);
    assert_eq!(disc.read(1).unwrap().1, DATA2);
}

#[test]
fn an_empty_big_endian_half_is_accepted() {
    let mut image = two_towers();
    let at = ROOT_SECTOR * S + 34 + 34;
    image[at + 6..at + 10].fill(0); // the LBA's big-endian half
    image[at + 14..at + 18].fill(0); // the size's big-endian half
    assert_eq!(
        open(&image, Limits::default()).unwrap().read(0).unwrap().1,
        DATA1
    );
}

#[test]
fn a_file_record_with_an_unsupported_layout_lists_as_unreadable() {
    let file_rec = ROOT_SECTOR * S + 34 + 34;
    for (offset, value) in [(1, 1u8), (25, 0x80), (26, 1), (27, 1)] {
        let mut image = two_towers();
        image[file_rec + offset] = value;
        let mut disc = open(&image, Limits::default()).unwrap();
        assert_eq!(
            disc.opened().entries[0].stored,
            "unreadable",
            "byte {offset}"
        );
        assert_eq!(disc.read(1).unwrap().1, DATA2, "byte {offset}");
    }
}

#[test]
fn a_damaged_directory_record_refuses_the_walk() {
    // SUB is the fourth root record: ".", "..", TOWER1.TDT, SUB.
    let mut image = two_towers();
    let tower = dir_record(b"TOWER1.TDT;1", 0, 0, false).len();
    let sub = ROOT_SECTOR * S + 34 + 34 + tower;
    image[sub + 26] = 1; // interleaved
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
}

#[test]
fn refuses_names_that_could_spoof_a_path() {
    for bad in [
        "SUB/TOWER5.TDT",
        "A\\B.TDT",
        "..",
        ".",
        "...",
        "A:B",
        "A B",
        "  ",
        "A*",
    ] {
        let image = build(&[file(bad, DATA1)]);
        assert_eq!(
            code(open(&image, Limits::default())),
            Code::CorruptImage,
            "{bad:?}"
        );
    }
    // The identifier ";1" strips to nothing.
    let image = build(&[file("", DATA1)]);
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
    // A directory named "..." would otherwise become "../".
    let image = build(&[dir("...", vec![file("X", DATA1)])]);
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
}

#[test]
fn a_name_keeps_dots_inside_and_drops_every_one_at_the_end() {
    let image = build(&[file("A..", b"a"), file("B.C", b"b")]);
    assert_eq!(paths(&image), vec!["A", "B.C"]);
    // "A.." and "A" would be one file on a filesystem that trims dots.
    let image = build(&[file("A..", b"a"), file("A", b"b")]);
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
}

#[test]
fn refuses_a_malformed_version() {
    let mut image = two_towers();
    // "TOWER1.TDT;1" becomes "TOWER1.TDT;X".
    let at = ROOT_SECTOR * S + 34 + 34 + 33 + 11;
    image[at] = b'X';
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
}

#[test]
fn of_several_versions_the_highest_is_listed() {
    let mut image = build(&[file("A", b"one"), file("B", b"two")]);
    // Rename "B;1" to "A;2": two versions of A.
    let rec_b = ROOT_SECTOR * S + 34 + 34 + dir_record(b"A;1", 0, 0, false).len();
    image[rec_b + 33] = b'A';
    image[rec_b + 35] = b'2';
    let mut disc = open(&image, Limits::default()).unwrap();
    let entries = disc.opened().entries;
    assert_eq!(
        entries.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(),
        vec!["A"]
    );
    assert_eq!(disc.read(entries[0].token).unwrap().1, b"two");
}

#[test]
fn refuses_two_records_that_resolve_to_one_path() {
    // The same name at the same version, after uppercasing.
    let image = build(&[file("TOWER1.TDT", DATA1), file("tower1.tdt", DATA2)]);
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
    // A file and a directory with one name.
    let image = build(&[file("A", DATA1), dir("A", vec![file("X", DATA2)])]);
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
}

#[test]
fn refuses_one_version_twice_wherever_the_records_sit() {
    // "A;1", "B;1", "C;1" become "A;1", "A;3", "A;1": a higher version
    // between the two copies must not hide the duplicate.
    let mut image = build(&[file("A", b"one"), file("B", b"two"), file("C", b"three")]);
    let rec = dir_record(b"A;1", 0, 0, false).len();
    let first = ROOT_SECTOR * S + 34 + 34;
    image[first + rec + 33] = b'A';
    image[first + rec + 35] = b'3';
    image[first + 2 * rec + 33] = b'A';
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
}

#[test]
fn a_multi_extent_file_lists_once_as_unreadable() {
    // "A;1" flagged multi-extent, continued by a second "A;1" record.
    let mut image = build(&[file("A", b"one"), file("B", b"two"), file("C", b"three")]);
    let rec = dir_record(b"A;1", 0, 0, false).len();
    let first = ROOT_SECTOR * S + 34 + 34;
    image[first + 25] |= 0x80;
    image[first + rec + 33] = b'A';
    let mut disc = open(&image, Limits::default()).unwrap();
    let entries = disc.opened().entries;
    assert_eq!(
        entries
            .iter()
            .map(|e| (e.path.as_str(), e.stored))
            .collect::<Vec<_>>(),
        vec![("A", "unreadable"), ("C", "plain")]
    );
    assert_eq!(
        disc.read(entries[0].token).unwrap_err().code,
        Code::CorruptImage
    );
}

#[test]
fn a_damaged_root_record_refuses_the_walk() {
    let root = 16 * S + 156;
    for offset in [1, 26, 27] {
        let mut image = two_towers();
        image[root + offset] = 1;
        assert_eq!(
            code(open(&image, Limits::default())),
            Code::CorruptImage,
            "byte {offset}"
        );
    }
    let mut image = two_towers();
    image[root + 25] |= 0x80;
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
}

#[test]
fn skips_associated_files() {
    let mut image = two_towers();
    image[ROOT_SECTOR * S + 34 + 34 + 25] = 0x04;
    assert_eq!(paths(&image), vec!["SUB/TOWER5.TDT"]);
}

#[test]
fn names_drop_the_version_and_an_empty_extension() {
    let image = build(&[file("README.", b"r"), file("TOWER1.TDT", DATA1)]);
    assert_eq!(paths(&image), vec!["README", "TOWER1.TDT"]);
}

#[test]
fn refuses_limits_past_the_hard_ceiling() {
    let wide = Limits {
        max_file_bytes: u32::MAX,
        ..Limits::default()
    };
    assert_eq!(code(open(&two_towers(), wide)), Code::BadRequest);
}

#[test]
fn refuses_a_directory_record_below_the_34_byte_minimum() {
    let mut image = two_towers();
    image[ROOT_SECTOR * S] = 5;
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
}

#[test]
fn refuses_an_oversized_file_before_allocating_it() {
    let image = two_towers();
    let tight = Limits {
        max_file_bytes: 3,
        ..Limits::default()
    };
    let mut disc = open(&image, tight).unwrap();
    assert_eq!(disc.read(0).unwrap_err().code, Code::TooLarge);
}

#[test]
fn bounds_directory_traversal_by_the_record_budget() {
    let tight = Limits {
        max_records: 2,
        ..Limits::default()
    };
    assert_eq!(code(open(&two_towers(), tight)), Code::BudgetExceeded);
}

#[test]
fn refuses_an_image_larger_than_the_limit() {
    let tight = Limits {
        max_image_bytes: 20 * SECTOR,
        ..Limits::default()
    };
    assert_eq!(code(open(&two_towers(), tight)), Code::TooLarge);
}

#[test]
fn refuses_directories_nested_past_the_depth_limit() {
    // Six levels below the root: allowed at depth limit 6, refused at 5.
    let mut node = file("DEEP.TDT", DATA1);
    for i in 0..6 {
        node = dir(&format!("D{i}"), vec![node]);
    }
    let image = build(&[node]);
    assert_eq!(paths(&image), vec!["D5/D4/D3/D2/D1/D0/DEEP.TDT"]);
    let tight = Limits {
        max_dir_depth: 5,
        ..Limits::default()
    };
    assert_eq!(code(open(&image, tight)), Code::BudgetExceeded);
}

#[test]
fn walks_a_directory_that_points_back_at_an_ancestor_once() {
    let mut image = two_towers();
    // Re-point SUB's TOWER5.TDT record at the root directory, as a directory.
    let sub = ROOT_SECTOR + 1;
    let rec = dir_record(b"LOOP", ROOT_SECTOR as u32, S as u32, true);
    let at = sub * S + 34 + 34;
    image[at..at + 64].fill(0); // clear the old record; zeros end the sector
    image[at..at + rec.len()].copy_from_slice(&rec);
    assert_eq!(paths(&image), vec!["TOWER1.TDT"]);
}

#[test]
fn refuses_an_unreadable_file_name() {
    let mut image = two_towers();
    image[ROOT_SECTOR * S + 34 + 34 + 33] = 0x07; // the "T" of TOWER1.TDT
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
}

#[test]
fn refuses_a_name_that_runs_past_its_record() {
    let mut image = two_towers();
    image[ROOT_SECTOR * S + 34 + 34 + 32] = 200;
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
}

#[test]
fn refuses_a_record_that_straddles_its_sector() {
    // Fill the root's first sector with records up to its last 40 bytes,
    // then start one that claims 200: it would cross the sector boundary.
    let mut image = two_towers();
    let at = ROOT_SECTOR * S;
    image[at..at + S].fill(0);
    let first = dir_record(&[0], ROOT_SECTOR as u32, S as u32, true);
    image[at..at + first.len()].copy_from_slice(&first);
    let mut p = first.len();
    let filler = dir_record(b"F;1", 30, 1, false);
    while p + filler.len() < S - 40 {
        image[at + p..at + p + filler.len()].copy_from_slice(&filler);
        p += filler.len();
    }
    image[at + p] = 200;
    assert_eq!(code(open(&image, Limits::default())), Code::CorruptImage);
}

#[test]
fn a_directory_spanning_several_sectors_lists_every_file() {
    let files: Vec<_> = (0..120)
        .map(|i| file(&format!("TOWER{i:03}.TDT"), &[i as u8; 10]))
        .collect();
    let image = build(&files);
    let listed = paths(&image);
    assert_eq!(listed.len(), 120);
    assert_eq!(listed[119], "TOWER119.TDT");
}

#[test]
fn reads_through_a_seekable_file_handle() {
    let image = two_towers();
    let src = verticopolis_disc::source::Seekable::new(std::io::Cursor::new(image)).unwrap();
    let mut disc = Disc::open(src, Limits::default()).unwrap();
    assert_eq!(disc.read(1).unwrap().1, DATA2);
}

#[test]
fn lists_kwaj_files_and_expands_them_on_read() {
    let mut rng = Rng::new(42);
    let tower = sample_data(&mut rng, 3000);
    let lzh = kwaj_enc::kwaj_file(
        3,
        &kwaj_enc::lzh(&tower, LzhShape::random(&mut rng), &mut rng),
        Some(3000),
    );
    let image = build(&[file("SAMPLE.TD_", &lzh), file("README.TXT", b"plain")]);
    let mut disc = open(&image, Limits::default()).unwrap();
    let entries = disc.opened().entries;
    assert_eq!(entries[0].stored, "kwaj");
    assert_eq!(entries[0].method, Some(3));
    assert_eq!(entries[0].expanded_size, Some(3000));
    assert_eq!(entries[1].stored, "plain");
    assert_eq!(disc.read(0).unwrap().1, tower);
    assert_eq!(disc.read_stored(0).unwrap(), lzh);
}

#[test]
fn a_kwaj_signature_with_a_broken_header_lists_and_refuses_on_read() {
    let mut broken = kwaj_enc::kwaj_file(0, b"x", None);
    broken[10] = 3; // data offset inside the header
    let image = build(&[file("BAD.EX_", &broken)]);
    let mut disc = open(&image, Limits::default()).unwrap();
    let entry = &disc.opened().entries[0];
    assert_eq!((entry.stored, entry.method), ("kwaj", None));
    assert_eq!(disc.read(0).unwrap_err().code, Code::CorruptStream);
}

#[test]
fn an_unknown_token_is_a_bad_request() {
    let image = two_towers();
    let mut disc = open(&image, Limits::default()).unwrap();
    assert_eq!(disc.read(99).unwrap_err().code, Code::BadRequest);
}

#[test]
fn ms_zip_is_refused_as_unsupported() {
    let image = build(&[file("Z.EX_", &kwaj_enc::kwaj_file(4, b"\x00\x00CK", None))]);
    let mut disc = open(&image, Limits::default()).unwrap();
    assert_eq!(disc.read(0).unwrap_err().code, Code::UnsupportedCompression);
}

#[test]
fn the_expansion_ratio_caps_a_small_file_that_inflates() {
    let mut rng = Rng::new(9);
    let zeros = vec![0u8; 40_000];
    let bomb = kwaj_enc::kwaj_file(
        3,
        &kwaj_enc::lzh(&zeros, LzhShape::random(&mut rng), &mut rng),
        None,
    );
    let image = build(&[file("BOMB.EX_", &bomb)]);
    let ratio = Limits {
        max_expansion_ratio: 4,
        ..Limits::default()
    };
    let mut disc = open(&image, ratio).unwrap();
    assert_eq!(disc.read(0).unwrap_err().code, Code::OutputCap);
}
