# Party transcript: 3.0 web release planning (2026-10-20)

> **Record of the 2026-10-20 Phase 2 planning party, kept as said, with the
> factual slips the adversarial review found corrected in place and listed at
> the end.** Every figure quoted here is a snapshot and none of it is release
> evidence. The performance figures are historical runs under
> `docs/performance/results/`: the desktop runs `2026-10-15-e25ec01c-worker-1280x720/`
> and `2026-10-15-e25ec01-worker/` (commit `e25ec01`, app 2.34.1), and the
> container runs `2026-10-14-c80416c-worker/` and `2026-10-14-01c6153/`. Live
> figures come from re-running `npm run perf:worker` and `npm run perf:compare`
> under the protocol in the plan. The session figures (749 sessions in 30 days,
> median 132 s) are the governed `session_lengths` view as recorded on
> 2026-10-13 in `analytics-readout-party-findings-2026-10-13.md`; the live
> numbers are that view and the **Verticopolis: Gameplay Analytics** dashboard.
> The plan this party produced, revised after the review, is
> `_bmad-output/planning-artifacts/release-3.0-web-plan-2026-10-20.md`; where the
> two differ, the plan is the later word.

Room: Cross-Cutting Plan Review. 📋 John (PM), 🏗️ Winston (architect), 🏛️
Cloud Dragonborn (game architect), 🎨 Sally (UX), 🎲 Samus Shepard (game
designer), 🔒 Vex (security), 🛡️ Noor (privacy), 📈 Anika (data scientist), 💻
Amelia (dev), 🕹️ Link Freeman (game dev), 😤 Grumbal (adversary), 🌶️ Boundary
(edge cases). Specialists pulled in: 🦀 Ruth (Rust), 🗂️ Vera (save fidelity),
⏱️ Tess (performance and conformance QA), 🕸️ Theo (web platform), ⚙️ Hank
(build and CI), 🏢 Kenji (1994 veteran), 🚢 Dana (pragmatist), 🧰 Oona
(maintainer), 🎧 Saoirse (audio). Walk-on: 📚 Paige (tech writer). Session
mode.

On the table: the 2026-10-20 takeover inventory and the local Codex worktree
audit (project working notes, summarized in section 2 of the plan), the eight
recovered patches and their checksum manifest, the cutover plan (`rust-wasm-web-cutover-plan-2026-10.md`), #945 and the
owner's 2026-10-16 execution order on it, and `main` at `8f3a143` (2.35.0).
The owner, Naftali, set D1 to D6 that morning and asked the room to decide D1.

---

## Round 1: which clock is longest

🏗️ **Winston:** Two gate rows run on a calendar instead of a commit. Seeded replay needs 14 nights. Reliability needs a whole release. Everything else passes on the candidate the day it's built. So the plan is about those two clocks, and the rest is filler around them.

📈 **Anika:** Then read the Reliability row out loud, because I don't think it can pass as written.

📋 **John:** "Over at least 1,000 consenting engine sessions in the TypeScript-default release: engine fallback under 0.1%, no engine-writer latch-off, every divergence report triaged."

📈 **Anika:** "Engine sessions in the TypeScript-default release." `engineChoice.ts` defaults to `ts`. The only way to get an engine session is `?engine=wasm` or `vc.engine` in local storage. That population is the people in this room.

😤 **Grumbal:** So the gate asks for a thousand sessions from a build where the engine is switched off. Lovely. It's a smoke detector in a house with no stove.

📈 **Anika:** And it gets worse. Say we had the sessions. Zero fallbacks in 1,000 trials gives a 95% upper bound of about 3 in 1,000. That's 0.3%. You cannot show "under 0.1%" from 1,000 sessions, even with a perfect run. You need about 3,000 clean sessions for that bound, and about 4,750 if a single fallback shows up.

🛡️ **Noor:** And today we couldn't count them anyway. Where does the engine kind end up? Nowhere. No analytics field records which engine ran, whether it fell back, or why.

🕹️ **Link Freeman:** Confirmed. `engineBoot.ts` records a boot fallback reason on the host status, and that's where it stops. Runtime fallback doesn't exist yet. That's #874.

📋 **John:** What's our traffic?

