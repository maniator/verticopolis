# Party transcript: gate-2 triage and #1250 (2026-11-03)

> **Snapshot, 2026-11-03.** Issue states, milestones and labels are as read on
> this date. Live state is the `3.0.0` milestone and the matrix in #1104; the
> gate rows are in #945 (original table kept verbatim there). Traffic figures
> are not used here; they belong to the Reliability recommendation
> (a project-files document, not part of this repository, awaiting the
> owner's approval), which comes from the governed `session_lengths` view and
> `scripts/engine-reliability.mjs`.

Room: Cross-Cutting Plan Review. 📋 John (PM), 🏗️ Winston (architect), 🏛️ Cloud
Dragonborn (game architect), 🎲 Samus Shepard (game designer), 📈 Anika (data
scientist), 💻 Amelia (dev), 😤 Grumbal (adversary), 🌶️ Boundary (edge cases).
Specialists pulled in: ⏱️ Tess (performance and conformance QA), ⚙️ Hank (build
and CI), 🦀 Ruth (Rust). Scribe: 📚 Paige. Session mode.

On the table: the 13 open issues labeled `gate-2` ("before stage 3 of the
cohort"). The cohort is gone (#1512 Rust-only, #1520 cohort removed, #1595
switchable build retired), so the label has no meaning. Naftali's instruction:
sort each issue to gate-3, 3.x or close as obsolete, keep every acceptance
criterion and regression check, weaken no release requirement. The 2026-10-30
post-merge review had tagged #1090, #1086, #1111, #1162, #878 and #1250 as
"close or rewrite".

## Ground rules the room set

- **John:** Every row answers one question: which #945 gate row does this issue
  produce evidence for, or remove a blocker from? If none, it is 3.x. If one,
  it is gate-3 no matter how old the label.
- **Grumbal:** "Obsolete" is the cheapest word in the room. An issue is
  obsolete only if the thing it measures or guards no longer exists. If the
  premise changed but the guard still matters, it is a rewrite, not a close.

## Row by row

**#878 unit and integration suites on the WASM engine.**
Tess: this is the Unit and integration row's own evidence (the test-mapping
table). The `integrationWasm` and `unitWasm` lanes already exist, so much of it
may be done, but the table and the named exclusions are the pass condition.
Grumbal: then "TS versus Rust test parity" being moot is half right. The lanes
now run Rust only; what is left is the mapping table. *Verdict: gate-3.* Whoever
owns the row checks the table against the lanes and closes the issue only with
that evidence in the comment.

