//! Builds the files that put the `.TDT` exporter's open fidelity questions
//! (#920 claims 1 and 7, #740) to the retail SimTower. Each command reads a
//! real save you supply, re-exports it through the shipped codec, edits one
//! part and writes DOS 8.3-named files next to the save you supply (the
//! `tools/simtower/saves/` folder the game mounts as `C:\saves`). Only our own
//! output is written; the input save is never copied, and a file is never
//! written over the input.
//!
//!   cargo run --release --manifest-path engine-rs/Cargo.toml \
//!       --features conformance --bin tdt_fixtures -- \
//!       claim1|claim7|express740|infested1629 tools/simtower/saves/TOWERx.TDT
//!
//! Then load each file with `tools/simtower/run.sh load
//! /wine/drive_c/saves/<NAME>.TDT` and read what the command prints under
//! "READ". The edits live in `verticopolis_engine::tdt::fixtures`.

use std::path::Path;
use std::process::exit;

use serde_json::Value;
use verticopolis_engine::tdt::fixtures::{
    claim1_fixtures, claim7_fixtures, express740_fixtures, infested1629_fixtures, Fixture,
    MAX_PERSON_RECORDS,
};
use verticopolis_engine::tdt::parse::parse_tdt;

const USAGE: &str = "usage: tdt_fixtures <claim1|claim7|express740|infested1629> <real-save.TDT>";

fn read_save(path: &Path) -> Result<Value, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let name = path
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    let parsed = parse_tdt(&bytes, &name).map_err(|e| e.0)?;
    let transports = parsed
        .save
        .get("transports")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    println!(
        "read {name}: {} bytes, {transports} transports, {} import warning(s)",
        bytes.len(),
        parsed.warnings.len()
    );
    Ok(parsed.save)
}

/// Where the files go: the folder of the input save.
struct Output<'a> {
    dir: &'a Path,
    input: &'a Path,
}

impl Output<'_> {
    fn write(&self, file: &Fixture) -> Result<(), String> {
        let path = self.dir.join(file.name);
        if same_file(&path, self.input) {
            return Err(format!(
                "{} is the input save; rename it so the fixture does not overwrite it",
                file.name
            ));
        }
        std::fs::write(&path, &file.bytes).map_err(|e| format!("{}: {e}", path.display()))?;
        println!("  wrote {} ({} bytes)", path.display(), file.bytes.len());
        Ok(())
    }
}

/// Two paths name the same file, comparing canonical paths when both exist.
fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn claim1(save: &Value, out: &Output) -> Result<(), String> {
    let modes = ["apart", "partial", "full"];
    for ((file, edit), mode) in claim1_fixtures(save)?.iter().zip(modes) {
        println!(
            "  {mode}: shaft at x={} now sits on the shaft at x={}, {} shared tile column(s)",
            edit.moved_x, edit.anchor_x, edit.shared_tiles
        );
        out.write(file)?;
    }
    println!(
        "
READ (#920 claim 1): load each file and screenshot the tower at the two shafts.
  OVLAPCTL  the two shafts side by side, no shared column (control: both should draw).
  OVLAP1    two shafts share one tile column.
  OVLAPFUL  two shafts on the same columns.
  Report for each: do both shafts draw, does only one, does the load fail or the game crash?
  Both drawn -> our importer's drop is wrong. One drawn -> our rule and the warning are right.
  Refused or crash -> the export should refuse or move the shaft; send the result back."
    );
    Ok(())
}

fn claim7(save: &Value, out: &Output) -> Result<(), String> {
    let (files, current) = claim7_fixtures(save)?;
    println!("  our export carries {current} all-zero person records");
    if current == 0 || current == MAX_PERSON_RECORDS {
        println!("  note: the tower's own count equals one of the variants; pick a tower with some population");
    }
    for file in &files {
        out.write(file)?;
    }
    println!(
        "
READ (#920 claim 7): the three files differ only in the number of person records
(0, {current}, {MAX_PERSON_RECORDS}); every other byte matches. Load each, then:
  - the population shown on the status line,
  - a few game minutes: do people spawn, does the game stall or crash?
  - File > Save, then run `cmp` against the file you loaded to see whether the game
    rewrote the person block (the save command is in tools/simtower/README.md).
  Population follows the count -> zero records are inert only if the three agree.
  The three differ -> the game builds people from the records; send the numbers back."
    );
    Ok(())
}

fn express740(save: &Value, out: &Output) -> Result<(), String> {
    let (files, shafts, express) = express740_fixtures(save)?;
    println!("  {shafts} built shafts, {express} express");
    for file in &files {
        out.write(file)?;
    }
    println!(
        "
READ (#740): the two files hold the same {shafts} shafts. EXPLAST is our export, express
shafts written last. EXPFIRST has the express shaft(s) written first.
  Load each and count the shafts the game draws (blue lines on the minimap, or the shafts in the view).
  EXPLAST should show all {shafts}. If EXPFIRST also shows all {shafts}, the \"express last\"
  ordering in encoder.rs can go and #740 can close. If it shows fewer, the old rows stand.
  Report both counts."
    );
    Ok(())
}

fn infested1629(save: &Value, out: &Output) -> Result<(), String> {
    let (files, rooms) = infested1629_fixtures(save)?;
    println!(
        "  {} hotel rooms are rewritten in every file except where noted:",
        rooms.len()
    );
    for room in &rooms {
        println!("    floor {} at x={}", room.floor, room.x);
    }
    for file in &files {
        out.write(file)?;
    }
    println!(
        "
READ (#1629): the four files differ only in the status byte of the three rooms listed above.
  INFCTL    vacant and clean (0x18): the control.
  INFFLAG   the infested flag alone (0x40).
  INFVAC    the infested flag on a vacant, clean room (0x58).
  INFDIRTY  the infested flag with the dirty flag (0x60).
  Load each and look at the three rooms (zoom in on them). Report for each file:
  - are cockroaches or any other infested sign drawn on those rooms, or do they look dirty or clean?
  - does the game load and run without a crash or a message?
  - File > Save after a minute of Fast Mode, then import the saved file with
    tools/simtower/tdt-to-vctower.ts and report how the three rooms read back (infested,
    dirty, vacant) and the import warnings.
  The flag is infestation -> the rooms show it, and it survives the save.
  It is only dirty, or ignored -> the rooms look dirty or clean, and the saved byte changes."
    );
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [command, input] = args.as_slice() else {
        eprintln!("{USAGE}");
        exit(2);
    };
    let run: fn(&Value, &Output) -> Result<(), String> = match command.as_str() {
        "claim1" => claim1,
        "claim7" => claim7,
        "express740" => express740,
        "infested1629" => infested1629,
        _ => {
            eprintln!("{USAGE}");
            exit(2);
        }
    };
    let input = Path::new(input);
    let dir = input
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let out = Output { dir, input };
    if let Err(e) = read_save(input).and_then(|save| run(&save, &out)) {
        eprintln!("{e}");
        exit(1);
    }
}