📈 **Anika:** The governed view said 749 sessions in 30 days, as of the 13th. That's a snapshot. If every one of them ran the engine, 1,000 sessions is about six weeks. At half, close to three months.

🚢 **Dana:** So Reliability sets the release date.

🏗️ **Winston:** Which is why the owner said front-load it. Fine. What do we need before the clock can even start?

📈 **Anika:** Three things. A signal that counts engine sessions and fallbacks. A population that runs the engine. And a pass rule the traffic can actually meet.

🛡️ **Noor:** Four. A data map entry before the field ships. Engine kind as an enum, fallback reason as an enum, latch-off as a flag. No raw error text, because an engine message can carry a tower name or a file path. Same posture as every other field: no cookie, no identifier.

🔒 **Vex:** And the reason codes come from a closed list in our code. The panic string stays on the device. A panic message is attacker-controlled the moment someone hand-edits a save.

😤 **Grumbal:** The population is the real fight. Who runs the engine before the flip? Say it.

📈 **Anika:** A randomized cohort. A 2.x release where a random half of devices get the WASM default, with automatic fallback to TypeScript. The draw lives in local storage and only the arm label goes out. Then I have a control group. Fallback rate, and I can compare session lengths by arm on the governed view instead of guessing.

🎨 **Sally:** Before S6 lands? The shipping host is the main-thread `wasm` host. Large tower, 1x: frame p99 141 ms against 15.5, 1% low 6.75 FPS against 48.7. You'd be shipping the stutter to half the players.

📈 **Anika:** The governed median session was 132 seconds on the 13th. Most of those players never build a tower big enough to feel the hourly merge.

😤 **Grumbal:** And the ones who do are your most loyal players. You'd be running the experiment on the people who'd write the angry post.

🚢 **Dana:** Then size-gate it. A save over some unit count boots on TypeScript and gets tagged "size-gated" and never counts as a fallback. Small towers run the engine. When S6 lands, drop the gate.

🌶️ **Boundary:** Boot-time only. If the gate flips mid-session when the tower grows, you've invented a third engine switch. Decide at load, record it, never re-decide.

🏗️ **Winston:** And none of this runs before #874. A cohort without runtime fallback means a trap kills the game for a real player. S4 is the gate on the gate.

😤 **Grumbal:** One more. Sessions on today's engine path aren't evidence for the 3.0 engine. Today the instance answers every command and the engine only ticks. After S9 the engine answers. Different trap sites.

🚢 **Dana:** The risky parts for fallback are boot, the package, and tick traps. Today's build exercises all three.

😤 **Grumbal:** And not the command path, which is the part S9 rewrites.

📋 **John:** So we don't settle that here. The cohort starts when S4 ships. Every session carries its build, so the owner can see how many ran on an engine that answers commands. Naftali decides how many of those to require.

📈 **Anika:** And the owner restates the threshold. We don't. Either "zero unexplained fallbacks, report the upper bound", or the owner buys the traffic for 0.1%. I'll write both bounds into the plan so the owner can see the price.

🛡️ **Noor:** A cohort is a default-engine change for real players. That's the owner's call too. We propose; the owner flips.

## Round 2: what the nightly fuzzer actually proves

⏱️ **Tess:** Second clock. The row says: "nightly fuzzer plus a seeded random-command differential comparing full saves, money, logs and gameplay events each hour; failing seeds kept and shrunk; no divergence over 14 nights." `engine-fuzz` is green 12 of 12. Show me the trace of what it compares.

🦀 **Ruth:** I read `engine-rs/src/bin/fuzz.rs`. Twenty seeds a night, 40 commands each. It grows the scenario on the Rust engine and keeps only commands Rust accepts; a refused build stays as `expectFail`. It starts with `setMoney 500000000`. Towers are 3 to 9 floors on an 80-tile lot. Then `scripts/fuzz-compare.ts` replays on TypeScript and compares two hashes per checkpoint: state and crowd.

⏱️ **Tess:** No save bytes. No log. No gameplay events. No hourly cadence; checkpoints are a quarter of each tick run. No shrinking, it just writes the failed scenario. And no corpus replayed on pull requests.

😤 **Grumbal:** Half a billion dollars and nine floors. The fuzzer is a rich kid in a small house. The economy never bites and the elevators never queue.

