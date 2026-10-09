//! Seeded hostile-input fuzzer for the disc reader. A few hundred seeds run
//! as a step of `disc-rs.yml` on every change; `disc-fuzz.yml` runs tens of
//! thousands nightly. Each seed builds a random image or KWAJ file with the
//! test kit, damages it, and checks that the reader either succeeds or
//! refuses with a typed code: no panic, and no case running past the time
//! budget (a watchdog names the seed and exits). With `VC_KWAJ_ORACLE` set it
//! also holds every damaged KWAJ file to the libmspack comparison rule
//! (`testkit::oracle`). Each case's seed goes to stderr before it runs, so
//! even an abort that no handler sees leaves the seed in the log.
//!
//!   cargo run --release --features testkit --bin disc-fuzz -- [--seeds N] [--offset O] [--seed S]
//!
//! A failure prints its seed; `--seed S` replays exactly that case.
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::Duration;

use verticopolis_disc::source::Bytes;
use verticopolis_disc::testkit::iso_build::{build, dir, file, Node};
use verticopolis_disc::testkit::{kwaj_vector, mutate, oracle, Rng};
use verticopolis_disc::{Disc, Limits};

/// The longest one case may run. Generous next to a typical case (a few
/// milliseconds) and to the oracle's own 20-second `kwajd` timeout.
const CASE_BUDGET: Duration = Duration::from_secs(30);

fn random_tree(rng: &mut Rng, depth: u32) -> Vec<Node> {
    let n = 1 + rng.below(6);
    (0..n)
        .map(|i| {
            if depth < 4 && rng.chance(4) {
                dir(&format!("D{depth}{i}"), random_tree(rng, depth + 1))
            } else if rng.chance(2) {
                let (_, kwaj) = kwaj_vector(rng.next_u64());
                file(&format!("F{depth}{i}.TD_"), &kwaj)
            } else {
                let len = rng.below(5000) as usize;
                file(&format!("F{depth}{i}.TDT"), &rng.bytes(len))
            }
        })
        .collect()
}

/// Damage an image where it hurts: descriptors, directories, early data.
fn damage(rng: &mut Rng, image: &mut Vec<u8>) {
    for _ in 0..1 + rng.below(8) {
        let end = image.len();
        let region = match rng.below(3) {
            0 => (16 * 2048).min(end)..(18 * 2048).min(end),
            1 => (18 * 2048).min(end)..(24 * 2048).min(end),
            _ => 0..end,
        };
        if region.is_empty() {
            continue;
        }
        let at = region.start + rng.below((region.end - region.start) as u64) as usize;
        match rng.below(4) {
            0 => image[at] ^= 1 << rng.below(8),
            1 => image[at] = rng.next_u64() as u8,
            2 => image[at] = 0xff,
            _ => {
                let cut = at.max(1);
                image.truncate(cut);
            }
        }
    }
}

/// Independent streams per role from one seed, so the image, the vector and
/// its damage never draw the same numbers.
fn sub_seed(seed: u64, role: u64) -> u64 {
    Rng::new(seed ^ role.wrapping_mul(0x9e37_79b9_7f4a_7c15)).next_u64()
}

fn iso_case(seed: u64) -> Result<(), String> {
    let mut rng = Rng::new(sub_seed(seed, 1));
    let mut image = build(&random_tree(&mut rng, 0));
    damage(&mut rng, &mut image);
    let limits = Limits {
        max_records: 2_000,
        max_file_bytes: 1 << 20,
        ..Limits::default()
    };
    let mut disc = match Disc::open(Bytes(&image), limits) {
        Ok(d) => d,
        Err(_) => return Ok(()),
    };
    for e in disc.opened().entries {
        let _ = disc.read(e.token);
        let _ = disc.read_stored(e.token);
    }
    Ok(())
}

fn kwaj_case(seed: u64, kwajd: Option<&std::path::Path>) -> Result<(), String> {
    let mut rng = Rng::new(sub_seed(seed, 2));
    let (_, file) = kwaj_vector(sub_seed(seed, 3));
    let bad = mutate(&mut rng, &file);
    let limits = Limits {
        max_expansion_ratio: verticopolis_disc::limits::HARD_LIMITS.max_expansion_ratio,
        ..Limits::default()
    };
    match kwajd {
        Some(k) => oracle::compare(k, &bad, &format!("f{seed}"), &limits),
        None => {
            let _ = verticopolis_disc::kwaj::expand(&bad, &limits);
            Ok(())
        }
    }
}

