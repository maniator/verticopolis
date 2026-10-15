# Party transcript: incremental read model (2026-10-15)

> **Record of the 2026-10-15 party, kept as said.** The save-shape and churn figures quoted below as a "scratch" measurement were one-off and are superseded by the governed rows in `docs/performance/results/2026-10-15-4c1a74a-read-model/` (`npm run perf:worker -- --read-model`); the design and its reasoning live in `docs/architecture/read-model-deltas.md`.

Room: 🏗️ Cloud Dragonborn (game architect), 🎮 Link Freeman (game dev), 🎨 Sally (UX, carrying the perf-feel brief). Session mode. Evidence on the table: `docs/performance/results/2026-10-15-e25ec01c-worker-1280x720/report.md` and its 640x360 twin (Ryzen 5 5600X, RTX 3060, commit e25ec01), `src/wasmhost/*`, `engine-rs/src/frame.rs`, plus a scratch measurement of the three scenario saves (TypeScript engine, not a harness row).

---

## Round 1: where the time goes

🏗️ **Cloud Dragonborn:** Before anyone says "deltas", read row 189. Main-thread merge time, large, 1x: 2207 ms of the worker host's 2585 ms total. Eighty-five percent. Small is 134 of 160, medium 647 of 803. Same ratio at every size. The frame view is not the problem. The hour merge is.

🎮 **Link Freeman:** 24 merges in 720 two-minute steps. That's one per in-game hour, because `workerCore.ts` sends the full save whenever `onHourRuns` moves. 2207 / 24 is about 92 ms a merge. And the scratch run says `Simulation.deserialize(JSON.parse(save))` alone is 103 ms on the large save in Node. So it's the parse plus deserialize, then `mergeById` walking all 43,358 units and rebuilding `byId`.

🎨 **Sally:** And here's what a player feels. The frames rows run at 120 sim minutes a second. That's an hour pass every half second. Large 1x: frame p99 89.5 ms on the worker host against 15.5 on TypeScript, 1% low 9.4 fps against 48.7. That's a stutter twice a second. Nobody reports "my merge is slow". They report "it judders when the tower gets big".

🏗️ **Cloud Dragonborn:** And the hosted rows don't even count the structured clone of that 4.49 MiB string. The limitations note says it runs on the main thread before the host sees the reply. The frames rows include it. So the real hitch is worse than 92 ms.

🎮 **Link Freeman:** Okay, but now the weird part. What's IN a 4.49 MiB save? I ran it. Units are 99.9% of the large save. And 40,083 of the 43,358 units are `floor` tiles.

🏗️ **Cloud Dragonborn:** ...Floor tiles.

🎮 **Link Freeman:** Floor tiles. Kind, floor, id, x. Static until the tower's revision moves. Over one hour pass on the large tower, 2,888 of 43,358 units changed (6.7%), and the changed keys were `occupants`, `satisfaction`, and `state` twice. Medium: 7 units changed out of 12,062. We ship the whole tower to say "these offices got happier".

🎨 **Sally:** Do the frame view next, because I bet it's the same joke.

🎮 **Link Freeman:** It is. Unit records are 6 numbers each. 43,358 × 6 × 8 bytes is 2.08 MB, 1.98 MiB. The measured frame view is 2.00 MiB. So the per-frame view is about 99% unit records, and 92% of those are floor tiles whose state never moves frame to frame. People and cars are a rounding error. Medium checks out too: 12,062 × 48 bytes is 565 KiB of 585.2.

🏗️ **Cloud Dragonborn:** So both channels are dominated by the same thing: re-sending state that did not change. That's the finding. Everything else is mechanism.

## Round 2: the candidate designs

🏗️ **Cloud Dragonborn:** Three shapes. One: a save delta, diffed against what the consumer last received, unit by unit and top-level key by key. Two: engine-tracked versioned slices, the "structural snapshot" #868 already asks for, with a typed hourly view for the mutable unit fields. Three: shared memory, the read model reading WASM memory directly.

🎨 **Sally:** Kill three first so it stops tempting people. The bench page is cross-origin isolated. Production is not. `wasm-worker-host.md` says so. A SharedArrayBuffer prototype would look great in exactly the one place the player isn't.

🏗️ **Cloud Dragonborn:** Agreed on the bench trap. And even with isolation, every panel and the renderer read TypeScript objects. Zero-copy bytes that nobody can read without a UI rewrite are not a win this year.

🎮 **Link Freeman:** Fine. Now two versus one. Two scares me. Versioned slices mean every write site in Rust has to bump the right slice. Miss one and the read model drifts silently. That's the `KEEP` set problem from #868 all over again, a field added to the save and nobody updates the list.

🏗️ **Cloud Dragonborn:** Which is why I like one. Diff against last-sent is correct by construction. You don't instrument writes, you compare outputs. The engine keeps what it last sent per unit and emits the units whose record differs. A missed field can't drift, because there is no field list.