🏢 **Kenji:** That's where the 1994 game lived, though. Money ran out, the fourth-star gates said no, the express shafts jammed at five o'clock. A differential that never refuses for money never tests the rule players actually hit.

🌶️ **Boundary:** And look at what happens to a refusal. A refused build keeps its `expectFail`, so TypeScript accepting it fails the compare. But a refused `sell`, `adjustRent`, `setCars`, `setNoRate`, `setSchedule` or `startFire` is just dropped. On those six, a command Rust refuses and TypeScript would accept never gets compared. That's #1064, inside the fuzzer.

⏱️ **Tess:** So the instrument the row names doesn't exist yet. The nightly is the floor. The upgrade: an hourly compare of the full save bytes, money, the log and the drained gameplay events. Mixed money, including starting cash and bankruptcy. Taller towers. Commands both engines refuse, with reasons once #865 pins them. Shrinking. A failing-seed corpus that every engine PR replays.

⚙️ **Hank:** Runtime check. Twenty seeds by 40 commands fits its 60-minute box today. Hourly save compares on taller towers will not. Split it: a fixed corpus on PRs, under ten minutes, and the nightly grows.

🏗️ **Winston:** Now the window rule, because "14 nights" means nothing until we say what resets it.

⏱️ **Tess:** Any red night. Any change to the simulation sources of either engine. Any change to the differential itself.

🦀 **Ruth:** Define "simulation sources" or every story resets it. S6, S9 and S17 all add exports to `engine-rs/src/wasm.rs`. The fuzzer runs the native binary. It never loads the binding.

⏱️ **Tess:** Then the key is a hash of `engine-rs/src` without `wasm.rs` and `bin/`, plus `Cargo.lock`, plus `src/engine` without its tests. The binding is covered by the WASM conformance suite on the candidate commit.

🦀 **Ruth:** And here's the one nobody's said. Every Rust performance PR changes those sources. #859, #1051. Same digests, different code. Each one restarts the clock.

⏱️ **Tess:** Correct. Performance work in the engine lands before the window, or the window waits.

🚢 **Dana:** So the engine freezes for 14 nights. Main keeps moving on everything else.

⚙️ **Hank:** Or the nightly runs against a declared candidate ref, and main never freezes.

🧰 **Oona:** A second long-lived line is a second set of fixes to port. Who maintains that for 14 days, the same tired person?

⚙️ **Hank:** It's 14 days. Nobody's maintaining it for a year.

🧰 **Oona:** That's what they said about the last one.

🏗️ **Winston:** Freeze on main is the default. A candidate ref is the fallback if the freeze blocks something the owner wants. Recorded as a split.

📈 **Anika:** And run a rehearsal window now, the night the upgrade lands. It doesn't count. It finds the harness flakes and the real divergences while we can still fix them cheaply.

## Round 3: 702 against 1,640, and what a player feels

⏱️ **Tess:** Performance. Two numbers for the same thing. TypeScript bare step on the large tower: 702 ms for 720 steps in the e25ec01 desktop run, interval 670 to 734. The #1051 thread said 1,640, from a local run nobody pushed. Neither counts.

🕸️ **Theo:** And more than two. The 10-14 container runs: on `01c6153` large bare was 1.08x, inconclusive; on `c80416c`, a four-CPU Xeon, TypeScript took 1,985 ms and WASM 2,902. The "1,990" in #1045's backlog row is that run's hosted TypeScript figure, sitting beside 1,985 bare. Different machine, different everything. Don't put it in the same table.

📈 **Anika:** Put them in the same table, labeled by machine, so everyone can see why they differ. Same desktop, same commit, two viewports: 702 [670, 734] and 705 [694, 733]. That's a reproduction already. Every conclusive run says WASM is slower bare on the large tower, by about 1.15x to 1.43x paired, and the `perf:compare` run is inconclusive at 1x. The only number that says otherwise is the 1,640 against 173, and it has no command line and no raw samples.

🦀 **Ruth:** Look at the shape of the 702, though. TypeScript medium is 690 ms. Large is 702. The large tower has five times the people and 3.6 times the units, and TypeScript barely notices? Rust goes 387 to 830. Either TypeScript has a cache we don't, or the large bench isn't doing what we think.

🕹️ **Link Freeman:** #1051 says exactly that: confirm the flat curve before chasing the gap. Could be a memoized set the TypeScript side keeps and Rust clones. That's #859.