**#921 UI reads engine catalog.**
Cloud: the Authority row says "the UI reads no TypeScript price or rule table
(#921)". That sentence is the gate. Winston: the Rust-only thread's display
table and catalog move overlaps, so one owner, no second implementation.
*Verdict: gate-3.*

**#926 catalog second slice (the room's longest argument).**
John proposed 3.x: it is a catalog completeness issue. Grumbal read items 3 and
4 against the Authority row: starting cars (`initialCars`) and the constants the
UI imports (`HK_*`, `INFEST_DAYS`, `NEEDS_FLOORS`, `GARBAGE_COLLECT_HOUR`, the
facility predicates) are rule values the UI still reads from TypeScript. If
those stay, #921's condition cannot pass. Moving the whole issue to 3.x would
quietly weaken the Authority row. Cloud agreed and added item 1 (the Modern rent
lump) for the same reason: a frontend applying a rent rule itself is TS-authored
logic, the standing rule's gap. Item 6 (charge parity for quoted values) is
regression coverage and stays with the gate. Item 2 (varying population) is already done (#921 part 2b). Items 5
(declaration home before the TS engine retires) and 7 (`readCatalog` hardening)
are hygiene tied to TS deletion; the backlog row (D6, 2026-10-20) had already said
items 5 to 7 are not gate inputs and may split. The room kept item 6 in the gate
anyway, the conservative reading of "weaken nothing". *Verdict: split. Items 1,
3, 4 and 6 stay in #926 as gate-3 (it is a prerequisite of #921). Items 5 and 7
move to a new 3.x issue (#1621).* Amelia: the owner of #921 checks which of items 1, 3 and 4 the UI still
imports before the split is final; any it does not import can move to 3.x with
that evidence.

**#1086 engine_status deploy-race coding.**
Anika: the Reliability row counts engine faults; a deploy race coded as a fault
inflates the number the gate reads, so the measure's validity depends on this.
Hank: shapes 3 and 4 in the body are the worker host (a link error reaching the
main thread as a plain message, and `attach-refused` without the catalog check).
The worker host was dropped from the build (#1607), so those two are obsolete.
Boundary: shape 1 (old hashed glue 404, or `import()` `TypeError`) looks the same
as a network that is down; the code cannot tell them apart from the error alone.
*Verdict: gate-3, rewritten to shapes 1 and 2, with the network-down ambiguity
stated and the identity-check route (#985) as the fix.* Per-arm wording goes.

**#1090 reliability definition.**
Anika: arm, `size_gated` and `stage` no longer exist, so the per-arm crash rate
and the difference interval have no meaning. What survives: early telemetry
versus eligible evidence, the exact one-sided bound over eligible sessions and
over the tail (the candidate-build window), by build, and the stop signals that
need no control arm: a repeated engine-fault fallback (same reason, same build,
two sessions), a repeated engine or host `$exception`, and any latch-off.
Grumbal: without an arm, what catches a Rust-only crash regression? Anika: the
absolute signals above, plus classifying `$exception` by origin, which is the
unfinished half of #1090 and the reason it must stay. *Verdict: gate-3,
rewritten for Rust-only; the Reliability window and population come from #945
once Naftali approves them.*

**#1111 A/A mode for perf:worker (M4).**
Tess: M4 long-task tolerance has no A/A source today; that is its whole point.
#1607 says `perf:worker` cannot run (no engine worker chunk) and that the
`--aa` part is the one consumer that still matters. Grumbal: so #1111 is not
obsolete, it is blocked by #1607, which sits in 3.x. Hank: either #1607 moves
with it or the gate loses M4 quietly. *Verdict: gate-3, body restated (same
engine in both slots is now Rust against Rust, no TS slot), and #1607 moves to
3.0.0 gate-3 as its prerequisite (trim `perf:worker` to what remains, keep the
A/A source).* **Open for Naftali:** whether M4's long-task tolerance stays in
the provisional Performance row. The room does not decide that.

**#1162 perf:compare warmed second tower.**
Tess: the bias on the second tower (about 1,441 ms warmed against about 705 ms
fresh for TypeScript on the PC, per the issue) corrupts every cross-engine ratio
on the large tower, and the Performance row compares against the pinned TS
baseline build (#1597). *Verdict: gate-3.*

**#1215 engine diagnostics facts.**
Cloud: #1561 (parity gate) names it, and the standing rule says the facts belong
in Rust. *Verdict: gate-3.*

**#1237 reads walking every unit.**
Ruth: `count_operational`, `highest_floor` and `functional_parking_set` are
byte-identical Big-O fixes; the congestion overlay refreshes about every 0.5 s at
top speed, so this is frame budget. Tess: the Performance row's 5,000+ population
fixture is where it shows. The `powf` item is low and can defer. *Verdict:
gate-3.* If the PC Performance run shows the panel getters inside budget, demoting
it is an evidence-backed decision for Naftali, not for this room.

**#1254 cold start to TS time (M5, PF5).**
Tess: last PC run had WASM +71.8 ms cold at 1x against an epsilon cap of about
20 ms (snapshot 2026-10-21). The Performance row says cold load within +500 ms,
the plan's M5 is tighter, and the comparison is now against the pinned TS build.
*Verdict: gate-3.* Whether saved-tower rows join M5 stays Naftali's call, as the
issue already says.

**#1259 first build doubles the unit list.**
Tess: heap within 1.25x is a gate row, and the measured 24.56 to 52.38 MiB step
after one build on the large tower is a real part of it. *Verdict: gate-3.*

**#1421 delete SimPort, TsSim and the mirror parity harness.**
Winston: deleting TS scaffolding is the 3.x retirement. Grumbal: the issue itself
says the `src/wasmhost/` mirror code and the `unitWasm` and `integrationWasm`
lanes are still the Rust parity coverage, and the Dual run and Unit rows depend
on them until #878's evidence is recorded and pinned Rust goldens replace the
referee. Deleting them early removes coverage. *Verdict: 3.x, with a stated
condition: it does not merge until #878's evidence is recorded and the Dual run
row has its replacement goldens.*

## #1250 minimum per-arm sample for the crash stop signal

Anika: it sizes an interval comparison between a WASM arm and a TS arm. The
cohort script it edits is gone from `main`, the arms are gone, and the backlog
row already reads "mostly moot (2026-10-30)". Nothing in the repo or other open
issue bodies depends on it (searched `1250` and the row id).
Grumbal: closing must not reduce our ability to see Rust crashes. Anika: it does
not, as long as #1090 keeps the arm-free signals above; what #1250 sized no
longer exists. The lessons carry into #1090 as notes, not criteria: (1) an
interval signal fired at 2 of 2 against 0 of 2, so any rate signal in the
rewrite states a minimum eligible-session count and says "not enough sessions"
below it, never "no crashes"; (2) event-count signals (repeat of the same fault)
fire early on purpose and are exempt; (3) with zero events in n sessions the exact
95% upper bound is about 3 over n, so a sample-size statement belongs with the
Reliability window, not in a stop signal. Boundary: a build with zero eligible
sessions must read as "no data". *Verdict: close as not planned, with a comment
that carries these notes to #1090 and #945.*

## Retiring the label

John: `gate-2` appears in `.github/labels.yml`, `.github/workflows/labels.yml`
and the backlog conventions; #1104's "Gate 2" section lists closed issues
(#1197, #1289, #1350). Hank: delete the label from the repo and both files in one
PR. #1104's current-scope section is rewritten to gate-1 (none open), gate-3 and
3.x. The room notes `gate-1` has the same problem (none open) and left it alone
because nobody asked.

## Verdict table

| Issue | Verdict |
| --- | --- |
| #878 | gate-3 (verify the mapping table, close only with evidence) |
| #921 | gate-3 |
| #926 | gate-3 for items 1, 3, 4, 6; items 5 and 7 move to #1621 (3.x); item 2 done |
| #1086 | gate-3, rewritten (shapes 1 and 2) |
| #1090 | gate-3, rewritten for Rust-only |
| #1111 | gate-3, restated; #1607 joins gate-3 as its prerequisite |
| #1162 | gate-3 |
| #1215 | gate-3 |
| #1237 | gate-3 |
| #1254 | gate-3 |
| #1259 | gate-3 |
| #1421 | 3.x, with the merge condition above |
| #1250 | close as not planned, notes carried to #1090 and #945 |

Needs Naftali (not decided here): M4 in the provisional Performance row; the
Reliability window and numbers; whether the saved-tower rows join M5; any
demotion of #1237 or #1259 on PC evidence.

No criterion was changed, weakened or removed. Every gate-2 issue that served a
gate row keeps its gate-3 label.
