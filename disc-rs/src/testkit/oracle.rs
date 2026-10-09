//! libmspack as a black-box oracle, shared by `tests/oracle.rs` and the
//! fuzzer. `VC_KWAJ_ORACLE` names a `kwajd` binary
//! (`tools/simtower/docker/kwajd.c` compiled with `cc kwajd.c -lmspack`).
//!
//! The comparison rule: where libmspack expands a file, we expand it to the
//! same bytes, with three listed exceptions.
//!
//! 1. Deliberate strictness (`kwaj::strict`): we refuse a stream cut before
//!    or inside its Huffman tables (libmspack returns empty output), code
//!    lengths that step outside 0 to 15, an over-subscribed table (no encoder
//!    writes one and libmspack does not always detect it), and an expansion
//!    that does not match the length the header declares (libmspack ignores
//!    the declaration). A cut stream is allowed only when libmspack's output
//!    is empty, and a declared-length refusal only when libmspack misses the
//!    declared length too and the bytes we would have produced without the
//!    check match libmspack's, so neither can hide a divergence.
//! 2. The output cap, but only when libmspack's own expansion is longer than
//!    the cap, so a runaway in our decoder can never hide behind it.
//! 3. libmspack's one known departure from the format description: it
//!    prefetches input ahead of its reads, and when that prefetch reaches
//!    past the end of the input it stops at the next token or literal
//!    boundary, dropping whatever the last few bytes would still have
//!    decoded, even in a well-formed stream. The exact point moves with byte
//!    alignment. We keep those bytes, as the description says to. The
//!    allowance applies only when libmspack's output is exactly ours up to a
//!    token or literal boundary with fewer than `kwaj::TAIL_BITS` (24) input
//!    bits left, so any divergence earlier in a stream still fails.
//!
//! Where libmspack refuses, we refuse. A `kwajd` that crashes or hangs is a
//! test failure, never read as a refusal.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant};

use crate::kwaj::{self, Boundary};
use crate::limits::Limits;
use crate::refusal::{Code, Refusal};

/// How long one `kwajd` run may take before it counts as hung.
const ORACLE_TIMEOUT: Duration = Duration::from_secs(20);
/// How long `kill_live` waits for the run lock.
const KILL_WAIT: Duration = Duration::from_secs(2);

/// The oracle binary, if configured. Panics when `VC_REQUIRE_KWAJ_ORACLE=1`
/// and none is, so CI cannot skip silently.
pub fn binary() -> Option<PathBuf> {
    match std::env::var_os("VC_KWAJ_ORACLE") {
        Some(p) => Some(PathBuf::from(p)),
        None if std::env::var("VC_REQUIRE_KWAJ_ORACLE").as_deref() == Ok("1") => {
            panic!("VC_REQUIRE_KWAJ_ORACLE=1 but VC_KWAJ_ORACLE is not set")
        }
        None => None,
    }
}

static RUN: AtomicU64 = AtomicU64::new(0);

/// Set by `kill_live`, without the lock: no run starts after it.
static CLOSED: AtomicBool = AtomicBool::new(false);

/// The `kwajd` runs in flight, by run number, held here so the fuzz
/// watchdog can signal them before the process exits (`kill_live`).
static LIVE: Mutex<BTreeMap<u64, Child>> = Mutex::new(BTreeMap::new());

thread_local! {
    /// Whether this thread holds `LIVE` to set up a run, so a `TempPair`
    /// dropped by a panic there does not wait on its own lock.
    static SETTING_UP: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Marks this thread as setting up a run until dropped, on a panic too.
struct SettingUp;

impl SettingUp {
    fn start() -> SettingUp {
        SETTING_UP.with(|s| s.set(true));
        SettingUp
    }
}

impl Drop for SettingUp {
    fn drop(&mut self) {
        SETTING_UP.with(|s| s.set(false));
    }
}

fn live() -> MutexGuard<'static, BTreeMap<u64, Child>> {
    LIVE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// `LIVE`, if no other thread holds it; a poisoned lock is taken anyway.
fn try_live() -> Option<MutexGuard<'static, BTreeMap<u64, Child>>> {
    match LIVE.try_lock() {
        Ok(runs) => Some(runs),
        Err(TryLockError::Poisoned(poisoned)) => Some(poisoned.into_inner()),
        Err(TryLockError::WouldBlock) => None,
    }
}

