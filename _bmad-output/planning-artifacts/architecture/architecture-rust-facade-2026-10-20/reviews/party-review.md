# Party review: the TypeScript mirror or a Rust-backed facade

> **Snapshot, 2026-10-20, about 21:30 UTC, against `main` at `93ec86a`.**
> A BMAD party-mode roundtable (the Engine Room, session mode, run without
> a live user) on the proposal in this folder: `ARCHITECTURE-REVIEW.md`,
> `measurements.md`, `slice-plan.md`, `plan-updates.md` and
> `consumer-inventory.md`. Its findings are folded into those files; the
> table at the end says where.

**In the room:** 🏛️ Cloud Dragonborn (game architect), 🏗️ Winston (system
architect), 🕹️ Link Freeman (game developer), ⏱️ Tess (performance and
conformance QA), 🦀 Ruth (senior Rust engineer), 🗂️ Vera (save fidelity),
🕸️ Theo (web platform), 😤 Grumbal (the adversary, playing the skeptic),
🌶️ Boundary (edge cases).

---

*The table has the review printed out and a laptop open on
`measurements.md`. Grumbal has already circled something in red.*

😤 **Grumbal:** Section 1, point 1. "A cannot reach the gate on the large
tower." Says who? You measured today's host and a prototype of one delta.
You never measured A with #1068, #1049 and #1050 all in. That's an
overclaim, and an owner who reads it will ask exactly that.

⏱️ **Tess:** He's right on the wording. The measured A is the full-merge
host. #1133 is a browser main-thread figure under software rendering; the
B rows are Node with no renderer. Different units. Don't put 3.83x and
0.27x in one sentence as if they compare.

🏛️ **Cloud Dragonborn:** Then say what's true. A fully delta'd A could
close much of the *transfer* gap. What it can't close is the shape: a
second simulation kept consistent by keyframe rules, every command applied
twice or relayed, panels running TypeScript gameplay on a copy, and the
whole TypeScript engine pinned in the page forever. That's the argument.
The speed numbers are supporting cast.

🏗️ **Winston:** Agreed. Lead with authority and retirement, then the
measured costs, and state plainly that the fully optimized A is unmeasured.

😤 **Grumbal:** Fine. Next. Restore points. "Hourly, 63 ms on large." An
hour at the top speed, 120 game minutes a second, is half a real second.
That's a long task twice a second. M4 eats you alive.

🕹️ **Link Freeman:** Today's host pays a 370 ms merge on the same hour, so
B is still miles ahead. But yeah, "per game hour" is the wrong clock for a
restore point.

⏱️ **Tess:** Pre-register it. No restore-point task over 50 ms on large at
1x and 4x on the PC, or the cadence changes. Real-time cadence, idle-time
capture, a faster serializer, then `SaveMirror` deltas if all else fails.
In that order, measured.

🗂️ **Vera:** And the sidecar. Today `carryLiveState` copies between two
live objects in memory. Under B it becomes JSON written by Rust and read
by the TypeScript fallback. That's a contract between two engines. Version
it, give it a schema, round-trip test it. It never touches disk, so no save
version, but a sidecar from one engine build applied by another must fail
loud.

🦀 **Ruth:** Can I talk about the dirty marks before everyone falls in love
with them?

🌶️ **Boundary:** Please.

🦀 **Ruth:** The frame's unit fields (state, occupants, customers, hotel
customers, out for a meal) are written from a dozen places. Mark dirty at
every write site and the one you miss is a stale room light nobody notices
for a month. A compare over the rooms index is complete by construction:
2,900 rooms on large, a few microseconds. Floor and lobby tiles never
change those fields.

🌶️ **Boundary:** Never? A floor tile under construction? A lobby on fire?
`build.rs` puts anything with a build time into `Construction`, and
`finish_construction` flips it back on a later step with no revision bump.

🦀 **Ruth:** Then prove it per state with a test, and where it fails,
carry the handful of structural ids that changed. Still no walk over forty
thousand tiles.

⏱️ **Tess:** HP-2 says no walk over all units per frame.

🦀 **Ruth:** Rooms aren't all units. That's the point of `room_units()`.
Write the reason in the record and measure it.

🏛️ **Cloud Dragonborn:** I'd take Ruth's version first and keep dirty marks
as the optimization if the PC says so. The view oracle catches either
one's misses.

⏱️ **Tess:** Rooms compare, with the reason recorded and the oracle
running. I'll accept that. I won't accept "we'll measure later" on the
renderer, though.

😤 **Grumbal:** Here we go.