⏱️ **Tess:** Hypotheses are free. Here's the protocol. Same machine, the owner's desktop, on AC power, performance power plan, nothing else running. Production build from the candidate SHA, engine source hash recorded and checked against the hash of the same commit computed from git. Both engines from the same commit, ten repetitions in fresh browser processes, order rotated, 1x and 4x. Paired ratios with the order-statistic interval. Raw samples committed with a snapshot header.

🕸️ **Theo:** And step zero is the reconciliation: re-run the e25ec01 harness on e25ec01 on that machine. If 702 reproduces inside its interval, that's the desktop baseline. The 1,640 is discarded either way: it has no provenance. #1048 already asks for that reproduction in its acceptance.

⚙️ **Hank:** It can't run on `main` today. The Windows `cmd.exe` quoting fix for the perf build is sitting in `perf-worker-1068.patch`, inside a PR the owner put on hold. Split it out. Its own PR on main, so the protocol runs against main and #1068 keeps only its delta.

🗂️ **Vera:** And the hash. #880: on a Windows checkout with CRLF, the engine source hash differs from Linux. The local audit found CRLF files in the Codex worktrees. If the PC's `BUILD.json` source hash doesn't match CI's for the same commit, you can't prove the PC measured the bytes that ship.

⏱️ **Tess:** So #880 rides with the harness split. Good catch.

🎨 **Sally:** Now what we gate on, because bare engine time is not what a player feels. The shipping host is `wasm` on the main thread. Large, 1x: main-thread time 6,784 ms per 720 steps against 692. Long tasks past 50 ms: 2,833 ms against zero. That's the stutter.

🏛️ **Cloud Dragonborn:** And part of it is the same disease the read-model party found on the worker: the hourly full-save merge. The rest is the per-step sync. The `wasm-frame` host drops the sync and still takes 4,519. The worker hides both better, at 2,585. S6 has to cure both for the host that actually ships. That makes S6 a performance story as much as a read-model one.

🕹️ **Link Freeman:** And #1068's `saveDelta` is Rust code next to `serialize`. The read-model party said put it where all three hosts can use it. If the protocol shows it closes the main-thread gap, it belongs in S6. It stops being a post-flip toy.

😤 **Grumbal:** The owner held #1068 for evidence. Don't sneak it in as "an input".

🕹️ **Link Freeman:** The hold stands. Evidence first, then it merges or it doesn't.

⏱️ **Tess:** One more row nobody wants to read. Memory. Large, 1x: JS heaps plus WASM memory 202.7 MiB against 74.5. That's 2.72x. The gate says 1.25x.

🦀 **Ruth:** Linear memory never shrinks. The high-water mark is set by the biggest thing we ever build in it, and the hourly serialize builds a 4.49 MiB string in there. I'd bet the merge is the memory problem too. That's a bet. Nobody's measured it.

⏱️ **Tess:** Then the protocol records peak WASM memory per phase, and S6 is measured on memory as well as time.

📈 **Anika:** And the pass rule gets written before the run. The Codex checkpoint quoted an owner no-regression criterion and warned against using the report's 5% band for it. "Match or beat" needs a margin. Show that the ratio's interval sits inside the margin, or under 1.0 for "beat". A margin of zero means two identical engines can never pass.

🚢 **Dana:** So Naftali picks the margin.

📈 **Anika:** Before the run. Picking it after is how a readout ends up wrong.

## Round 4: authority, fallback, saves, sound

💻 **Amelia:** Authority. `wasmHost.ts` on `main` still imports `relayCommands` from `../dualrun/mirror`. The instance answers every command. The finished S9 work never reached GitHub. We start over from the story.

😤 **Grumbal:** And the three issues filed from that lost work. #1064, #1065, #1066. The owner says required by default unless architecture documents an exception. Architecture, document one or don't.

🏗️ **Winston:** I won't. #1066 is AD-8 itself: a restore boots the engine from bytes the engine read. On `main` every load boots from the instance's re-serialization. After S9, an unstamped save and a `.TDT` import still would. Leaving it means the TypeScript engine authors the engine's starting state on two load paths. That's authority leaking through the loader.

