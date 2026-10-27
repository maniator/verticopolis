---
story: a7-tdt-prerequisites
status: in-progress
depends_on: engine-tdt-port
issues: [885, 886, 887, 920]
review: /gds-code-review (CLAUDE.md's TDT rule)
---

# Story A7: the TDT prerequisites for #1066's `.TDT` half

## Why

Under OD-8 (a) the owner kept #1066 whole: a `.TDT` import has to boot the
hosted engine from bytes the engine read, which routes a player's `.TDT`
through the Rust codec before the 3.0 flip. `story-engine-tdt-port.md` gates
that route on four items, and the release plan makes them 3.0 prerequisites
at P1 (section 7.2 keeps #1066 whole, section 8 sets the labels, and
workstream A7 in section 9 holds the four):

- #887: the TypeScript exporter crashes or hangs on forged save shapes the
  Rust codec handles, and the two sides read non-finite numbers differently
  across the JSON boundary the route adds.
- #886: every TypeScript TDT test holds the Rust codec to the same outcome,
  through a lock case or a ported Rust unit test, with a table that names the
  mapping test by test.
- #885: a nightly differential fuzzer with round-trip properties, and a
  local-only check of the owner's real `.TDT` saves.
- #920: eleven 1994-fidelity claims both codecs share, checked against the
  1994 game (the Wine harness, `tools/simtower/`) where it applies, before
  either codec changes.

This story does not route anything through the Rust codec. #1066 itself is
the Runtime lane's (D5, after #954), and it starts only when this story's
gate below holds.

## Ownership and boundaries

- Owned here: `src/storage/tdt*`, `engine-rs/src/tdt/`, the TDT tests and
  fixtures (`src/tests/integration/tdt*`, `conformanceWasmTdt*`,
  `src/tests/conformance/tdtDifferential.ts`, `src/tests/fixtures/tdt*`),
  `conformance/tdt-cases.json`, and the new `scripts/tdt-fuzz.ts`,
  `scripts/tdt-compare.ts` and `.github/workflows/tdt-fuzz.yml`.
- Not touched without asking the owning lane first: `engine-rs/src/load.rs`,
  `load_stream.rs` and the `from_save`/`from_vctower` bodies (A8, #1225); the
  boot and engine-loading files (Runtime, Offline); the facade files listed
  in `release-3.0/rust-facade/parallel-map.md`. None of the planned work
  needs them.
- Every change to `engine-rs/` or `src/engine` restarts the replay window
  (the window counts only on the final candidate), so this lane lands
  before the engine freeze. Every change to `tdt-cases.json` takes a crate
  patch bump and `npm run engine:compat` in the same PR; when another lane
  bumps first, the second to merge merges `main` and bumps again.
- Nothing from a real or game-written `.TDT` enters the repository, the
  shared project folder or a CI log (the clean-room rule in
  `tools/simtower/README.md` and the lock generator). A run on a real save
  reports hashes, counts and pass or fail only.

## Acceptance

### AC1, #887: no forged export input crashes or hangs either side

1. `buildTDT` never throws anything but `LegacyExportError`, and never runs
   unbounded, on these inputs wherever `JSON.stringify` can write them (the
   nesting bullet below says what happens past that), and each outcome
   equals the Rust codec's (the same bytes, or a refusal with the same
   message):
   - a `null`, number, string, boolean or array entry in `save.transports`,
     or an object with no kind (Rust drops it and counts it in
     `transportsDropped`);
   - a `skipFloors` or `carPositions` that is not an array (`true`, a
     number, an object, a string): read as an empty list;
   - a two-story unit at a floor past 2^53, or at a string floor: the story
     walk ends after at most one pass per story (how a string floor reads is
     #884's);
   - an object with its own `toString` key where a number or a kind belongs
     (JavaScript cannot convert it): read as NaN, as the engine's
     `js_number` reads any object;
   - `units` or `transports` that is not an array, a string included
     (`save.units is not an array`, `save.transports is not an array`);
   - a unit entry that is not an object, or whose `kind` is missing, not a
     string or not in the catalog (`unit kind "<k>" is not in the catalog`,
     with `<k>` quoted as JSON quotes a string on both sides; this story moves
     the Rust message off `{:?}`, and a lone surrogate is quoted as U+FFFD,
     which is how the engine reads the JSON text it is handed);
   - a missing or non-string `towerName`: bytes, with the report's filename
     falling back the way `legacyFilename("")` does;
   - JSON nested 128 arrays and objects deep, the root included, anywhere in
     the save, even in a field the exporter never reads: refused with the
     engine reader's own message (`save: recursion limit exceeded at line 1
     column <n>`, the UTF-8 byte column of the 128th bracket). Where
     `buildTDT`'s own `JSON.stringify` runs out of stack first (near 4,100
     levels in V8 before 13.8, as in Node 22, a little lower when the caller
     has used more stack; V8 13.8 and later write plain data iteratively),
     the runtime's stack error (a RangeError in V8, an InternalError in
     Firefox) reaches the caller, as `JSON.stringify`'s TypeError for a
     BigInt or a cycle does: no text exists, so the engine's exporter could
     not be handed it either, and the export reports `Export failed:` with
     that error's message (owner decision, 2026-10-27);
   - a parking stall or ramp whose `x` reads as NaN: its floor's chain sorts
     it after every finite number on both sides (the lock pins a missing
     `x`; an object reads the same on both sides).
2. The JSON boundary: the TypeScript exporter reads its input as JSON would
   carry it, so a non-finite number at `minutes`, a hotel's `occupants`,
   `rent`, a unit's `x` or `width`, or anywhere else except a unit's
   `floor`, gives the bytes the Rust codec gives for the `null` that JSON
   writes. A `null` floor still writes different floor records in the two
   codecs (#884). The normalization (one `JSON.stringify`, one `includes`
   and one `JSON.parse`) and the depth scan run once per export at the
   `buildTDT` entry, once per click and on no frame path, and are recorded
   in the hot-path record as such.
3. Every shape above is an export case in `tdtExportCases.ts`, pinned in
   `tdt-cases.json`, replayed by the Rust referee, except three (the
   string floor, the lone surrogate and the deep nesting). The string
   floor's bytes still differ (#884), and `tdtExportForged` checks that its
   walk ends. The lone surrogate and the deep nesting cannot sit in the
   lock: the referee reads it with serde_json, which refuses a lone
   surrogate escape and the same nesting. The differential test's edge
   saves compare both with the engine live, and `tdtExportForged` pins the
   TypeScript messages. The differential test's known-divergence list loses
   the entries this closes.
4. Every export and import case already in the lock keeps its pin byte for
   byte. A changed pin outside the new cases fails the story.

### AC2, #886: the TypeScript suite is the floor for the Rust codec

1. A mapping table in this story (section "Test parity table"), one row per
   TypeScript test in `tdtConstants.test.ts`, `tdtPartMerge.test.ts`,
   `tdtExportParking.test.ts`, `tdtImport.integration.test.ts` and
   `tdtExport.integration.test.ts`: the lock case id or the Rust unit test
   that covers it, or "TypeScript-only" with the reason (for example a test
   of the TypeScript UI report text, or of a helper Rust does not have).
   No empty row; a guard test fails when a TypeScript TDT test has no row.
2. Each import test's builder spec becomes a lock case pinned to the
   TypeScript result (save hash and sorted warnings, or the refusal), and
   each export test's hand-built save an export case pinned to the bytes or
   the refusal. Where a test asserts a derived property, the row says the
   whole-output hash covers it.
3. `tdtConstants.test.ts`, `tdtPartMerge.test.ts` and
   `tdtExportParking.test.ts` are ported as Rust unit tests against
   `format.rs`, `part_merge.rs` and `export_parking.rs`, with no lock in the
   loop, and `cargo test --lib tdt` runs them.
4. The Rust referee matches every added case. A case the Rust codec fails is
   fixed at its source in Rust, with the TypeScript pin unchanged.

### AC3, #885: the differential fuzzer, round trips and the real-save check

1. `scripts/tdt-fuzz.ts`, seeded like `scripts/fuzz-compare.ts`, generates
   random import buffers from the synthetic builder (every tenant family,
   hotel flags, variants, part stacks, elevator and stair tables, tails,
   stamps, hostile cuts) and random export saves (forged fields of the kinds
   #884 and #887 list), runs both codecs (the Rust one through the real WASM
   package), and compares save hashes and warnings on import and bytes on
   export. A divergence prints its seed and writes the case to a directory
   so it can be pinned by name.
2. Round-trip properties on both sides: export, import, export is a fixed
   point on every lock save and every fuzzed save that exports; the import
   of a Rust export equals the import of the TypeScript export of the same
   save.
3. `.github/workflows/tdt-fuzz.yml` runs a fixed budget nightly (and on
   `workflow_dispatch`), never on the pull-request gate, and opens or
   updates one issue on a divergence, the way `engine-fuzz.yml` does.
4. The six harness follow-ups on #885 (refusal pairs recorded by reason, a
   `free()` throw counted as a divergence, a serialize divergence counted
   once, a round-trip test and a reserved key for the non-finite dump
   helpers, dump names under 255 bytes, a note when a run under 50
   mutations skips the agreement guard), plus one from #1241's review: the
   `tdtImport.integration` truncation sweep asserts that some cut still gives
   a confident answer, so a parser that refused every cut would fail it.
5. `scripts/tdt-compare.ts <path ...>` runs each real `.TDT` through both
   codecs and prints, per file, the two save hashes, whether the warnings
   agree, and the round-trip result; it writes nothing. The owner's run on
   his saves (list below) is recorded on #885 as file count and outcomes,
   with no save content.

### AC4, #920: each claim checked, then fixed in both codecs or recorded

For each of the eleven claims, a row in the "#920 verification record"
below: the evidence (Wine harness run, game-written save read, or analysis
of our own reader and writer), the verdict (matches the game, differs from
the game, or a defect in our own code), and the action. A change lands in
the TypeScript reference and the Rust port together, with lock cases that
pin it, in the PR that fixes it; a claim the game confirms is recorded and
closed with no change. A claim that cannot be checked (for example the
harness cannot drive a needed action) is recorded as such and goes to the
owner, who decides whether it closes.

### Gate for #1066's `.TDT` half

AC1 to AC4 merged with green CI, the owner's real-save run recorded on
#885, and every #920 row closed or accepted by the owner. Then the Runtime
lane may route `.TDT` import through `importTdt`.

## Real saves this story needs (OD-8)

| Check | What it needs | Saves the docs already name | Where it runs |
|---|---|---|---|
| #885 real-save compare | Every `.TDT` on the owner's machines: game-written saves, plus any older Verticopolis export (stamped or not) | `my_tower`, `mo`, `TOWER5` (canon notes), `MYTP0` (the no-rate finance spec) | PC local session, `scripts/tdt-compare.ts` |
| #920.2 stairs scan window | Game-written saves with built stairs or escalators and a nonzero finance block and parking | Unknown which of the four carry stairs and parking | PC local session, read only |
| #920.8 hotel occupants | A game-written save with occupied single rooms, twin rooms and suites | `TOWER5` (338 hotel rooms) | PC local session, read only |
| #920.1 colliding shafts | Our own export with two overlapping shafts, loaded in the 1994 game, then saved by the game | None needed | PC, Wine harness (`run.sh load`, `run.sh save`) |
| #920.5 blocked Wedding Hall | Our own export with a hall whose stack is blocked, loaded and saved by the game | None needed | PC, Wine harness |
| #920.7 zeroed person records | Our own export of a populated tower, run several game days in the 1994 game; one game-written save's person block for comparison | `TOWER5` or `my_tower` | PC, Wine harness |
| #920.3, .4, .6, .9, .10, .11 | Built files only: these are our own reader's and writer's consistency | None | Cloud and CI |

A tower we exported ourselves (such as `sixseven_14`) tests our own round
trip and stands in for no game-written save. A game-written save made by
loading our export in the harness and saving it from the game counts as
game-written for #920.1 and #920.5, since the 1994 game wrote its bytes.

## PR plan

1. The `tdtImport.integration` sweep's timeout (CI flake on #1185; test
   only).
2. AC1 (#887), with this story; crate patch bump.
3. AC2 (#886): the Rust unit-test ports first (no lock change), then the
   lock cases and the table; crate patch bump with the lock.
4. AC3 (#885): the fuzz script, round trips, the nightly workflow, the
   compare script and the harness follow-ups.
5. AC4 (#920): the cloud-checkable claims first; the harness claims after
   the PC run; each fix in both codecs with its lock cases.

Each PR runs `/gds-code-review` before review, with a hot-path record where
the checklist applies, and goes to the independent reviewer through the
coordinator. No auto-merge before that review.

## Review record

**AC1 (#887), round 1** (`/gds-code-review` at eda947e, 2026-10-21, all
four layers ran: Blind Hunter, Edge Case Hunter, Acceptance Auditor and the
Hot-Path Auditor). Fixed in the PR: a string unit floor still made the story
walk run for minutes and then overflow the extents map; an object with its
own `toString` key at any number site threw a bare TypeError;
`tdtEncoder.ts` went over the 500-line ceiling; the null shapes of AC1.2
(`minutes`, a hotel's `occupants`, `rent`), the `toString` objects, a
transport kind as a unit kind and a two-forgery refusal order were not in the
lock (9 cases added, 41 new `forged-*` cases, the Rust referee 269 of
269); the lone-surrogate quoting is now an edge save the differential test
puts through the engine; the dropped-transport count is asserted; the
`buildTDT` comment no longer claims every non-tower value is refused; this
AC's quoting wording; and the run records in `story-engine-tdt-port.md` and
the #885 and #887 rows. Deferred: the JSON copy's cost per export (#1260,
row `tdt-export-json-copy`: about 30 ms more on the 43,358-unit perf tower,
the round trip about 20 of it, cloud estimate) and serde_json's 128-level
depth limit on the engine's export parse (added to #884, closed in round 2). Dismissed: a BigInt or a cycle (not JSON, and
the engine's exporter could not be handed one), the minor version bump
(CONTRIBUTING's default for a visible fix), and the lock's raw DEL and U+2028
(valid JSON, and the point of the quoting case).

**AC1 (#887), round 2** (`/gds-code-review` at 1a59976, the branch with
main merged, 2026-10-21, all four layers). Fixed in the PR: JSON nested
about 2,800 levels or more threw a bare RangeError (from the reviver, a
field's conversion or `JSON.stringify`), and from 128 levels up to that
TypeScript wrote bytes where the engine refuses; `buildTDT` now refuses at
128 levels with the engine reader's message and column, which closes
#884's depth item. A parking stall whose `x` reads as NaN sorted
differently in the two codecs (once a comparator leaves NaN unordered, V8's
sort and Rust's order one list differently); both now sort NaN after every
number. AC1.2 and AC1.3 now name their exceptions (a non-finite unit floor,
the lone surrogate and the deep nesting). Seven lock cases were added (a
`true` carPositions, a `toString` unit kind, two transport kinds no table
holds, Modern rules refused before a forged unit list, and two lists with a
NaN stall, one per old sort): 48 new `forged-*` cases, the Rust referee 276
of 276. A Rust test pins the
six dropped transport entries. The per-field sweeps forge every key any
lock tower's entries carry, and -2^53; the NaN sweep puts its hotel to
sleep so the occupants are read. Also fixed: the run records, the cost
wording and the commit messages. Deferred: nothing new; #1260 now also
names the entry's two text scans and the reviver's cost. Dismissed: a
missing `skipFloors` against an empty one (both read as `[]`), refusals
that only a developer's string can reach (needed for parity with Rust),
the CHANGELOG leaving out NaN handling (no player meets it), explicit test
timeouts, and lock pins that share one hash (null and an object read alike
on both sides).

**AC1 (#887), round 3** (`/gds-code-review` at 044993e, 2026-10-21; the
Hot-Path Auditor, Blind Hunter and Edge Case Hunter ran, and the Acceptance
Auditor was cut off by a usage limit). No code bug. The Edge Case Hunter
put 85 targeted nesting cases, 12,000 random parking floors, 24,000
nested-path mutations and 7,876 random JSON trees through both exporters
with no divergence outside #884's forged unit floor, x and width. Fixed in
round 4's commits: the nesting tests sat at 3,500 levels, close to where
`JSON.stringify` runs out of stack under coverage, and wording in the
docstrings, fixtures, this story and the backlog. Deferred to #1260: a
forged save holding thousands of wedding halls on one floor makes the stack
collision scan in both gathers quadratic before the shared refusal (8,000
halls: about 6.9 s in TypeScript, 0.94 s in Rust, cloud estimate); bounded,
and the live path cannot build one, since the loader drops overlapping
units.

**Owner direction, 2026-10-22, and the Copilot sessions.** After a party
review on the PR, Naftali wrote on it: "keep #1292 focused on approved #887
safety/compatibility fixes; do not expand speculative forged-only
TypeScript parity. TypeScript simulation and codec paths are
maintenance-only during the staged Rust cutover. Rust is the long-term
authority." He opened #1301, which makes the frontend's Rust-backed save,
load, import and export path a pre-3.0 requirement and adds: "Do not
silently revert its safety guardrails or merge it based on this issue
alone." Copilot then merged main twice and, for Codex's review thread on
the depth refusal, walked every save to a depth of 2,048 before
`JSON.stringify` (27dbb17), refusing with `column 1` when the walk reached
that depth. The differential test's 3,000-level edge save then diverged
from the engine in CI, and dumping that input overflowed the stack, which
b15aadc guarded.

**AC1 (#887), round 4** (`/gds-code-review` at f2267e0, 2026-10-27, all
four layers: the Blind Hunter, Edge Case Hunter and Hot-Path Auditor on the
delta since 044993e, the Acceptance Auditor on the whole PR). f2267e0
moved the walk to the failure path: it runs only after `JSON.stringify`
throws a RangeError, so a save that writes pays nothing (the Hot-Path
Auditor measured 27dbb17's walk at about 10 ms per export on the large
perf tower), and every depth the binding can receive keeps the engine's
column (TypeScript and the engine agreed at 1,000, 2,100, 3,000 and 4,000
levels). No code bug and no AC violation. Fixed: a test and the deep edge
save now sit at 2,500 levels, between 2,048 and the stack limit, so a walk
before the stringify cannot return unnoticed; the 100,000-level test
accepts the column that V8 13.8 and later write (Chrome 141 and Node 25
stringify plain data iteratively past 200,000 levels); the dump guard
labels the error it caught; this AC's parking and nesting wording, the
comments, and #1260's text. Dismissed: values JSON cannot carry (a `toJSON`
method, a getter, a boxed number, extra keys on an array), as in round 1,
and a re-stringified save past V8's longest string, since saves are capped
at 32 MB. Open for the owner: whether to keep the failure-path refusal at
all, since in Chrome it never runs for a JSON save and Firefox throws a
different error class there (the export dialog shows the error either
way), and whether to squash Copilot's two commits titled "Changes before
error encountered". Deferred: a forged `.vctower` can carry nesting of any
depth in a unit or transport field, which `Simulation.deserialize` keeps
through its spread of the entry (#1318, row
`vctower-load-deep-entry-fields`).

**Owner decision, 2026-10-27.** Naftali chose to drop the failure-path
refusal and to squash the branch. `nestsTooDeep` and the catch around
`JSON.stringify` are gone: past the stack of a `JSON.stringify` that
recurses, the export reports `Export failed:` with the stack error's
message, as at 044993e, and the 100,000-level test accepts that error or
the column refusal that V8 13.8 and later reach. The 2,500-level test and
edge save stay. The branch was then reshaped into two commits on top of
main (it still merges into main with a merge commit), so the commit ids in
the records above (eda947e, 1a59976, 044993e, 27dbb17, b15aadc, f2267e0)
name earlier states of the branch; the ones pushed to #1292 stay listed in
its timeline on GitHub.

**AC1 (#887), round 5** (`/gds-code-review` on the squashed branch before
this round's fixes, 2026-10-27, all four layers on the delta since d6e31df,
the Acceptance Auditor also on the whole PR). No code bug and no AC violation. The Hot-Path Auditor found
nothing new (F1 stays with #1260) and measured the bytes and the success
path unchanged. The Edge Case Hunter put 660 nesting cases through both
exporters with no divergence wherever `JSON.stringify` writes text, and 150
more with the text an iterative `JSON.stringify` would write. Fixed:
wording in this AC (the stack error's type, the V8 versions, a deeper
caller, what the export reports), the forged test's header, title and
stack-error check, the #887, #884 and #1318 backlog rows, the bodies of
#1318 and #1260, the TDT port story's edge-save count, the commit list
above and the code commit's message. Dismissed: gating the 100,000-level
test on the V8 version (each runtime takes one branch, and bytes fail it),
a test for a RangeError from a `toJSON` method (it only covered the removed
catch), commit ids a force-push leaves behind (each record says in words
what it checked), and three more lines in `export_gather.rs`, a file on the
size ratchet whose split is its own work.

## Test parity table

(Filled by PR 3.)

## #920 verification record

(Filled by PR 5 and the PC runs.)
