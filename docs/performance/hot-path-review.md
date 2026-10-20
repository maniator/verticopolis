# Hot-path complexity review

This page is the one checklist for reviewing algorithmic cost on the game's hot
paths. `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`,
`_bmad-output/project-context.md`, the Copilot review overlay, the engine parity
skill and the pull request template link here and keep only a summary. Rule
changes go here, and the summaries follow.

It exists because the rule it replaces did not stop the Rust port (#857) from
shipping per-person and per-step scans of every unit in the tower, or from
dropping caches the TypeScript engine already had. Profiling found them (#1051,
#1139). Review should have. Section 8 shows which item catches each of those
misses, and the audit in #1158 lists every one found in the Rust engine and the
hosts.

## 1. When it applies

Apply the checklist to any change that adds, ports, rewrites, moves or calls
code reachable from an entry point in section 2, on any of these surfaces:

| Surface | Paths |
| --- | --- |
| Rust engine | `engine-rs/src/` |
| TypeScript engine | `src/engine/` |
| WASM binding | `engine-rs/src/wasm.rs`, `engine-rs/src/frame.rs`, `src/dualrun/` |
| Hosts (main thread and worker) | `src/wasmhost/` |
| Rendering and per-frame UI | `src/render/`, `src/presentation/`, `src/game/` (frame loop, build preview, HUD, inspector), `src/ui/` |

A port or a rewrite changes every line it adds, so all of it is in scope,
including algorithms copied unchanged. A diff that touches none of these paths
records one line saying so (section 6).

## 2. Frequencies and sizes

Cost is frequency times collection size. Use these reference numbers instead of
guessing.

**Entry points.** Rust names first, TypeScript second where they differ.

| Tier | Entry point | How often |
| --- | --- | --- |
| Per frame | the host's frame read (`frame_view`, then `decodeFrame` or `applyRecords` in `src/wasmhost/`), render sync, HUD and panel refresh | every rendered frame |
| Per step | `Sim::advance_step` / `Simulation.tick` sub-step: elevator demand (`accumulate`), the spawn step, construction | every step: 720 per game day at the hosts' 2-minute step, several per frame at 4x |
| Per chunk | motion chunks of up to 2.5 game minutes inside a step: `elevator_calls`, `move_cars`, `motion::advance` | one or more per step |
| Per hour | `on_hour`: presence, hotel checkout, housekeeping dispatch, satisfaction, move-ins, traffic income, elevator utilization, star evaluation | every 30 steps |
| Per day | `on_day`: rent and maintenance, random events, VIP, milestones, nudges | every 720 steps |
| Per command | place, remove, transport edits, load, and build preview (`canBuild` on every pointer move) | per player action; pointer moves arrive at frame rate. Every revision-keyed cache rebuilds after an edit, so its build cost counts here too |

**Collections.** The reference towers are the `perf:compare` scenarios
([`ts-vs-wasm.md`](ts-vs-wasm.md)) and the owner's Modern save
`conformance/fixtures/split-tower-4.vctower`.

| Collection | Size | Notes |
| --- | --- | --- |
| units, all (U) | 12,062 medium; 19,806 owner's save; 43,358 large | about 38,000 of the large tower's units are floor and lobby tiles, and any walk over `units` pays for every one |
| rooms (R) | 1,699 on the owner's save | `room_units()` / `roomUnits` |
| population | 3,240 medium; 6,019 owner's save; 17,322 large | census and statistical demand |
| drawn people (P) | at most 140 (`MAX_PEOPLE`) | the crowd that walks and rides |
| floors (F) | up to 110 (floors -9 to 100) | |
| transports (T) | up to 24 elevator shafts and 64 stair and escalator links | 8 cars per shaft |
| x positions | 375 per floor (`LOT_WIDTH`) | |

The effective cost of a scan is its own size times every loop and tier above
it. Example: `max_staff_for` walks all U to count housekeeping units. It runs
for each staff spawn attempt, inside a loop over candidate rooms and crews in
`dispatch_housekeepers`, which runs every hour in shift and on every step that
returns staff results. A cloud profile of the owner's save put it at 26% of the
bare step (relative share only).

## 3. The checklist

Each item has an id so a review can record it (section 6).

**HP-1 Trace callers to an entry point.** For every changed, added or ported
function, name its callers up to an entry point in section 2 and write down the
tier and every loop in between. A helper is as hot as its hottest caller. This
needs the repository as well as the diff: search the callers in both engines.

**HP-2 Find whole-collection work under a multiplier.** Flag anything that
touches every unit, room, floor, transport, person or tile inside work that
runs per person, per unit, per room, per floor, per transport, per candidate,
per step, per chunk or per frame. Work done inside a helper counts: a helper
that scans is a scan. These idioms all count the same:

- TypeScript: `.find`, `.filter`, `.some`, `.every`, `.reduce`, `.map`,
  `.includes` or `.indexOf` on arrays, `for (const u of tower.units)`,
  `Array.from(map.values())`, spread copies.
- Rust: `iter()` chains ending in `filter`, `find`, `position`, `any`, `all`,
  `count`, `sum`, `min_by_key` / `max_by_key` or `collect`; `for u in
  &tower.units`; `Vec::contains`; `retain`; `Vec::remove` and `Vec::insert`
  (both shift the tail).

One linear pass per entry point (once an hour, once per command) is usually
fine. A linear pass per item of another collection is the finding. Two more
patterns count here as well:

- the same walk repeated within one entry point (several `count_operational`
  or `total_population` calls in one hourly pass): compute it once and pass it
  down;
- a walk over `units` when only rooms matter: it pays for every floor and lobby
  tile, so use `room_units()` / `roomUnits` or a kind index.

**HP-3 Count allocations and copies.** These cost as much as a scan when they
run per item:

- Rust: `.clone()` of a cached `HashSet`, `HashMap` or `Vec` on every accessor
  call (return a borrow or an `Rc` / `Arc` slice, or answer the query in place);
  cloning a `Unit` or `Transport` per iteration; a fresh `Vec`, set or map from
  `collect()` or `to_vec()` per call; `format!` in a loop.
- TypeScript: a new array or object per element on a per-frame path,
  `JSON.parse` / `JSON.stringify`, `structuredClone`, spreading a large array.
- Both: rebuilding a lookup structure every step when its inputs change only on
  an edit.

**HP-4 Check sorting and ordered rebuilds.** A sort on every call of a
collection that only changes on an edit (sort once per revision), a sort inside
a per-candidate loop, or an ordered set rebuilt every step.

**HP-5 Check containers and hashing.** Rust's default `HashMap` / `HashSet`
hasher (SipHash) is slow for small integer keys, and a search that builds
`prev` and `seen` maps on every call pays it on every insert. Prefer a dense
`Vec` indexed by unit, floor or segment, a reused scratch buffer, or a fast
deterministic hasher. Only a map that is never iterated may change its hasher
or container; a map that is iterated must already keep insertion order
(`IndexMap`, `IndexSet` or `Vec`, engine parity checklist item 7).

**HP-6 Look up by id, and keep removal linear.** Use `getUnit` / `getTransport`
in TypeScript and `get_unit`, `by_id` or `transport_by_id` in Rust.
`units.iter().position(|u| u.id == id)` and `units.find(u => u.id === id)` are
the same finding in either language. Removal must not rebuild a whole index
for each removed unit: a bulk sell, a demolish or a lobby placement removes many
units in one command, so an O(U) rebuild per removal is O(k × U) per command.

**HP-7 Review inherited algorithms.** Ported, rewritten or moved code is
reviewed as if it were new. "Same algorithm as the TypeScript", "faithful
port", "pre-existing" and "no new regression" do not close a finding. If an
inherited algorithm is superlinear on a hot path, the PR fixes it or records it
under section 7. A port is the cheapest time to fix one, because the
conformance suite is already comparing the new code with the old.

**HP-8 Compare with the TypeScript's caches before porting.** Before porting a
function, list the caches, indexes and counters the TypeScript version and its
callees use, and port each one or say in the PR why not. A comment in the port
saying a cache was skipped (for example because the TypeScript cache "is pure"
or the value is "computed fresh") is itself a finding. The TypeScript caches
today:

| What it caches | TypeScript | Keyed on |
| --- | --- | --- |
| rooms without floor and lobby tiles | `roomUnits`, `src/engine/tower/rooms.ts` | unit array, length, revision |
| each floor's segment runs | `src/engine/tower/segments.ts` | revision |
| housekeeping staff ceiling | `staffCeiling` (`maxStaffFor`), `src/engine/crowd/spawn.ts` | revision |
| noise verdicts | `noiseMemo`, `src/engine/sim/satisfaction.ts` | revision |
| served floors, staff components, stops, transport columns, floor bounds | `src/engine/Tower.ts` | revision |
| passenger and staff routing graphs | `adjacency`, `staffAdjacency`, `src/engine/crowd/routing.ts` | revision |
| shaft banks | `src/engine/crowd/shaftBanks.ts` | revision |
| segments served | `segServed`, `src/engine/crowd/segmentGraph.ts` | revision |
| queue view | `queueView`, `src/engine/Crowd.ts` | step and revision |
| lobby reachability for services | `reachMemos`, `src/engine/sim/services.ts` | revision |
| demand map | `demandMemo`, `src/engine/sim/demand.ts` | revision and game hour |
| reachability during one move-in pass | `reachMemo`, `src/engine/sim/churn.ts` | one pass |

When a PR adds a cache to either engine, it adds a row here.

**HP-9 Name the remedy.** For each finding under HP-2 to HP-6, say which of
these fixes it, in this order of preference:

1. an index (by id, kind, floor or segment) built once per revision;
2. a tower-wide fact hoisted out of the loop and computed once per pass;
3. an incremental counter updated on place, remove or state change;
4. a cache keyed on everything the result depends on (HP-10);
5. a borrowed view instead of a copy;
6. one cache shared by the passes that ask the same question in the same hour.

**HP-10 Keep results identical and invalidate correctly.** An optimization
changes no observable result:

- Iteration stays in insertion order. No new iteration over a `HashMap` or
  `HashSet`, and no sort the other engine does not do.
- The same random draws from the same three streams, in the same order.
  Caching a value a draw depends on, or skipping a call that draws, moves every
  later hash.
- Events stay in the same order, gameplay results stay identical, and saves
  stay byte-identical.
- The cache key covers every input. `revision` covers structural edits only
  (place, remove, transport edits). Loading a save resets the cache (in Rust,
  `Tower::reindex` resets `tower.memo`). A result that reads unit state,
  occupancy, tenancy, the hour, the weekday, the star rating, settings or the
  crowd needs that input in its key, or a lifetime of one step or one pass. A
  revision-keyed cache of anything else is a correctness bug.
- Evidence: the conformance lock (`conformance/expected.json`) unchanged, a
  test for each invalidation input (edit, load, each non-structural input),
  and, for engine hot paths, the seeded differential and a byte-identical save
  on the reference saves.

**HP-11 Check the WASM boundary and the hosts.** What crosses from Rust to
JavaScript each frame should scale with what changed or what is drawn. Static
tiles do not need to cross every frame. Look for one
JavaScript object or one `Map` lookup per unit per frame, for `serialize`,
`JSON.parse`, `deserialize` and a merge on every hour or revision, and for
worker messages that copy what they could transfer. Name the tracking issue
when one already covers it (#1045, #1049, #1050, #1068).

**HP-12 Check rendering and UI refresh.** Per-frame work in renderers, the HUD
and panels scales with what is on screen (camera bounds, `MAX_PEOPLE`) and
stays flat as the tower grows. No walk over all units per frame, and DOM
rebuilt on change only. Build preview runs on every pointer move, so cap checks there
(`count_kind` / `countKind` over all units) count as per frame.

## 4. Measuring

Rank findings by measured cost; Big-O alone does not set the priority. Walking
1,699 rooms once an hour is cheap. The same walk for each drawn person in every chunk is not.

- Estimate first: tier frequency times multipliers times collection size, with
  the sizes in section 2. Write the estimate down.
- Measure when the estimate matters. A native profile of the bare step on a
  reference save, or `npm run perf:compare`, gives relative shares. Numbers
  from a cloud machine are estimates and say so.
- Acceptance figures come only from the owner's desktop, under
  [`benchmark-protocol.md`](benchmark-protocol.md). A review never starts a run
  there.

## 5. The PR complexity note

A significant engine change carries this note in its description; the pull
request template asks for it. Significant means it adds, ports or rewrites code
on a per-frame, per-step, per-chunk or per-hour path in either engine, the
binding or a host; adds or changes a cache; or changes what crosses the WASM
boundary per frame or per hour.

```markdown
### Complexity
- Hot paths touched: `function` ← caller ← entry point (tier), for each one.
- Sizes: U, R, P, F, T on the reference saves that matter here.
- Before and after: for example O(P × U) per step becomes O(P) per step plus O(U) per revision.
- Repeated scans that remain, and why each is acceptable (frequency times size, measured or estimated).
- TypeScript comparison (HP-8): the caches the TypeScript has here, and whether this ports them.
- Results and invalidation (HP-10): cache keys, invalidation tests, conformance and differential evidence.
- Measurements, each labeled cloud estimate or desktop evidence, or "none".
```

## 6. Recording the review

A review applies the checklist by recording it. The Hot-Path Auditor layer,
the independent reviewer and Copilot each print this table:

| Item | Result | What was checked | Finding and resolution |
| --- | --- | --- | --- |
| HP-1 | finding, clear or n/a | the functions and callers traced, and the entry points reached | |
| HP-2 to HP-12 | one row each | | |

- Every item gets a row. "Clear" names what was inspected (functions, call
  paths, both engines). A bare "checked" or "looks fine" does not count.
- "n/a" gives a reason tied to the diff, such as "no code on a section 1
  surface".
- When the whole diff is outside section 1, one line saying so replaces the
  table.
- A review without the record is incomplete, and an independent reviewer cannot
  give a GO on it.

## 7. Resolving a finding

Every hot-path finding ends in one of two states before merge:

1. **Fixed in the PR**, with HP-10 evidence that results are unchanged.
2. **Deferred**, with all of: the estimate or profile (section 4), a GitHub
   issue and backlog row (the backlog mirror rule in `CLAUDE.md`), and one
   sentence on why it is not fixed now.

A finding is never dismissed for being pre-existing, for matching the
TypeScript, or for sitting outside the diff. In BMAD/BMGD triage a hot-path
finding is `patch` or `defer`. It is `dismiss` only when the reviewer shows it
is a false positive: the code is not on a hot path, or the collection is
bounded and small.

Two kinds are always `patch`, and deferring one needs the owner's explicit
acceptance on the PR on top of the evidence and issue above:

- code the PR adds, ports or rewrites that puts a whole-collection walk under a
  per-person, per-unit, per-room, per-candidate, per-chunk or per-frame
  multiplier;
- a port that drops a cache the TypeScript already has (HP-8).

## 8. Worked example: the misses #1139 found

| What shipped in the Rust port | Why review passed it | Caught by |
| --- | --- | --- |
| `pick_x` / `pick_x_in_segment` walked every unit and built a `Vec` for each spawned person | the walk sat in a helper; the per-person loop was in another file | HP-1, HP-2, HP-3 |
| `room_units()` filtered every unit on each call, while TypeScript `roomUnits` had been cached since #852 | same algorithm as the TypeScript, minus the cache | HP-8, HP-2 |
| `noise_afflicted` was recomputed per room and per probe; the Rust comment said the TypeScript cache "is pure" | the comment was read as a reason | HP-8 |
| `max_staff_for` counted housekeeping units over every unit per staff spawn; TypeScript `staffCeiling` (#469) already ruled that out | a Rust iterator chain, while the old rule named only TypeScript idioms | HP-2, HP-8 |
| route search built SipHash maps on every call | hashing and allocation, which the old rule never mentioned | HP-3, HP-5 |
| `seg_reachable` ran a route search from every lobby segment for each room in a pass | inherited from the TypeScript, which has no cache either (#849) | HP-7, HP-9 |
| cached sets cloned on every read (#859), deferred at P3 | "parity unaffected", with no measurement | HP-3, section 7 |

## 9. How the review tools apply it

- **`/gds-code-review` and `/bmad-code-review`** load this page through the
  team overrides `_bmad/custom/gds-code-review.toml` and
  `_bmad/custom/bmad-code-review.toml`. When the diff touches a section 1
  surface they run a fourth layer, the Hot-Path Auditor, beside Blind Hunter,
  Edge Case Hunter and Acceptance Auditor. It gets the diff and read access to
  the repository, because HP-1 cannot be done from the diff alone. Triage
  follows section 7.
- **Copilot** applies the same items inline, as the Performance dimension of
  `.github/copilot-instructions.md`, and prints the section 6 table.
- **An independent reviewer** (a separate agent or person giving GO,
  CONDITIONAL GO or NO-GO) applies the checklist to the final commit and
  includes the table in the verdict. GO needs every row filled and every
  finding fixed or deferred under section 7.
- **`.github/skills/engine-parity-review/SKILL.md`** item 11 points here for
  changes on the engine seam.

The Hot-Path Auditor's prompt:

> You are the Hot-Path Auditor. You have the diff and read access to the
> repository. Apply `docs/performance/hot-path-review.md`, items HP-1 to HP-12,
> to this change. For each changed, added or ported function, trace its callers
> in both engines (`engine-rs/src/` and `src/engine/`) up to an entry point in
> section 2 and record the tier and the loops in between. Flag whole-collection
> work, allocations, clones, sorts, hashing and id scans under a multiplier,
> including inside helpers the diff calls but does not change. For ported code,
> list the TypeScript caches for the same function and its callees and check
> that each was carried over. For each finding give the location, entry point
> and tier, collection sizes from section 2, estimated complexity, the
> TypeScript equivalent, the proposed remedy, and any risk to results or cache
> invalidation (HP-10). Report pre-existing code too, marked pre-existing.
> Output the section 6 table with a row for every item, then the findings as a
> Markdown list.