🗂️ **Vera:** The founder mark is the easy half. The `.TDT` path needs the engine's own importer, and TDT through the engine on the web is listed after the flip. So #1066 pulls part of that forward.

🏗️ **Winston:** Then it pulls it forward. The other choice is to say AD-8 holds except for imports, and then it's not an invariant.

🕹️ **Link Freeman:** S4's acceptance already reports one direction: a command the instance accepted and the engine refused. #1064 is the other direction, once S9 makes the engine answer first. #1065 is S9's "a disagreement is reported", made deep enough to see a different placement at the same price. All three stay required. No exceptions.

🌶️ **Boundary:** #1065 cheaply, though. A full state view per click on a paused game is a stall. The issue already says it: tower revision, unit and transport counts, a layout hash.

🏢 **Kenji:** And pin the refusal reasons first, #865. A player who's refused a fourth-star facility in 1994 got a reason. If the engine and the instance refuse for different reasons, the player reads the wrong one, and nobody's test notices because both said no.

🎧 **Saoirse:** Can I ask the question nobody's asked about S9? What happens to the sound? `frameLoop.ts` plays the promotion cue by polling `sim.star` on the mirror. Under the engine host the mirror learns the star at the merge. So the cue plays when the merge lands, which today is the top of the hour. A cue that arrives late is a wrong cue.

🏛️ **Cloud Dragonborn:** And when S6 replaces the hourly merge, the timing moves again.

🎧 **Saoirse:** So S6 and S9 each get an audio test on `chromium-wasm`: the cue plays within a frame of the engine's event. If the poll can't do that, #965 moves the cues onto engine events, and it stops being a P2 nice-to-have.

🎲 **Samus Shepard:** That's a feel bug players would absolutely notice. The promotion jingle is the best moment in the game. Let's not make it late!

🗂️ **Vera:** Saves. The Saves row wants every fixture and the loader table byte for byte through the engine, and the 32 MiB cap and the Unicode cases failing the same way in both. The inventory couldn't verify those cases. That's an audit task for the test-parity workstream. Nobody gets to believe it.

🗂️ **Vera:** And #902 adds booked room ids to the save as an optional field. An engine build from before it loses an in-flight booking on rollback. The plan already says the exception register notes it. Keep that line.

## Round 5: which build ships, and can we take it back

🕸️ **Theo:** There's a contradiction in the repo. CONTRIBUTING says `VC_ENGINE=wasm npm run build` makes "the wasm-only build the 3.0.0 flip will deploy": `?engine=` ignored, no TypeScript loop, an engine that can't start stops the game. AD-7 says the flip keeps the fallback. The Rollback row says a rehearsal "flips the default back with the flag". And the owner's #874 note says fallback is for switchable builds only, strict builds fail explicitly.

😤 **Grumbal:** So if we follow CONTRIBUTING, the Rollback row is impossible, because the flag it flips is ignored.

🏗️ **Winston:** 3.0.0 ships the switchable build with WASM as the default. The strict build is retirement, after two releases on WASM, and needs its own approval. CONTRIBUTING's line gets corrected in the flip PR. That's the owner's to confirm, but I don't see a second reading that keeps AD-7 and the Rollback row alive.

🚢 **Dana:** Agreed, and it matches what the owner said this morning: keep the fallback until removal is explicitly approved.

🔒 **Vex:** Deployment. `scripts/vercel-build.sh` builds the package from source on every deploy, good. But `/engine/*` has no explicit `Cache-Control`, and the file names aren't content-hashed. `version.json` is no-store and `sw.js` revalidates on every load. So a first visit, or an install that overlaps a deploy, can still pair a shell with another build's engine. That's #985 criterion 5, the check at boot.

🕸️ **Theo:** And it's the half of #985 whose implementation was lost. Criteria 1 to 4 and 6 are on main. 5 has only its design, #1047, plus an unpushed repair commit. 7 is still open. Push the design repair to #1047 now so the owner can approve it while we work.

🌶️ **Boundary:** Rollback rehearsal, concretely. Deploy a build whose default is `ts`, open a tower saved by the engine writer, play an hour, save, reload. Then the other direction. And a tower mid-exterminator-booking, because that's the one case we already know loses data.

⚙️ **Hank:** Scripted, in a checklist on #945, with the commands and the result. "We rehearsed" in a chat is not a rehearsal.

