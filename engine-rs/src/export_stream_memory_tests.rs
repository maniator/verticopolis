//! The memory of a large tower's exports: the `.vctower` and the `.TDT` build
//! without the whole save as a tree (#1338, #1431). Allocations are counted
//! per thread by the harness in `load_memory_tests.rs`.
use super::*;
use crate::load_stream::load_save_text;
use crate::load_stream::memory::{large_save, measure};
use crate::tdt::export::{build_tdt, build_tdt_streamed};

const NOW: f64 = 1_750_000_000_123.0;

fn mib(n: isize) -> f64 {
    n as f64 / f64::from(1 << 20)
}

#[test]
fn a_large_vctower_export_peaks_near_its_text() {
    let sim = load_save_text(large_save().as_bytes()).unwrap();
    // A first small export sets up whatever the writer builds once.
    drop(crate::load::encode_simulation_vctower(
        &crate::sim::Simulation::new_game(1, crate::clock::GameMode::Classic),
        "3.0.0",
        NOW,
    ));
    let len = sim.save_text().len() as isize;
    let (tree_bytes, tree_peak, _) = measure(|| {
        let mut save = sim.serialize();
        stamp_save(&mut save, "3.0.0", NOW).unwrap();
        encode_vctower(&save).unwrap()
    });
    let (bytes, peak, _) =
        measure(|| crate::load::encode_simulation_vctower(&sim, "3.0.0", NOW).unwrap());
    assert!(bytes == tree_bytes, "the streamed export wrote other bytes");
    println!(
        "{:.2} MiB of text; the export peaked at {:.2} MiB, the tree path at {:.2} MiB",
        mib(len),
        mib(peak),
        mib(tree_peak)
    );
    assert!(
        peak <= 7 * len / 2,
        "the export peaked at {peak} bytes for {len} of text"
    );
    assert!(
        tree_peak >= 12 * len,
        "the tree path peaked at only {tree_peak} bytes for {len} of text"
    );
}

#[test]
fn a_large_tdt_export_peaks_below_the_tree_path() {
    let text = large_save().replace("\"mode\":\"modern\"", "\"mode\":\"classic\"");
    let sim = load_save_text(text.as_bytes()).unwrap();
    drop(build_tdt_streamed(
        &sim.save_without_units().0,
        std::iter::empty::<Value>(),
    ));
    let len = sim.save_text().len() as isize;
    let (tree_built, tree_peak, _) = measure(|| build_tdt(&sim.serialize()));
    let (built, peak, _) = measure(|| {
        let (rest, units) = sim.save_without_units();
        build_tdt_streamed(&rest, units)
    });
    let (tree_built, built) = (tree_built.unwrap(), built.unwrap());
    assert!(
        built.bytes == tree_built.bytes,
        "the streamed export wrote other bytes"
    );
    println!(
        "{:.2} MiB of text; the export peaked at {:.2} MiB, the tree path at {:.2} MiB",
        mib(len),
        mib(peak),
        mib(tree_peak)
    );
    assert!(
        peak <= 2 * len,
        "the export peaked at {peak} bytes for {len} of text"
    );
    assert!(
        tree_peak >= 6 * len,
        "the tree path peaked at only {tree_peak} bytes for {len} of text"
    );
}
