//! The memory of a large tower's load and save: it loads in little more than
//! the memory the loaded game keeps (#1225), and saves in the buffer its text
//! grows in, with no tree beside it (#1242). Allocations are counted per
//! thread, so the tests running beside these do not move their figures.
use super::*;
use crate::facilities::{Kind, Pool, LOT_WIDTH, MIN_FLOOR, POOLED_CAPS};
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
pub(crate) fn measure<T>(f: impl FnOnce() -> T) -> (T, isize, isize) {
    let base = LIVE.with(Cell::get);
    PEAK.with(|p| p.set(base));
    let out = f();
    (
        out,
        PEAK.with(Cell::get) - base,
        LIVE.with(Cell::get) - base,
    )
}

/// The synthetic tower's top floor, and where its offices stand along each
/// floor from 2 up.
const TOP_FLOOR: i64 = 100;
const OFFICE_XS: std::ops::Range<i64> = 3..360;
const OFFICE_STEP: usize = 9;
/// How many blockbuster cinemas and milestones it carries, and the length of
/// its name and of its pending choice's message: the loader keeps any number
/// of each, and any length.
const MANY: usize = 2_000;
const LONG: usize = 80_000;

/// The pool a transport kind counts against.
fn pool_of(kind: Kind) -> &'static Pool {
    POOLED_CAPS
        .iter()
        .find(|p| p.kinds.contains(&kind))
        .unwrap()
}