## Round 6: D1, the rendering stack

📋 **John:** D1. #817, #831, #1039: service sprites, every occupant drawn, room detail seeds. 2.35.1, 2.35.2, 2.35.3. The owner leans toward us taking them over and asked this room to decide.

🚢 **Dana:** Take them. They're three nearly done PRs. #817's status is green, the gallery was approved on the 15th. Finish them and the version numbers stop being a queue.

😤 **Grumbal:** "Nearly done." #817's last Copilot review was on the 15th, and every attempt since errored. #1039 conflicts with its own base. Bots have been committing visual baselines to them since the 19th.

⚙️ **Hank:** Which is the cost of leaving them open. Every day they sit, the baseline bot chews on them and the stack drifts further from main.

🧰 **Oona:** Every open PR is a small tax paid daily. Three stacked ones is a mortgage.

🎨 **Sally:** And they matter to players even if they don't matter to the gate. Drawing every occupant is the kind of thing people screenshot.

🏗️ **Winston:** Gate relevance is zero. None of them touch a #945 row. File overlap with the critical path is near zero too: `src/render` and sprites against `src/wasmhost`, `engine-rs` and tests.

🕸️ **Theo:** Near zero still costs something. The screenshot gallery is a hard gate. Every pixel change reflows the gallery, and S7 and S17 change UI. If the stack lands after them, the gallery refreshes twice and every UI PR rebases on new baselines.

📋 **John:** And the version bumps. Each player-facing PR bumps `package.json` and the lockfile in step. Three in a stack plus the critical path means a conflict on the version every merge.

🚢 **Dana:** Bump at the last moment. Whoever gets there first takes the next free number. It's a two-line conflict and nothing more.

😤 **Grumbal:** The real cost is the thread budget. Two implementation threads. If one of them is drawing tenants, the reliability clock waits.

📋 **John:** Then it's not one of the two. Verdict: take it over, as a third lane that doesn't touch a critical-path slot. It starts when the coordinator opens a third thread, after the first two have posted their plans. One owner for the whole stack, in stack order, versions taken at merge. It aims to land before the first S7 or S17 UI change needs a gallery refresh. If it can't, it parks behind them instead of racing them.

😤 **Grumbal:** And if it slips past that, it waits. No "just one more baseline".

## Round 7: labels, the live matrix, and why the work went missing

📋 **John:** D6. Release requirements win over labels. The plan already calls #874, #868, #867 "P1 for the flip" while GitHub says P2. The rule: an issue is P1 if a #945 row names it, a story a row needs depends on it, or D5 put it there.

🕹️ **Link Freeman:** By that rule: #874, #902, #868, #867, #865, #900, #926, #932, #1064, #1065, #1066 go to P1. And #1051, because the Performance row needs bare tick parity and the last desktop run shows a gap. #1048 with it, since #1051 measures through it.

😤 **Grumbal:** #1048 is tooling.

📈 **Anika:** Tooling the gate measures through. If it's wrong, the verdict is wrong.

⏱️ **Tess:** #880 to P2, for the Windows hash. The protocol's provenance depends on it, even though no gate row names it.

📋 **John:** S12 and S14 stay where they are. The cutover plan already says they go to the exception register if open. #893 is the owner's: it's labeled P1 for a crate release the plan puts after the flip.

😤 **Grumbal:** And the titles. #1064 says "[P2]" in its title. Once the row says P1, the title says P2 and the label says P1. Three copies of one fact means one is wrong by Friday.

📋 **John:** Drop the prefixes when the rows land.

💻 **Amelia:** Here's what bothers me more. Those rows don't exist on main. The issues name backlog rows, `wasm-host-silent-refusal`, `engine-rs-step-gap`, and the rows aren't there. Twelve issues with no row, half of them on the 3.0 path. They went down with the unpushed branches.

😤 **Grumbal:** Say the pattern out loud. #954, #963, the #985 implementation, and the #1051 profiling, if it was ever real. Four pieces of work, all lost the same way: done locally, never pushed, session died.

🚢 **Dana:** Rule for every thread from now on: draft PR at the first commit, push at every green step. A thread that dies leaves a branch.

📚 **Paige:** And the matrix. The owner wants it on GitHub and current. A repo file goes stale the hour it merges, because updating it takes a PR. A Projects board is good at status and bad at reasons.