⏱️ **Tess:** The plan migrates 102 files through slices 1 to 8 and then
measures on the PC at slice 9. If the renderer reading a typed-array view
costs more than it reads in Node, you find out after the expensive part.
Spike it first. A measurement-only browser build: the renderer and HUD fed
from the prototype view, merges off, the frames pass on the PC, medium and
large at 1x. Thresholds written before the run.

🏗️ **Winston:** That fits the strangler order if the spike gates the
renderer slice, not the whole plan. Slice 1, the commands slice and the
engine view help either way.

🕹️ **Link Freeman:** And the spike is cheap: `towerCrowd` and the scene
reconcile are where the frame goes. Everything else can be broken for an
afternoon.

🕸️ **Theo:** Two things from the browser side. First, promises. "Resolves
in the same task" is true for the microtask, but every `await` moves the
code after it. Look at the paint brush in `buildActions.ts`: it builds a
tile, then on the next pass calls `sim.tower.structureKindAt` to skip
tiles that now carry the kind, and after the loop it checks every tile
again. That only works because the build changed the tower synchronously.
Read that from a view that refreshes on the next frame and the brush
re-buys tiles or reports the wrong thing.

🦀 **Ruth:** Then the brush is one engine command over a tile list, or the
port refreshes the structure before a structural command's promise
resolves. I'd do the first; it's one call across the boundary instead of
dozens.

🌶️ **Boundary:** And what happens when the pointer moves twice before the
first quote answers?

🕸️ **Theo:** Latest-wins, with a sequence number. On the main thread it
never shows, on the worker it would.

🌶️ **Boundary:** Commands during a fault? During a recovery adopt? A save
while a command is in flight? An undo while a build is queued?

🏗️ **Winston:** One queue for everything that touches the engine:
commands, saves, loads, undo, restore points. The port holds or refuses
during an adopt, and says which.

🕸️ **Theo:** Second thing: the fallback chunk. The import guard pushes the
`Simulation` module behind a dynamic import, which is good for the healthy
path. But if that chunk isn't precached and the player is offline, the
fallback fails exactly when it's needed. Keep it in the precache manifest
and add a test: network off, force a trap, the game keeps playing.

😤 **Grumbal:** Now the part nobody wants to say. The critical path.
Eligible sessions start at S9. Under B that's slice 10. So the 1,000
sessions clock starts later, and nobody's allowed to redefine eligibility.
Say it in the review, in plain words, with the order.

🏛️ **Cloud Dragonborn:** It's the honest cost. Some of it comes back:
A5's sync design, the RUN-0b churn decision and #1050's patching of the
mirror drop out. But the owner should see the trade, not discover it.

🏗️ **Winston:** And the lanes. Slices 2 to 5 touch `main.ts`,
`frameLoop.ts`, `startWasmHost.ts`, `hostFault.ts` and renderer files while
#1092, #1177 and #985's slice 2 are open in some of the same files. Publish
a file-claim table per slice and start with what doesn't collide: slice 1,
the engine view, the command gaps.

🕹️ **Link Freeman:** The diagnostics slice worries me more than the lanes.
790 lines with the wording tangled into the thresholds. "Facts in Rust,
copy in TypeScript" is the right cut, but slice it by facility family,
or the review is one enormous diff nobody can check.

🗂️ **Vera:** One more on undo. The plan says the signature becomes an
engine change counter. Today's `towerStateSig` covers the tower and money
only. If the counter also moves on a rename or a camera change, undo
starts recording steps it never recorded. Define it by a test against
`towerStateSig` on the TypeScript adapter, command by command.

🦀 **Ruth:** And `wasm.rs` is 1,455 lines already, on the ratchet, with the
independence test pinning every `wasm_bindgen` to that one file. Fifteen
more exports make it worse. Either the wrappers stay one-liners over core
modules, or slice 6a opens with a split into `src/wasm/` and the
independence test learns the directory.

😤 **Grumbal:** And the view types. You hand the renderer the live
TypeScript `Tower` through `TsSim`, "zero copy". Then somebody in a render
path pushes to `units`. Make the view interfaces `readonly` all the way
down, or the fallback grows a second way to change the tower.

⏱️ **Tess:** Last one from me: the stop rule says "no better than today's
host". That bar is too low. Today's host is the thing we already know
fails. The bar is the protocol rows, M2 to M6, against TypeScript.

🏛️ **Cloud Dragonborn:** Then that's the bar.

*Grumbal puts the red pen down, which is as close to approval as he gets.*

😤 **Grumbal:** Recommend B to the owner. With the fixes. I'm still
watching the restore points.