/// A modern game with a lobby on floor 1 and floors 2 to `TOP_FLOOR` of tiles
/// above it, with a row of occupied offices on each of those floors: 41,460
/// units, close to the large perf tower's 43,358. Three lists are at their
/// caps: the whole elevator and stair pools, a full log and a full ledger.
/// The other lists and strings are large: all ten basement floors excavated
/// (the loader keeps any distinct tile), an exterminator booked for every
/// office (room ids are capped at `UNIT_CAP`, far above that), `MANY`
/// blockbuster cinemas and milestones, and a tower name and a pending
/// choice's message `LONG` bytes each.
pub(crate) fn large_save() -> String {
    let mut units = Vec::new();
    let mut offices = Vec::new();
    let mut id = 0;
    let mut unit = |body: String| {
        id += 1;
        units.push(format!("{{\"id\":{id},{body}}}"));
        id
    };
    for x in 0..LOT_WIDTH {
        unit(format!("\"kind\":\"lobby\",\"floor\":1,\"x\":{x}"));
    }
    for floor in 2..=TOP_FLOOR {
        for x in 0..LOT_WIDTH {
            unit(format!("\"kind\":\"floor\",\"floor\":{floor},\"x\":{x}"));
        }
        for x in OFFICE_XS.step_by(OFFICE_STEP) {
            offices.push(unit(format!(
                "\"kind\":\"office\",\"floor\":{floor},\"x\":{x},\"state\":\"occupied\",\"everOccupied\":true,\"occupants\":6,\"satisfaction\":0.8,\"rent\":10000"
            )));
        }
    }
    let mut transports = Vec::new();
    let shaft = Kind::ElevatorStandard.facility().width;
    for k in 0..pool_of(Kind::ElevatorStandard).cap {
        id += 1;
        transports.push(format!(
            "{{\"id\":{id},\"kind\":\"elevatorStandard\",\"x\":{},\"width\":{shaft},\"bottom\":1,\"top\":30,\"cars\":8,\"carPositions\":[1,1,1,1,1,1,1,1],\"carDir\":[0,0,0,0,0,0,0,0],\"load\":0}}",
            15 * k
        ));
    }
    let stairs = Kind::Stairs.facility().width;
    for floor in 1..=pool_of(Kind::Stairs).cap {
        id += 1;
        transports.push(format!(
            "{{\"id\":{id},\"kind\":\"stairs\",\"x\":{},\"width\":{stairs},\"bottom\":{floor},\"top\":{}}}",
            LOT_WIDTH - stairs,
            floor + 1
        ));
    }
    let log = (0..crate::sim::LOG_SAVE_CAP)
        .map(|i| format!("{{\"minute\":{i},\"text\":\"Line {i}: a tenant moved into an office on the fortieth floor.\",\"kind\":\"info\"}}"))
        .collect::<Vec<_>>()
        .join(",");
    let day = crate::ledger::LEDGER_CATS
        .iter()
        .enumerate()
        .map(|(i, cat)| format!("\"{cat}\":{}.25", 12_345 * (i + 1)))
        .collect::<Vec<_>>()
        .join(",");
    let history = vec![format!("{{{day}}}"); crate::ledger::WINDOW].join(",");
    let excavated = (MIN_FLOOR..=0)
        .flat_map(|floor| (0..LOT_WIDTH).map(move |x| format!("\"{floor}:{x}\"")))
        .collect::<Vec<_>>()
        .join(",");
    let rooms = offices
        .iter()
        .map(i64::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let blockbusters = (0..MANY)
        .map(|i| format!("{i}.5"))
        .collect::<Vec<_>>()
        .join(",");
    let milestones = (0..MANY)
        .map(|i| format!("\"goal {i}: a milestone this game does not know\""))
        .collect::<Vec<_>>()
        .join(",");
    let phrase = "The Tall Tower. ";
    let name = phrase.repeat(LONG / phrase.len());
    let phrase = "Pay for the rescue. ";
    let message = phrase.repeat(LONG / phrase.len());
    format!(
        "{{\"version\":7,\"seed\":1,\"initialSeed\":1,\"money\":1000000000,\"star\":5,\"minutes\":420,\"mode\":\"modern\",\"modernCalendar\":\"realWorld\",\"lastQuarterMoney\":0,\"units\":[{}],\"transports\":[{}],\"nextId\":{},\"towerName\":\"{name}\",\"events\":{{\"lastSantaYear\":-1,\"rngState\":1,\"pending\":{{\"kind\":\"fireRescue\",\"cost\":500000,\"message\":\"{message}\"}}}},\"exterminationDueDay\":0,\"exterminationRoomIds\":[{rooms}],\"excavated\":[{excavated}],\"blockbusters\":[{blockbusters}],\"milestones\":[{milestones}],\"ledger\":{{\"today\":{{{day}}},\"history\":[{history}]}},\"log\":[{log}]}}",
        units.join(","),
        transports.join(","),
        id + 1
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
    // Room for the first placements and no more (#1259).
    assert_eq!(
        sim.tower.units.capacity(),
        sim.tower.units.len() + crate::tower::unit_list_headroom(sim.tower.units.len())
    );
    // The count saw the game (its units alone pass 10 MiB), so the bound
    // below measures something.
    assert!(kept > 10 << 20, "only {kept} bytes counted");
    assert!(
        peak * 4 <= kept * 5,
        "the streamed load peaked at {peak} bytes for {kept} kept"
    );
}

/// The large tower's save is written without the whole-save tree (#1242).
/// Its text's buffer doubles as it grows, so the save peaks at that buffer
/// plus the half it last grew from, under three times the text, where
/// writing it through the tree peaks at several times the text. Written
/// into a buffer reserved to the text's length, it builds no more than
/// `SLACK` beside that buffer. The test prints its figures, which
/// `-- --nocapture` shows.
#[test]
fn a_large_save_peaks_near_its_text() {
    let sim = load_save_text(large_save().as_bytes()).unwrap();
    // Every list the save writes came through the load whole.
    let days = &sim.ledger.history;
    let cats = crate::ledger::LEDGER_CATS.len();
    assert_eq!(days.len(), crate::ledger::WINDOW);
    assert!(days
        .iter()
        .chain([&sim.ledger.today])
        .all(|d| d.len() == cats));
    let basement_floors = (MIN_FLOOR..=0).count();
    assert_eq!(sim.excavated.len(), basement_floors * LOT_WIDTH as usize);
    assert_eq!(sim.log.len(), crate::sim::LOG_SAVE_CAP);
    let pools = pool_of(Kind::ElevatorStandard).cap + pool_of(Kind::Stairs).cap;
    assert_eq!(sim.tower.transports.len(), pools as usize);
    let offices = OFFICE_XS.step_by(OFFICE_STEP).count() * (2..=TOP_FLOOR).count();
    let rooms = sim.extermination_room_ids.as_ref().map_or(0, Vec::len);
    assert_eq!(rooms, offices);
    assert_eq!(sim.blockbusters.len(), MANY);
    let goals = sim.milestones.iter().filter(|m| m.starts_with("goal "));
    assert_eq!(goals.count(), MANY);
    let name = sim.tower.tower_name.as_ref().map_or(0, String::len);
    let message = sim.events.pending.as_ref().map_or(0, |p| p.message.len());
    assert_eq!((name, message), (LONG, LONG));
    let (text, peak, kept) = measure(|| sim.save_text());
    // With its buffer reserved, the same write builds no more than `SLACK`
    // beside the buffer at any point, so a value built whole while it is
    // written shows here even after the buffer's last doubling.
    let mut buf = Vec::with_capacity(text.len());
    let ((), built, _) = measure(|| sim.write_save(&mut buf));
    assert!(
        buf == text.as_bytes(),
        "the reserved write wrote other text"
    );
    let (tree_text, tree_peak, _) = measure(|| sim.serialize().to_string());
    assert!(text == tree_text, "the tree wrote other text");
    let mib = |n: isize| n as f64 / f64::from(1 << 20);
    println!(
        "{:.2} MiB of text in a {:.2} MiB buffer; the save peaked at {:.2} MiB, {} KiB above the \
         buffer and the half it grew from; into a reserved buffer it built {} KiB; the tree \
         peaked at {:.2} MiB",
        mib(text.len() as isize),
        mib(kept),
        mib(peak),
        (peak - kept - kept / 2) >> 10,
        built >> 10,
        mib(tree_peak)
    );
    within_its_buffer(text.len(), peak, kept);
    assert!(
        built <= SLACK,
        "the write built {built} bytes beside its buffer"
    );
    assert!(
        tree_peak >= 4 * text.len() as isize,
        "the tree peaked at only {tree_peak} bytes for {} of text",
        text.len()
    );
}

/// `Engine.serialize` writes the same text the same way.
#[cfg(feature = "wasm")]
#[test]
fn the_binding_saves_without_the_tree() {
    let text = large_save();
    let want = load_save_text(text.as_bytes()).unwrap().save_text();
    let e = crate::wasm::Engine::from_save(&text, None).expect("the save loads");
    let (got, peak, kept) = measure(|| e.serialize());
    assert!(got == want, "the binding wrote other text");
    within_its_buffer(got.len(), peak, kept);
}

/// What the save builds beside its text: the top-level values it owns, and
/// one list element at a time. It measures 4 to 5 KiB on `large_save`,
/// where any one of its lists, its name or its pending choice held or built
/// whole takes 80 KiB or more.
const SLACK: isize = 16 << 10;

/// A save's text sits in a buffer under twice its length, and the save
/// peaks at that buffer plus the half it last grew from (the buffer doubles
/// as it grows), with `SLACK` for the values it builds along the way. The
/// text sits far enough above the buffer's last doubling that a second copy
/// of it, or a tree, does not fit.
fn within_its_buffer(len: usize, peak: isize, kept: isize) {
    let len = len as isize;
    assert!(
        kept >= len && kept < 2 * len,
        "{kept} bytes kept for {len} of text"
    );
    assert!(
        len > kept / 2 + SLACK,
        "{len} bytes of text sit too close to the {kept}-byte buffer's last doubling"
    );
    assert!(
        peak <= kept + kept / 2 + SLACK,
        "the save peaked at {peak} bytes for a {kept}-byte buffer"
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

/// The first placements after a load move nothing: the list kept room for
/// them, where one floor tile moved the 14 MiB list to a block twice its
/// size and took the engine's WASM memory from 24.6 to 52.4 MiB (#1259).
/// Once the room is used, the list grows by a quarter, not a doubling.
#[test]
fn placing_after_a_large_load_copies_nothing() {
    let text = large_save();
    let mut sim = load_save_text(text.as_bytes()).unwrap();
    let len = sim.tower.units.len();
    let spare = crate::tower::unit_list_headroom(len);
    let next_id = 1_000_000;
    let (_, peak, _) = measure(|| {
        for i in 0..spare {
            let mut unit = sim.tower.units[0].clone();
            unit.id = next_id + i as i64;
            sim.tower.add_unit(unit, None);
        }
    });
    assert!(
        peak < 1 << 20,
        "{spare} placements held {peak} bytes more at once"
    );
    assert_eq!(sim.tower.units.len(), len + spare);
    assert_eq!(sim.tower.units.capacity(), len + spare);
    // One more fills the list: it grows by a quarter.
    let mut unit = sim.tower.units[0].clone();
    unit.id = next_id + spare as i64;
    sim.tower.add_unit(unit, None);
    let full = len + spare;
    assert_eq!(sim.tower.units.capacity(), full + full / 4);
}