📋 **John:** So?

📚 **Paige:** A tracking issue, a sub-issue of #945. Its body is the matrix, one table, edited in place at each milestone by whichever thread moved a row. The repo file is the dated snapshot that says "live copy is #NNN" in its first line.

😤 **Grumbal:** Two copies.

📚 **Paige:** One live, one labeled as dead. That's a snapshot, the same rule CLAUDE.md already has for readouts.

## Round 8: who goes first

🏗️ **Winston:** Two workstreams, no shared files at the same time. The owner's caution from the 16th: stagger anything touching `wasmHost.ts`, `startWasmHost.ts`, worker sync and the perf harness.

💻 **Amelia:** WS-A, engine authority and fallback. In order: the reliability instrument (S16's fallback-use signal, Noor's data map, the governed definition); #902 from `wasm-authority.patch`; #874 runtime fallback with #1059's last-error fix; then #868 with the structural snapshot; then #954 with #1064, #1065, #1066 and #1067.

🕹️ **Link Freeman:** WS-B, evidence. Take over #1062 first, it's the closest to done: merge main, tier `commuteStress`, apply `wasm-conformance.patch`, both reviews. Then the harness split with #880 and the protocol doc, so the PC can run. Then #1068's CI repair, still on hold. Then the differential upgrade and the rehearsal window. Then #867, the step driver, and #865.

🌶️ **Boundary:** #1062's patch touches `wasmHost.ts` and `wasm.rs`. So does #874.

💻 **Amelia:** Which is why WS-A opens with the instrument and #902. Neither touches `wasmHost.ts`. #902's patch does share the parity setup files with #1062, so #1062 merges first. By the time I reach #874, #1062 should be merged. If it isn't, I wait or rebase, and the file table in the matrix says who holds what.

😤 **Grumbal:** Pre-mortem. It's six weeks from now and 3.0 slipped. Why?

📈 **Anika:** The cohort started late because S4 took longer than planned, and the reliability count is the release date.

🦀 **Ruth:** A Rust perf fix landed during the freeze and reset the 14 nights.

🗂️ **Vera:** #1066 dragged the TDT importer forward and nobody budgeted it.

⏱️ **Tess:** The PC run happened once, on the wrong commit, and the gate verdict was "inconclusive" with no time left to re-run.

🎧 **Saoirse:** The promotion cue went quiet under the engine and a player found it before we did.

😤 **Grumbal:** And a thread finished something and didn't push it. Again.

🏗️ **Winston:** Every one of those gets a row in the risk register. That's the plan.

## Converged