/// Run one seed on a worker thread under a watchdog. A case that outlives
/// the budget is reported by seed and ends the run at once, so a hang is
/// replayable instead of only killing the job.
fn run(seed: u64, kwajd: Option<std::path::PathBuf>) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let outcome = catch_unwind(AssertUnwindSafe(|| {
            iso_case(seed)?;
            kwaj_case(seed, kwajd.as_deref())
        }))
        .unwrap_or_else(|_| Err(format!("panicked: {}", LAST_PANIC.with(|p| p.take()))));
        let _ = tx.send(outcome);
    });
    match rx.recv_timeout(CASE_BUDGET) {
        Ok(outcome) => outcome,
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err("the case's thread died without reporting".into())
        }
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            println!(
                "seed {seed}: still running after {CASE_BUDGET:?}; replay it with --seed {seed}"
            );
            // The exit ends the worker thread before its own oracle timeout
            // can fire, so kill its `kwajd` here and remove its files.
            oracle::kill_live();
            oracle::clean_up();
            std::process::exit(1);
        }
    }
}

thread_local! {
    /// The message and location of the last panic on this thread, filled by
    /// the panic hook so a failure report names the line.
    static LAST_PANIC: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
}

fn usage(why: &str) -> ! {
    eprintln!("{why}; expected --seed S, or --seeds N and an optional --offset O");
    std::process::exit(2);
}

/// `--seed`, `--seeds` and `--offset`, each at most once, each with a whole
/// number; `--seed` stands alone. Anything else is a usage error, so a typo
/// never runs the defaults and passes.
fn parse_args(args: &[String]) -> (Option<u64>, Option<u64>, Option<u64>) {
    let (mut seed, mut seeds, mut offset) = (None, None, None);
    let mut it = args.iter().skip(1);
    while let Some(flag) = it.next() {
        let slot = match flag.as_str() {
            "--seed" => &mut seed,
            "--seeds" => &mut seeds,
            "--offset" => &mut offset,
            other => usage(&format!("unknown argument {other}")),
        };
        if slot.is_some() {
            usage(&format!("{flag} given twice"));
        }
        let Some(Ok(v)) = it.next().map(|v| v.parse::<u64>()) else {
            usage(&format!("{flag} takes a whole number"));
        };
        *slot = Some(v);
    }
    if seed.is_some() && (seeds.is_some() || offset.is_some()) {
        usage("--seed replays one case and takes no --seeds or --offset");
    }
    (seed, seeds, offset)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let kwajd = oracle::binary();
    let (one, count, offset) = parse_args(&args);
    std::panic::set_hook(Box::new(|info| {
        let message = info
            .payload()
            .downcast_ref::<String>()
            .cloned()
            .or_else(|| info.payload().downcast_ref::<&str>().map(|s| s.to_string()))
            .unwrap_or_else(|| "(no message)".into());
        let at = info
            .location()
            .map(|l| format!(" at {}:{}", l.file(), l.line()))
            .unwrap_or_default();
        LAST_PANIC.with(|p| *p.borrow_mut() = format!("{message}{at}"));
    }));
    let seeds = match one {
        Some(s) => s..=s,
        None => {
            let n = count.unwrap_or(200);
            let offset = offset.unwrap_or(0);
            let Some(end) = offset.checked_add(n).filter(|_| n > 0) else {
                usage("--seeds must be at least 1 and --offset + --seeds must fit in 64 bits");
            };
            offset..=end - 1
        }
    };
    let total = seeds.end() - seeds.start() + 1;
    let mut failed = 0;
    for seed in seeds {
        eprintln!("seed {seed}");
        if let Err(why) = run(seed, kwajd.clone()) {
            println!("seed {seed}: {why}");
            failed += 1;
        }
    }
    oracle::clean_up();
    println!(
        "disc-fuzz: {total} seeds, {failed} failed{}",
        if kwajd.is_some() {
            ", libmspack differential on"
        } else {
            ""
        }
    );
    if failed > 0 {
        std::process::exit(1);
    }
}