---

## Findings

| # | Severity | Finding | Fix | Where it landed |
| --- | --- | --- | --- | --- |
| P1 | major | "A cannot reach the gate on the large tower" overclaims: the fully delta'd A (#1068, #1049, #1050) is unmeasured, and #1133's browser figure and the Node B rows are different units | Lead with authority and retirement; say the fully optimized A is unmeasured and would close much of the transfer gap but keep its structural costs; keep the units apart | Review section 1 and 3 |
| P2 | major | Restore points "per game hour" are the wrong clock: at 120 game minutes per second an hour is half a real second, and a 63 ms `serialize()` on large would be a long task twice a second | A real-time cadence, idle-time capture, then a faster serializer, then `SaveMirror` deltas; a pre-registered budget of no restore-point task over 50 ms on large at 1x and 4x on the PC | Review 5.7, slice 7 and 8. Refined after the review on the Runtime thread's note: points ride the saves the host already takes (undo captures, the 30-second autosave), so #1101's "no save added per command or tick" holds |
| P3 | major | The renderer's cost of reading B's view is measured only at slice 9, after the expensive migration | Spike 0: a measurement-only browser build with the renderer and HUD fed from the prototype view, the PC frames pass on medium and large at 1x, thresholds written first; it gates slice 3, not slices 1, 2 and 6 | Slice plan |
| P4 | major | The critical-path cost is not stated: eligible sessions start at S9, which under B is slice 10 | State it in the review and in the plan updates, with what B removes from the path | Review 1 and 8, plan updates 2 |
| P5 | major | Slices 2 to 5 share files with #1092, #1177 and #985 slice 2 | A file-claim table per slice; start with slice 1, 6a and 6d, which do not collide; slices touching Runtime files wait for #1092 | Slice plan |
| P6 | medium | The restore-point sidecar becomes a cross-engine contract (Rust writes, TypeScript reads) | A versioned schema, a round-trip test on both engines, a loud refusal on a mismatch; memory only, no save version | Review 5.7, slice 7 |
| P7 | medium | Per-write-site dirty marks are easy to miss | Compare frame fields over the rooms index per read, with a test that structural tiles change no faster than the revision (or a list of changed structural ids), and the HP-2 reason recorded; dirty marks only if the PC shows the need; the view oracle either way | Review 5.2 and 9, slice 6a |
| P8 | major | Awaiting a command moves the code after it, and some call sites read the tower synchronously after a build: the paint brush in `buildActions.ts` calls `structureKindAt` after each build to skip done tiles and to judge the gesture | Before a command's promise resolves, the port applies the engine's answer to the view (header, and the structure after a structural command); the brush becomes one engine command over its tile list; slice 2 audits every call site's post-command reads | Review 5.3, slice 2 |
| P9 | medium | Ordering across commands, saves, loads, undo, restore points and an adopt is unspecified | One queue per port for every engine-touching call; during an adopt the port holds or refuses and says which | Review 5.3, slice 2 and 7 |
| P10 | medium | The fallback module behind a dynamic import must be precached or the fallback fails offline | Keep it in the precache manifest (the `verify-precache` gate) and add a test: network off, a forced trap, play continues | Review 5.7, slice 8 |
| P11 | medium | Undo's change counter may cover more than `towerStateSig` (a rename, the camera) and change which steps undo records | Define the counter by a test against `towerStateSig` on `TsSim`, command by command | Review 5.5, slice 5 |
| P12 | medium | The diagnostics slice is one large diff with wording tangled into thresholds | Slice 6c by facility family, each with its differential test | Slice plan |
| P13 | minor | `wasm.rs` is 1,455 lines, on the ratchet, and the independence test pins the binding to it | One-line wrappers over core modules; or slice 6a opens with a split into `src/wasm/` and the independence test admits the directory | Review 5.8, slice 6a |
| P14 | minor | `TsSim` exposes live TypeScript objects; a render path could mutate them | `readonly` view interfaces all the way down | Review 5.2 |
| P15 | minor | The stop rule's bar ("no better than today's host") is too low | The bar is the protocol rows M2 to M6 against TypeScript | Slice plan |
| P16 | minor | The build preview's quotes can arrive out of order on an async host | Latest-wins with a sequence number | Review 5.3 |

## Verdict

**Conditional GO for recommending B to the owner,** on the major findings
(P1 to P5 and P8) being fixed in the proposal before it goes out (done: see
the last column), and the rest carried into the named slices' stories. Grumbal's dissent stands
on one point: restore points stay the risk to watch until the PC measures
them.