- **The longest clock is Reliability, and it can't start as things stand.** The TypeScript default produces no engine sessions, no analytics field records the engine or a fallback, and 1,000 clean sessions can only show an upper bound of about 0.3%. The instrument ships first (WS-A). The population (a randomized 2.x cohort with automatic fallback, starting no earlier than S4) and the restated threshold are the owner's decisions.
- **The 14-night window needs a real differential and a reset rule.** Upgrade the fuzzer to compare hourly save bytes, money, log and events, with mixed money, taller towers, mutual refusals, shrinking and a PR corpus. The window is keyed to a hash of the simulation sources of both engines (binding and fuzzer excluded) and resets on any red night or change. Engine-semantic and engine-performance work lands before the window. Run a rehearsal window as soon as the upgrade lands.
- **Performance is decided by a pre-registered PC protocol,** with step zero reproducing the e25ec01 figures on e25ec01. No historical figure counts. Gate on what players feel (hosted main-thread time, long tasks, frame p99 and 1% low, memory, cold start) as well as bare tick time. S6 is a performance story for the host that ships. The owner sets the equivalence margin before the run.
- **D5: no exceptions.** #1064, #1065 and #1066 are required. #1066 is AD-8.
- **Recommended: 3.0.0 ships the switchable build with WASM as the default** (OD-5, the owner's to confirm). The strict build waits for retirement. CONTRIBUTING's line is corrected in the flip PR.
- **D1: take over the rendering stack** as a third lane outside the two critical-path slots, in stack order, versions at merge, landing before the first S7 or S17 gallery refresh or parking behind them.
- **D6:** the P1 set above, #880 to P2, title prefixes dropped, the 12 missing rows restored. #893 is the owner's.
- **Process:** draft PR at the first commit and a push at every green step; the live matrix is a tracking issue under #945; each thread posts a takeover note on stale claims (D3).

## Still split

- Freeze `main` for 14 nights (Winston, Tess, Oona) or run the window against a candidate ref (Hank). Freeze is the default.
- Whether sessions on a pre-S9 build count toward Reliability (Dana yes, Grumbal no). Left to the owner, with sessions reported by build.
- Whether the cohort needs a size gate before S6 (Dana, Sally for; Anika thinks small towers dominate anyway). Proposed as an option.

## Corrections after the adversarial review

The `/bmad-code-review` of the plan (2026-10-20) found factual slips in what
the room said. They are corrected in place above:

- The web game has no consent switch, so the room's consent wording in
  round 1 and the header is gone (John's quote of the gate row keeps it, as
  the row says it); the 749 figure is 749 sessions.
- The median session comes from the governed view (132 s on 2026-10-13); the
  room had said "about two minutes" with no source.
- The "1,990" in #1045's row is `c80416c`'s hosted TypeScript figure; 1,985
  is its bare figure.
- The historical gap is about 1.15x to 1.43x across the conclusive runs, and
  the `perf:compare` run is inconclusive at 1x.
- The protocol identifies a run by its engine source hash: the `.wasm` binary
  embeds the builder's paths, so it never matches across machines (#1079).
- The shipping host's cost is the per-step sync as well as the hourly merge.
- The fuzzer keeps a refused build as `expectFail`; only six commands are
  dropped uncompared.
- S4 reports an engine refusal of a command the instance accepted; #1064 is
  the opposite direction, after S9.
- On `main` every load boots the engine from the instance's
  re-serialization; #1066 covers the two paths S9 leaves.
- `sw.js` revalidates on every load; only `version.json` is `no-store`.
- #985 criterion 5 has a design (#1047); criterion 7 is still open.
- Of the twelve rowless issues, six were on the 3.0 path at the time; the
  third pass below adds #1048.
- #817's last Copilot review was on 2026-10-15 (at `a45c1c4`), and six later
  attempts errored; Grumbal had said August.

Some of what the room settled was changed by the review, and the plan
(section 14) is the later word:

- The replay key now covers the whole engine package, the binding included,
  plus the TypeScript side of the compare. A share of each night runs on the
  WASM build.
- The neutral-change exemption is gone.
- #1048 stays at P2; the shipping host's own cost split moved to the harness
  work (B3).
- The rendering stack starts after the performance and offline lanes in
  thread order. The D1 verdict itself stands.
- The differential moved to WS-B's third step, with #865 ahead of #867.
- Pushes batch once a review is requested, and the version bump moves to
  just before the final review.
- #1062 merges before #902, since they share the parity setup files.
- #1066's `.TDT` half meets the TDT story's own gate (#885, #886, #887,
  #920); OD-8 puts that to the owner, and the four become step A7.
- S6's design (Amelia's "structural snapshot") is the owner's choice between
  the engine-side "changed since last sent" contract and the versioned
  slices (OD-9).
- #1059 rises to P1, and #880 to P1 (Tess proposed P2).

A confirming pass on the revised plan changed a few more:

- The replay key leaves out the lockfile's version fields, so version bumps
  keep merging during the freeze; merges to the key's paths (Dependabot's
  included) wait.
- The reliability window counts sessions from every build since S4 and ends
  with a tail on the candidate engine, which a 2.x cohort release carries to
  players. Whether pre-S9 sessions count stays the owner's (OD-2); the plan
  recommends they do, reported by build.
- The catalog lane (WS-D) comes before the rendering stack in thread order;
  the stack may use a thread while WS-D waits for S6.

A third pass changed more:

- WS-A follows the owner's 2026-10-16 order on #945: #874 (with #1059) before
  #902, since both edit the same host and save paths. Amelia's order put #902
  first; #1062 still merges before both.
- #1048 rises to P1 after all, since the owner's order lists it before the
  flip with #1051 after it, which is close to Link Freeman's first call. Part
  of it landed in #1056.
- The candidate deploy is cut from a commit with the candidate engine and
  every host-path input merged; a later host-path change restarts the tail.