🎮 **Link Freeman:** Where does the diff run? If it's in the worker in JavaScript, I need to parse the 4.5 MiB save in the worker to diff it. That's the 100 ms again, just moved.

🏗️ **Cloud Dragonborn:** Moved off the main thread, which is the whole point of the worker host. But no: put it in Rust. `engine.saveDelta()` next to `serialize()`. The main-thread hosts need it too, `wasm` and `wasm-frame` pay the same merge (6784 and 4519 ms hosted at large), and they have no worker to hide it in.

🎨 **Sally:** One engine call that all three WASM hosts use. I like that for parity. One code path, one test.

🎮 **Link Freeman:** Then the frame view gets the same trick. Per-unit last-sent record, emit only changed units. That's a fixed-width compare of six numbers for 43k units in Rust, sub-millisecond. People and cars I'd leave whole for now; they move every tick anyway.

🏗️ **Cloud Dragonborn:** Careful. People do move every tick, but dwelling people don't. Leave them whole in phase one, measure, decide. Don't build what the rows don't ask for.

## Round 3: fidelity, where it bites

🏗️ **Cloud Dragonborn:** The digest. The diff cache is host-side bookkeeping. It must never enter the save, `state_view`, or the conformance digest. If the last-sent cache leaks into hashed state, ts and wasm disagree and the lock breaks.

🎮 **Link Freeman:** And keyframes. Load, a refused op (`fail()` already resets `sentRevision`), a fatal and restart, a tower swap, an explicit `merge: true` from `settle`: each one resets the cache and sends the full thing. The delta is an optimization over a stream that always starts from a keyframe.

🎨 **Sally:** What about saves? `serialize` returns the exact engine save only when the last reply carried one. If replies stop carrying full saves, every quick save becomes the approximate path.

🎮 **Link Freeman:** Good catch. Today `exact` is set only when `r.merge` arrived caught up. With deltas, the read model's own save becomes the norm for synchronous callers. That's survivable only if the delta carries everything the save does, `seed` included. The scratch diff shows `seed`, `money`, `ledger`, `transports`, `log` changing at the hour, all top-level keys. Send changed top-level keys whole. Then the read model's save equals the engine's at the last reply, minus the in-flight steps the #1018 fix already handles.

🏗️ **Cloud Dragonborn:** And the async save paths keep calling `settle`, which keeps asking for the full save. Exact stays exact where it matters.

🎨 **Sally:** And the deserialize step. `Simulation.deserialize` might normalize or migrate fields. If we `Object.assign` a raw delta record onto a unit, do we skip that?

🎮 **Link Freeman:** We might. The applied record has to go through the same per-unit decode the deserializer uses, or the parity test catches it. Which is the test I want: at every hour pass on small, medium and large, plus a command stream (build, demolish, a refused command, a load mid-run), the delta-applied read model must equal the full-merge read model. Field for field. The existing fingerprint (`WasmParityError` path) does most of it.

🏗️ **Cloud Dragonborn:** Plus the revision-keyed caches. `mergeTower` replaces non-Map fields, which resets `stopsCache` and friends every hour today. A delta that doesn't touch them changes when they reset. Usually faster, but it's a behavior change and #868 already flags that the snapshot should reset them deliberately.

## Round 4: order of work (the fight)

🎮 **Link Freeman:** Frame view delta first. Small, contained, fixed layout, one array. I can have it measured in a day.

🏗️ **Cloud Dragonborn:** And it buys you the 15%. The merge is 85%. Do the merge.

🎮 **Link Freeman:** The merge touches `merge.ts`, `workerApply.ts`, the protocol, the Rust save path, and the approximate-save behavior. That's the risky one. Prove the cache-and-compare pattern on the frame view, where a bug shows up as a wrong number on screen within a frame.

🎨 **Sally:** I'll break the tie with the player. The stutter is the merge. The frame view at 2 MiB is bandwidth the player never sees on desktop; it's 2 ms a batch. If you can only ship one thing, ship the one that removes the twice-a-second judder.

🏗️ **Cloud Dragonborn:** Thank you.

🎮 **Link Freeman:** I'll take it, on one condition: the save delta lands with the frame-view delta's pattern designed alongside, same cache-reset rules, same keyframe triggers. So we don't invent two diff protocols.

🏗️ **Cloud Dragonborn:** Done. One "since last sent" contract, two channels, save first.

🎨 **Sally:** And nobody calls it fixed until the frames rows move, not just the hosted ones. Hosted rows don't count the clone.

## Converged

- Root cause: both channels re-send unchanged state; 92% of large-tower units are static floor tiles; 85% of worker main-thread time is the hourly full merge.
- Recommendation: an engine-side "changed since last sent" contract (Design A), save channel first, frame-view unit records second, sharing cache and keyframe rules.
- Rejected for now: write-site dirty tracking (drift risk), shared memory (production not isolated; bench would mislead; no consumer).
- Proof: frames rows (p99, 1% low, sim minutes per second at 4x), not only hosted rows.
