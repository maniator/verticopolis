# Perf audit: party findings, 2026-11-17

Room: Engine Room (bmad-party-mode, session mode), with Theo from the Web Game Room.

Question from Naftali: "After all current open PRs are merged, let's do a perf and speed audit and take it to a party roundtable and see what we can fix or update." Later: "Let's fix all the slow first with the perf checks."

Facts on the table are in the audit's findings (`/mnt/project-files/perf-audit-2026-11/findings.md`, a snapshot taken 2026-11-17). Compared with v4.0.0, every tower is faster. Compared with v4.6.0, the Modern towers are slower: maxed Modern by 17% native, split-tower-4 by 14% and split tower by 8%. Classic is 33% faster. The cost arrived in four steps: 4.7.0 (resident riders), 4.9.0 (hotel guest riders, stairs), 4.10.1 (boarding direction) and 4.11.1 (the walk to the first shaft, #2415, +4%). Rendering, load, memory and saves are flat or better. Install size is 4.77 of 6 MiB.

## The round

⏱️ **Tess:** Pre-registering before anyone argues. The target is a maxed Modern day at or under 4.6.0's cost on the same box: 531 ms native, from 624. Each PR shows the seven-tower bench with an A/A pair, no tower slower beyond the A/A gap, and identical determinism hashes. If a PR moves `conformance/expected.json`, it isn't a perf PR.

🦀 **Ruth:** Then start where the money is. `expected_time::search` builds a fresh BinaryHeap and two Vecs on every call: 27,000 calls a day, and malloc and free are 9% of the run. Keep the scratch on the crowd, clear it, reuse it. Same pops in the same order, same answer, no behavior change.

😤 **Grumbal:** "Same order" is doing a lot of work in that sentence. A heap with a reused allocation pops the same if the comparator's total. Is it? Ties on cost?

🦀 **Ruth:** `Reverse<(i64, u32, u32, i64)>`. Every field is in the key, so it's total. Ties break on ids. I'll pin it with the hashes anyway.

🌶️ **Boundary:** And the walk search #2415 added runs a second Dijkstra per route just to price the walk to the first shaft. The walk from an x on a floor to a shaft's door depends on the floor's tiles and nothing else. That's a per-revision table, not a per-rider search.

🏗️ **Winston:** Which makes it fix one. It's the step that broke "nothing slower" this morning, it's the smallest diff, and it lands before anything else touches routing. Cache the walk costs per floor, keyed on the tower revision, the way `stopsOf` already is.

😤 **Grumbal:** Keyed on revision. Not on the clock. We've been burned (#338, a memo on the clock that only held while paused). Boundary, find me the write that changes walk cost without bumping the revision.

🌶️ **Boundary:** Stair and escalator speeds are mode constants. A blocked floor during a fire? If walking ever reads fire state, the key misses it.

🦀 **Ruth:** Then fire goes in the key, or the cache refuses while a fire burns. I'd rather it refuse. Fires are rare.

🏢 **Kenji:** As long as nobody walks differently. Players noticed the walk-to-shaft change in a good way; Modern riders stopped picking the far bank. Keep that.

📈 **Anika:** Second biggest: the staff BFS. 6,600 calls a day, about 61,000 instructions each, for routes that depend only on topology. Same revision-keyed cache. And the eviction probe: 5,550 probes at 92,000 instructions each, and it hasn't moved since 4.0. That's 11% of a Modern day spent asking "would this tenant leave?"

😤 **Grumbal:** The probe is the one that pages someone. It reads nightclub hours, trash, parking and the demand share, and that state changes inside the hourly pass. Memoize it wrong and a tenant moves in who should have been refused. That's a gameplay bug that looks like a perf win.

🗂️ **Vera:** And it changes what the save carries, because move-ins are saved state. If the probe goes in, it goes in last, with a test that runs a whole hourly pass both ways and compares every decision.

⏱️ **Tess:** Agreed: probe last, with a decision-for-decision test. Hasher swaps and allocation trims in between, but only where the profile shows them.

🕸️ **Theo:** From the browser side: draw isn't the problem, it's level with 4.6. The odd one is split-tower-4 drawing 21 ms paused against 5 for the maxed towers. That's a render bug hiding as a tower, and it's cheap to look at. Separate from the engine queue.

🏛️ **Cloud Dragonborn:** And install size? 80% of budget, growing 0.3 MiB in three days.

🕸️ **Theo:** It's a watch, not a fix today. The name section is Naftali's call and the party settled it Saturday. The bundle grew 28%; that's a separate audit.

😤 **Grumbal:** Load at 350 ms in the browser on a maxed tower. Nobody's touching that?

🦀 **Ruth:** Not in this pass. Streaming deserialize is a week, not a PR, and load didn't regress. Backlog row.

🕹️ **Link Freeman:** One tooling thing so the next audit isn't a patch job: `cargo test --release` doesn't build on 4.11 because `FloorIndex::agrees` is debug-only and tests call it. Gate it on `any(test, debug_assertions)`. One line.

⏱️ **Tess:** And the busy-meter PR's 1.4% gets benched like everything else before it lands. No exceptions because it's small.

## Vote on the order

1. **Walk-cost cache for #2415's `search_from`** (per floor, keyed on the revision; refuses during a fire unless fire state is in the key). All 11 for.
2. **Scratch reuse in `expected_time::search`** (heap and buffers kept on the crowd). All 11 for.
3. **Staff route cache** (`staff_route` / `bfs_route_in`, revision-keyed). 10 for; Grumbal for it only with a test that edits the tower mid-day.
4. **Allocation and hasher trims** where the profile shows them. 9 for; Kenji and Cloud abstained.
5. **Eviction probe** (`would_evict_fresh_tenant`), last, with a test comparing every move-in decision over a pass. 8 for; Grumbal and Vera for it only after 1 to 4 have landed; Boundary against this round.
6. **`cargo test --release` build fix** (`FloorIndex::agrees`). All for. It rides in with fix 1.
7. **Split-tower-4 draw investigation** (render, separate thread). All for.

Deferred to the backlog: streaming load (Ruth, Grumbal); bundle growth audit (Theo); install-size watch (no action; the name section stays per 2026-11-15).

## Verdict

Fix the Modern sim cost back to 4.6.0's level or better, in the order above, as small separate PRs. Each one carries:

- the seven-tower native bench and WASM bench, with an A/A pair;
- no tower slower than main beyond the A/A gap;
- unchanged determinism hashes and conformance;
- the hot-path record;
- `/gds-code-review`;
- an independent review from another thread.

The eviction probe goes last and only with a decision-for-decision test. Pending engine PRs (#2417, #2425, and #2423 if it touches the engine) show the same bench before they merge.

## After the round

Reading the code changed the order. `expected_walk.rs` already keeps each start's walk spots per revision, and `search` already reuses its heap and buffers. So items 1 and 2 as voted already exist. #2415's 4% comes from the kept-route key now holding the rider's tile, which means more searches, and from the walk widening the A* search. Item 3, the staff route cache, went first because it is behavior-neutral and the biggest clean win: 9.6% fewer instructions in a maxed Modern day, with identical save digests. Cutting #2415's extra searches comes next, with the same evidence bar.