/// Best effort before the fuzz watchdog exits. It refuses every later run at
/// once, without the lock. Then, if the run lock frees within `KILL_WAIT`,
/// it sends every run in flight a kill signal. It never waits for a child to
/// exit, so a stuck child cannot hang the watchdog; a run it cannot reach in
/// time may outlive the process.
pub fn kill_live() {
    CLOSED.store(true, Ordering::SeqCst);
    let started = Instant::now();
    loop {
        if let Some(mut runs) = try_live() {
            for (_, mut child) in std::mem::take(&mut *runs) {
                let _ = child.kill();
                let _ = child.try_wait();
            }
            return;
        }
        if started.elapsed() > KILL_WAIT {
            return;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// libmspack's expansion of `file`, or `None` when it refuses (a nonzero
/// exit). Panics when `kwajd` is killed by a signal or runs past the timeout,
/// and once the fuzz watchdog has closed the oracle (`kill_live`).
pub fn expand(kwajd: &Path, file: &[u8], tag: &str) -> Option<Vec<u8>> {
    let run = RUN.fetch_add(1, Ordering::Relaxed);
    // The files and the child are made under the lock, after the closed
    // check, so `kill_live` either refuses this run or, if it gets the lock
    // within its wait, finds its child.
    let files = {
        let mut runs = live();
        // Declared after `runs` and before `files`: on a panic `files` drops
        // first (flag set, lock held), then the flag clears, then the lock.
        let _setting_up = SettingUp::start();
        if CLOSED.load(Ordering::SeqCst) {
            panic!("the oracle was closed by the fuzz watchdog before {tag}");
        }
        let files = TempPair::new(tag, run);
        std::fs::write(&files.input, file).expect("write oracle input");
        let child = Command::new(kwajd)
            .arg(&files.input)
            .arg(&files.output)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("kwajd starts");
        runs.insert(run, child);
        files
    };
    let started = Instant::now();
    let status = loop {
        let mut runs = live();
        let Some(child) = runs.get_mut(&run) else {
            panic!("kwajd was killed by the fuzz watchdog on {tag}");
        };
        if let Some(status) = child.try_wait().expect("kwajd waits") {
            runs.remove(&run);
            break status;
        }
        if started.elapsed() > ORACLE_TIMEOUT {
            // Signaled under the lock, so the watchdog never misses it;
            // reaped outside it, so a slow exit holds nobody up.
            let _ = child.kill();
            let hung = runs.remove(&run);
            drop(runs);
            if let Some(mut child) = hung {
                let _ = child.wait();
            }
            panic!("kwajd hung on {tag} for {ORACLE_TIMEOUT:?}");
        }
        drop(runs);
        std::thread::sleep(Duration::from_millis(2));
    };
    match status.code() {
        Some(0) => Some(std::fs::read(&files.output).expect("read oracle output")),
        Some(_) => None,
        None => panic!("kwajd was killed by a signal on {tag} ({status})"),
    }
}

/// One run's input and output files, removed when dropped (on a panic too).
struct TempPair {
    input: PathBuf,
    output: PathBuf,
}

impl TempPair {
    fn new(tag: &str, run: u64) -> TempPair {
        let dir = oracle_dir();
        std::fs::create_dir_all(&dir).expect("temp dir");
        TempPair {
            input: dir.join(format!("{tag}-{run}.kw_")),
            output: dir.join(format!("{tag}-{run}.out")),
        }
    }
}

impl Drop for TempPair {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.input);
        let _ = std::fs::remove_file(&self.output);
        // The directory goes once empty, under the lock a run is set up
        // under so no other run is between making it and writing into it.
        // A panic during setup drops this while the thread still holds the
        // lock; the directory is then left for the next run or `clean_up`.
        if !SETTING_UP.with(|s| s.get()) {
            let _runs = live();
            let _ = std::fs::remove_dir(oracle_dir());
        }
    }
}

fn oracle_dir() -> PathBuf {
    std::env::temp_dir().join(format!("vc-kwaj-oracle-{}", std::process::id()))
}

/// Remove this process's oracle directory, with any files a case cut short
/// by the watchdog left behind.
pub fn clean_up() {
    let _ = std::fs::remove_dir_all(oracle_dir());
}

/// Whether a refusal is one of the deliberate strictness codes (each has its
/// own condition in `compare`).
pub fn listed_strictness(e: &Refusal) -> bool {
    e.code == Code::CorruptStream
        && kwaj::strict::ALL
            .iter()
            .any(|why| e.detail.starts_with(why))
}

/// libmspack stopped early at a boundary in the last few bytes of input,
/// and agrees with us exactly up to it.
pub fn is_end_quirk(theirs: &[u8], ours: &[u8], tail: &[Boundary]) -> bool {
    theirs.len() < ours.len()
        && ours.starts_with(theirs)
        && tail.iter().any(|b| b.out == theirs.len())
}

/// Compare one file under the rule; `Err` describes a disagreement.
pub fn compare(kwajd: &Path, file: &[u8], tag: &str, limits: &Limits) -> Result<(), String> {
    let theirs = expand(kwajd, file, tag);
    let (ours, tail) = kwaj::expand_with_tail(file, limits);
    let cap = kwaj::output_cap(file, limits);
    let agrees = |t: &[u8], o: &[u8], tail: &[Boundary]| t == o || is_end_quirk(t, o, tail);
    let (t, e) = match (&theirs, &ours) {
        (Some(t), Ok(o)) if agrees(t, o, &tail) => return Ok(()),
        (None, Err(_)) => return Ok(()),
        (Some(t), Ok(o)) => {
            return Err(format!(
                "both expand, {} vs {} bytes, differing",
                t.len(),
                o.len()
            ))
        }
        (None, Ok(o)) => return Err(format!("libmspack refuses, we expand {} bytes", o.len())),
        (Some(t), Err(e)) => (t, e),
    };
    let starts = |why: &str| e.code == Code::CorruptStream && e.detail.starts_with(why);
    if starts(kwaj::strict::DECLARED_LENGTH) {
        // Our refusal rests on the header alone: libmspack must miss the
        // declared length too, and the bytes behind the refusal must still
        // be libmspack's bytes.
        let declared = kwaj::parse_header(file).ok().and_then(|h| h.expanded_len);
        if declared == Some(t.len() as u32) {
            return Err(format!(
                "libmspack expands to the declared {} bytes, we refuse: {e}",
                t.len()
            ));
        }
        return match kwaj::expand_ignoring_declared(file, limits) {
            (Ok(raw), raw_tail) if agrees(t, &raw, &raw_tail) => Ok(()),
            (Ok(raw), _) => Err(format!(
                "behind a declared-length refusal, {} vs {} bytes, differing",
                t.len(),
                raw.len()
            )),
            (Err(e2), _) if e2.code == Code::OutputCap && t.len() > cap => Ok(()),
            (Err(e2), _) => Err(format!(
                "behind a declared-length refusal we also refuse: {e2}"
            )),
        };
    }
    if starts(kwaj::strict::HEADER_CUT) || starts(kwaj::strict::TABLES_CUT) {
        // libmspack returns empty output for a stream cut in its tables.
        return if t.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "libmspack expands {} bytes from a stream we call cut: {e}",
                t.len()
            ))
        };
    }
    if starts(kwaj::strict::LENGTH_RANGE) || starts(kwaj::strict::OVER_SUBSCRIBED) {
        return Ok(());
    }
    if e.code == Code::OutputCap && t.len() > cap {
        return Ok(());
    }
    Err(format!(
        "libmspack expands {} bytes, we refuse: {e}",
        t.len()
    ))
}
