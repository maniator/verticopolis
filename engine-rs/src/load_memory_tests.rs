//! The streamed reader's memory (#1225): a large tower loads in little more
//! than the memory the loaded game keeps. Allocations are counted per thread,
//! so the tests running beside this one do not move its figures.
use super::*;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

struct Counting;

thread_local! {
    static LIVE: Cell<isize> = const { Cell::new(0) };
    static PEAK: Cell<isize> = const { Cell::new(0) };
}

fn note(delta: isize) {
    let _ = LIVE.try_with(|live| {
        let now = live.get() + delta;
        live.set(now);
        let _ = PEAK.try_with(|peak| peak.set(peak.get().max(now)));
    });
}

// Every `realloc` counts as holding the old and the new block at once until
// the old one goes. A moving one does, as a WASM memory does when a vector
// regrows; one that grows or shrinks in place is counted the same way, which
// can only raise the peak this test bounds.
//
// SAFETY: each method passes its arguments straight to `System`, so the
// caller's guarantees for `GlobalAlloc` are the ones `System` needs, and the
// counting touches only thread-local cells.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let p = System.alloc(layout);
        if !p.is_null() {
            note(layout.size() as isize);
        }
        p
    }

    unsafe fn dealloc(&self, p: *mut u8, layout: Layout) {
        System.dealloc(p, layout);
        note(-(layout.size() as isize));
    }

    unsafe fn realloc(&self, p: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let q = System.realloc(p, layout, size);
        if !q.is_null() {
            note(size as isize);
            note(-(layout.size() as isize));
        }
        q
    }
}

#[global_allocator]
static COUNTING: Counting = Counting;

/// The peak above the starting point while `f` runs, and what is still held
/// when it returns, in bytes.
fn measure<T>(f: impl FnOnce() -> T) -> (T, isize, isize) {
    let base = LIVE.with(Cell::get);
    PEAK.with(|p| p.set(base));
    let out = f();
    (
        out,
        PEAK.with(Cell::get) - base,
        LIVE.with(Cell::get) - base,
    )
}

/// A lobby on floor 1 and floors 2 to 100 of tiles above it, with a row of
/// occupied offices on each of those floors: 41,460 units, close to the large
/// perf tower's 43,358.
fn large_save() -> String {
    let mut units = Vec::new();
    let mut id = 0;
    let mut unit = |body: String| {
        id += 1;
        units.push(format!("{{\"id\":{id},{body}}}"));
    };
    for x in 0..375 {
        unit(format!("\"kind\":\"lobby\",\"floor\":1,\"x\":{x}"));
    }
    for floor in 2..=100 {
        for x in 0..375 {
            unit(format!("\"kind\":\"floor\",\"floor\":{floor},\"x\":{x}"));
        }
        for x in (3..360).step_by(9) {
            unit(format!(
                "\"kind\":\"office\",\"floor\":{floor},\"x\":{x},\"state\":\"occupied\",\"everOccupied\":true,\"occupants\":6,\"satisfaction\":0.8,\"rent\":10000"
            ));
        }
    }
    format!(
        "{{\"version\":7,\"seed\":1,\"initialSeed\":1,\"money\":1000000000,\"star\":5,\"minutes\":420,\"mode\":\"classic\",\"modernCalendar\":\"realWorld\",\"lastQuarterMoney\":0,\"units\":[{}],\"transports\":[{{\"id\":{},\"kind\":\"elevatorStandard\",\"x\":0,\"width\":4,\"bottom\":1,\"top\":30,\"cars\":2,\"carPositions\":[1,1],\"carDir\":[0,0],\"load\":0}}],\"nextId\":{}}}",
        units.join(","),
        id + 1,
        id + 2
    )
}

/// The streamed load's peak stays within a quarter above the game it builds,
/// where a load through a whole-save tree peaked at several times it.
#[test]
fn a_large_load_peaks_near_what_it_keeps() {
    let text = large_save();
    // A first small load sets up whatever the reader builds once, so that
    // it is not counted as part of what the large game keeps.
    drop(load_save_text(
        br#"{"version":7,"mode":"classic","units":[]}"#,
    ));
    // `fromSave`'s own entry, so a fallback to today's path would show here.
    let (sim, peak, kept) = measure(|| load_save_text(text.as_bytes()).unwrap());
    assert!(
        read_save(text.as_bytes()).unwrap().1,
        "the save took today's path"
    );
    assert!(
        sim.tower.units.len() > 41_000,
        "{} units",
        sim.tower.units.len()
    );
    assert_eq!(sim.tower.units.capacity(), sim.tower.units.len());
    // The count saw the game (its units alone pass 10 MiB), so the bound
    // below measures something.
    assert!(kept > 10 << 20, "only {kept} bytes counted");
    assert!(
        peak * 4 <= kept * 5,
        "the streamed load peaked at {peak} bytes for {kept} kept"
    );
}

/// The length in bytes of each entry the top-level `units` array lists in a
/// save the game writes, which spells the key `"units":[` with no space.
fn entry_lengths(text: &[u8]) -> Vec<usize> {
    let key = b"\"units\":[";
    let open = text.windows(key.len()).position(|w| w == key).unwrap() + key.len() - 1;
    let (mut lengths, mut depth, mut start) = (Vec::new(), 0usize, 0);
    let mut i = open + 1;
    while i < text.len() {
        match text[i] {
            b'"' => {
                i = string_end(text, i);
                continue;
            }
            b'{' | b'[' => {
                if depth == 0 {
                    start = i;
                }
                depth += 1;
            }
            b']' if depth == 0 => break,
            b'}' | b']' => {
                depth -= 1;
                if depth == 0 {
                    lengths.push(i + 1 - start);
                }
            }
            _ => {}
        }
        i += 1;
    }
    lengths
}

/// On saves the game writes, the engine's own and the committed towers, the
/// object count is the number of entries in `units` and the length bound
/// leaves it whole, so the unit vectors are reserved once and never regrow.
/// Each entry in the text is at least the 40 bytes, comma included, that the
/// shortest entry the game writes takes, above the 24 `MIN_UNIT_BYTES` allows.
#[test]
fn the_count_is_a_written_saves_units() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures");
    let mut texts = vec![
        super::tests::built(GameMode::Classic).to_string(),
        super::tests::built(GameMode::Modern).to_string(),
    ];
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|x| x == "vctower") {
            let file = std::fs::read_to_string(&path).unwrap();
            texts.push(String::from_utf8(inflate_vctower(&file).unwrap()).unwrap());
        }
    }
    assert!(texts.len() > 2, "no fixture towers");
    for text in &texts {
        let save: Value = serde_json::from_str(text).unwrap();
        let units = save["units"].as_array().unwrap();
        assert_eq!(units_hint(text.as_bytes()), units.len());
        let lengths = entry_lengths(text.as_bytes());
        assert_eq!(lengths.len(), units.len());
        let shortest = lengths.iter().min();
        assert!(shortest.is_some_and(|n| n + 1 >= 40), "{shortest:?}");
    }
}

/// The text of a committed player tower written by an older version.
fn old_tower(name: &str) -> Vec<u8> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures");
    let file = std::fs::read_to_string(format!("{dir}/{name}")).unwrap();
    inflate_vctower(&file).unwrap()
}

/// A save from an older version takes today's path, which migrates it step
/// by step. It held the whole save once per step, so the medium perf tower
/// (version 4) peaked at eleven times what it keeps, and a WASM memory keeps
/// its peak for the session. Migrated in place, it peaks at about four
/// times; the bound leaves room for the parsed save it must still hold.
#[test]
fn an_old_save_peaks_near_what_it_keeps() {
    drop(load_save_text(
        br#"{"version":7,"mode":"classic","units":[]}"#,
    ));
    let text = old_tower("sixseven_2.vctower");
    let (sim, peak, kept) = measure(|| load_save_text(&text).unwrap());
    assert!(
        !read_save(&text).unwrap().1,
        "a version 4 save took the streamed path"
    );
    assert!(sim.tower.units.len() > 12_000);
    assert!(kept > 5 << 20, "only {kept} bytes counted");
    assert!(
        peak * 5 <= kept * 24,
        "the load peaked at {peak} bytes for {kept} kept"
    );
}

/// A version 1 save is also re-laid at canon widths, which builds its own
/// copies of the units; that step is not yet streamed, so the bound only
/// keeps it from growing back to the 24 times it peaked at before.
#[test]
fn a_version_one_save_peaks_below_what_it_did() {
    drop(load_save_text(
        br#"{"version":7,"mode":"classic","units":[]}"#,
    ));
    let text = old_tower("towerone_6.vctower");
    let (_, peak, kept) = measure(|| load_save_text(&text).unwrap());
    assert!(
        peak <= kept * 16,
        "the load peaked at {peak} bytes for {kept} kept"
    );
}
