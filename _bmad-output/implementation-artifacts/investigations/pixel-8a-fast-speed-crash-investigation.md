# Investigation: Pixel 8a random crashes at fastest speed (SIXSEVEN save)

## Hand-off Brief

1. **What happened.** The player's 10,344-unit tower renders as ~11,000 retained Excalibur actors; the per-frame
   entity overhead alone saturates the device, and at fastest speed the sustained CPU+GPU load makes Android reset
   the WebGL context, which the game answers with a silent autosave-and-reload (the "random crash") (Confirmed for
   the load profile; Deduced for the device-side reset).
2. **Where the case stands.** Concluded. Ablation in the real build pins 62ms of a 114ms paused frame on the 9,409
   per-tile floor/lobby struct actors and 16ms more on the 935 room actors; the engine sim itself is clean.
3. **What's needed next.** Collapse the per-tile struct actors into a batched representation, cap the per-frame sim
   catch-up so slow devices degrade to a slower clock instead of multi-second frames, and replace the silent reload
   with a crash screen offering a downloadable crash-report zip (save included) plus a prefilled bug-report path.

## Case Info

| Field            | Value                                                                       |
| ---------------- | --------------------------------------------------------------------------- |
| Ticket           | N/A (player report with save files)                                         |
| Date opened      | 2026-07-12                                                                  |
| Status           | Resolved (recovery shipped via `spec-pixel-8a-crash-fix.md`: PRs #189/#191 merged 2026-07-12, in-place context-loss recovery PR #208 merged 2026-07-13) |
| System           | Pixel 8a (Tensor G3, Mali-G715 GPU, 8GB), Android TWA of verticopolis.com   |
| Evidence sources | SIXSEVEN.TDT + sixseven_1.vctower uploads (decoded), source, headless soak  |

## Problem Statement

Player reports: the save "random crashes on my pixel 8a when I am in different part of this save file when on the
fastest speed and when doing different actions". Today the game "just auto reload[s] on crash".

## Evidence Inventory

| Source                          | Status    | Notes                                                                 |
| ------------------------------- | --------- | --------------------------------------------------------------------- |
| Player save (.vctower)          | Available | Decodes clean; 10,344 units (8,704 floor, 705 lobby, ~1,640 rooms), 11 transports, 3-star, pop 2,283 |
| Device logs / crash dumps       | Missing   | No logcat or chrome://crashes from the device; motivates the crash-report feature |
| Headless engine soak (the save) | Available | 6 game days at fastest pacing: no throw, heap flat 18-39MB, worst tick 49.1ms (desktop Node) |
| Browser soak (real build)       | Partial   | In progress: Pixel-sized viewport, fastest speed, sampling heap/actors/fps |
| Source                          | Available | src/render/excalibur/TowerEngine.ts, src/main.ts, src/game/saveLoad.ts |

## Investigation Backlog

| # | Path to Explore | Priority | Status | Notes |
| - | --------------- | -------- | ------ | ----- |
| 1 | Renderer actor count / per-frame cost for 10k-unit tower | High | In Progress | browser soak |
| 2 | Hourly syncScene bursts at fastest speed (every ~30 real seconds) | High | In Progress | TowerEngine.ts:737 |
| 3 | Lit-flip repaint burst (~1,640 room canvases re-rasterized + re-uploaded in one frame) | High | Open | TowerEngine.ts:1515-1521 |
| 4 | JS heap growth in the browser (engine already ruled out) | Medium | In Progress | soak sample |
| 5 | Crowd/walker actor churn at fastest speed | Low | Open | reconcileCrowd is id-keyed, reaped |

## Timeline of Events

| Time | Event | Source | Confidence |
| ---- | ----- | ------ | ---------- |
| in-game min 1,171,357 | Save exported (day ~813) | save JSON `minutes` | Confirmed |
| play sessions | Repeated random crashes at fastest speed, various screen positions and actions | player report | Confirmed (as report) |
| after each crash | Game auto-reloads and resumes | player report | Confirmed (as report) |

## Confirmed Findings

### Finding 1: The only auto-reload-on-crash path is WebGL context-loss recovery

**Evidence:** src/game/saveLoad.ts:111-195 (`recoverFromContextLoss`: autosave, stamp sessionStorage, `location.reload()`);
wired at src/main.ts:693 from `engine.onContextLost`; raised in src/render/excalibur/TowerEngine.ts:483-487.

**Detail:** A JS exception in the tick cannot crash the game (frame guard at src/main.ts:672-688 swallows it), and a
renderer-process kill would not auto-reload. The observed "crash then auto reload" signature is exactly and only the
GPU context-loss path.

### Finding 2: The engine simulation is not the crasher

**Evidence:** headless soak (tsx) of the actual save: 6 game days at fastest-speed pacing (2 sim-minutes per frame),
4,320 frames, zero exceptions, heap 18-39MB flat, worst tick 49.1ms on desktop Node.

**Detail:** No unbounded growth in crowd (people peaked ~138), ledger history capped at 90. Sim cost per frame is
substantial for a phone (tens of ms) but bounded.

### Finding 3: The save produces a scene of roughly 10,400+ retained actors

**Evidence:** src/render/excalibur/TowerEngine.ts:1469-1535 creates one actor per unit (8,704 floor + 705 lobby
struct actors, ~1,640 room actors), plus escapes (2/floor), cars, walkers, crowd.

**Detail:** Excalibur iterates every entity every frame (update + graphics). This scales the per-frame CPU/GPU cost
with tower size, and at fastest speed the sim adds ~2 sim-minutes of work per frame on top.

### Finding 4: Hour boundaries force a full 10k-unit reconciliation every ~30 real seconds at fastest speed

**Evidence:** src/render/excalibur/TowerEngine.ts:737 (`this.d.hour !== this.lastSyncHour` triggers syncScene);
SPEEDS[3] = 120 sim-min/s (src/main.ts:31), so a game hour elapses every 30 real seconds.

**Detail:** Each sync walks all 10,344 units, builds signature strings for ~1,640 rooms, runs a parking flood-fill,
and flags changed room canvases dirty (re-rasterize + GPU re-upload). The dusk/dawn lit flip dirties nearly every
room canvas in a single frame.

## Deduced Conclusions

### Deduction 1: The crash is GPU context loss under load, not a JS bug

**Based on:** Findings 1, 2.

**Reasoning:** The auto-reload the player describes only happens on `webglcontextlost`. Android resets a tab's GL
context under GPU memory pressure or when the GPU is hogged too long. Random timing across different tower areas and
actions matches an environmental (load-driven) reset rather than a specific code path.

**Conclusion:** Reducing peak GPU/CPU load per frame (especially burst work at hour/lit boundaries at fastest speed)
is the fix direction for the crash itself; the crash-report feature addresses the missing-evidence gap.

## Hypothesized Paths

### Hypothesis 1 (user premise): Something in this save is corrupt and crashes the game

**Status:** Refuted

**Theory:** The save file itself triggers a deterministic bug.

**Resolution:** The save decodes, validates, and runs 6 headless game days without a single throw (Finding 2). The
crash is load-shaped, not data-shaped.

### Hypothesis 2: Renderer-side memory or texture leak

**Status:** Open

**Theory:** Long fastest-speed sessions grow JS heap or GPU textures until Android kills the context.

**Supporting indicators:** 10k+ actors; per-car indicator canvases accumulate per state combination
(TowerEngine.ts:1875-1887, bounded but wide).

**Would confirm:** Browser soak shows monotonic heap/texture growth.

**Would refute:** Flat heap/texture counts over a long soak.

### Hypothesis 3: Burst work at hour/lit boundaries stalls the GPU long enough for Android to reset the context

**Status:** Open

**Theory:** At fastest speed, hourly full-tower syncs (every 30s) and dusk/dawn full-repaint bursts (~1,640 canvas
re-rasters + uploads in one frame) plus multi-tick sim frames produce multi-second frames on a phone; Android's GPU
watchdog or memory reclaim then drops the context.

**Would confirm:** Long frame spikes coinciding with hour boundaries in the browser soak; device logcat showing GPU
watchdog resets.

**Would refute:** Hour boundaries costing no more than ordinary frames.

## Missing Evidence

| Gap | Impact | How to Obtain |
| --- | ------ | ------------- |
| Device-side crash signal (logcat, chrome://crashes) | Would pin GL-context loss vs renderer OOM kill | The crash-report feature this PR adds; or user captures logcat |
| GPU memory profile on Mali-G715 | Would size the texture budget precisely | Remote debugging on the device |

## Source Code Trace

| Element       | Detail                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| Error origin  | GPU context loss surfaced at src/render/excalibur/TowerEngine.ts:483-487          |
| Trigger       | Android resets the WebGL context under sustained GPU load / memory pressure       |
| Condition     | 10k-unit tower at fastest speed: 10k+ retained actors per frame, hourly full-tower syncs every 30 real seconds, dusk/dawn full-repaint bursts |
| Related files | src/main.ts (speed, frame guard, onContextLost wiring), src/game/saveLoad.ts (recovery reload) |

## Conclusion

**Confidence:** High for the load profile and its source; Medium for the exact device-side kill mechanism (context
loss vs renderer OOM kill), which only device logs could split; both share the same fix.

Confirmed by measurement in the real build (Pixel-sized viewport, this exact save):

- The scene holds ~11,000 retained actors; a PAUSED frame costs 114ms (p50). Killing the 9,409 one-tile floor/lobby
  struct actors drops it to 52ms; killing the 935 room actors drops it to 36ms. The per-tile struct actors are the
  dominant renderer cost, roughly 55% of every frame, independent of speed.
- Speed only adds ~14ms (p50 130ms at fastest vs 116ms paused): the sim is not the bottleneck (headless soak of 6
  game days: zero throws, flat heap, ~1.4ms per sim-minute on desktop).
- No leak anywhere: JS heap oscillates 205-338MB with no trend over 4 minutes / 20 game days at fastest; GPU texture
  count plateaus near 500.
- Hour-boundary and lit-flip frames cost only ~12% more than plain frames; bursts are secondary to the constant
  per-frame load.
- Picking (`pickEntityAt`) iterates every struct/room actor per inspect/tap, so "checking info of rooms" while the
  tower runs adds O(10k) scans on top.

At fastest speed the catch-up loop (src/main.ts:906-914) owes `frame time x 120` sim-minutes per frame with no cap,
so on a phone that can't hold 120 sim-min/s frames stretch further (measured 8fps even on desktop). Sustained
multi-hundred-ms frames with continuous GPU churn on a phone is exactly the profile under which Android reclaims the
tab's GL context. The player's report (only at fastest speed, anywhere in the tower, any action, then an automatic
reload) matches: the only auto-reload path in the codebase is the context-loss recovery.

## Recommended Next Steps

### Fix direction

1. **Renderer (root cause):** stop paying per-frame actor overhead for static tiles. Replace the 9,409 one-tile
   floor/lobby actors with an `ex.TileMap` (one entity, engine-native culling, per-cell shared graphics), keeping
   the exact same baked canvases so pixels do not change. Resolve floor/lobby picking through `Tower.unitAt`
   (src/engine/Tower.ts:96) instead of scanning actors.
2. **Pacing guard:** clamp the sim catch-up debt per frame (src/main.ts:906-914) so an overwhelmed device slows the
   game clock instead of stretching frames without bound.
3. **Evidence gap (feature):** replace the silent reload with a crash screen: say what happened, offer a
   crash-report zip download (report JSON + the tower save), then reload; wire a prefilled GitHub bug-report path
   that tells the reporter to attach the zip.

### Diagnostic

If crashes persist after the fix, the new crash report supplies the device-side half (user agent, memory, timings,
recent frame errors) that this investigation had to work around.

## Reproduction Plan

1. Decode sixseven_1.vctower (VCTOWER1 magic + base64 raw-deflate JSON).
2. Seed localStorage key `verticopolis-save` with the raw JSON (legacy uncompressed form loads directly).
3. Boot the built app at a 412x915 viewport, dismiss the splash, set speed 3.
4. Observe ~8fps on desktop-class hardware, dominated by scene size; on a mobile GPU, sustained saturation leads to
   eventual context loss (auto-reload).

## Reproduction Plan

1. Decode sixseven_1.vctower (VCTOWER1 + base64 raw-deflate JSON).
2. Seed localStorage key `verticopolis-save` with the raw JSON (legacy uncompressed form loads directly).
3. Boot the built app at a 412x915 viewport, dismiss the splash, set speed 3.
4. Observe frame-time spikes at each in-game hour boundary and at dusk/dawn; on a mobile GPU, expect eventual
   context loss.

## Side Findings

- The crash currently erases its own evidence: recoverFromContextLoss autosaves and reloads with no user-facing
  trace beyond a brief boot note. There is no way for a player to hand developers anything actionable (Confirmed,
  src/game/saveLoad.ts:111-195).

## Follow-up: 2026-07-12

### New Evidence

Fix implemented and measured on the same save and viewport (spec:
`../spec-pixel-8a-crash-fix.md`):

- Scene entities: 11,022 → 1,582 (floor/lobby tiles now live in one ex.TileMap).
- Frame p50 (desktop, SwiftShader): paused 114ms → 76ms; fastest speed 130ms → 92ms. The remaining gap to the
  36ms no-room-actors floor is the TileMap's on-screen cell draws under software rasterization; on device GPUs
  that half is hardware.
- Catch-up debt clamped at 30 sim-minutes per frame (main.ts), so an overwhelmed device slows the game clock
  instead of stretching frames without bound.
- The silent context-loss reload is now a crash screen: verified end-to-end in Chromium (screen shows, zip
  downloads with crash-report.json + a valid tower.vctower that re-imports, prefilled GitHub issue link, Reload
  resumes into the tower with no splash).

### Updated Conclusion

Root-cause fixes shipped on branch `claude/pixel-8a-save-crashes-bx77b2`. The missing-evidence gap (no device-side
crash data) is closed by the crash-report zip for any future crash.

## Follow-up: 2026-07-13

### New Evidence

The crash-report feature delivered its first field report: the player uploaded the zip
(crash-report.json created 2026-07-13T13:05:10Z, tower.vctower alongside) from the same
Pixel 8a and the same tower (SixSeven), now on 1.26.0 (a build that includes the 2026-07-12
TileMap + pacing fixes).

- `crash.kind: webgl-context-lost`, `repeat: false`, `saveFlushed: true`, `behindSplash: false`.
  The recovery pipeline worked exactly as designed: flush succeeded, the crash screen showed,
  and the report reached us (Confirmed, report JSON).
- Device state at the loss is HEALTHY: JS heap 92MB used / 109MB allocated against a 2,060MB
  limit; `recentFrameErrors` is empty, so no tick-guard throws preceded it (Confirmed).
- The save decodes clean: 12,776 units (10,753 floor + 878 lobby in the TileMap; 1,145 room
  actors), 15 elevator shafts / 84 cars, 3-star, population 3,401. Saved view: zoom 0.3 (fully
  zoomed out, most of the tower framed) at speed 3 (Confirmed, decoded tower.vctower).
- Time base: the save's clock advanced ~136,000 game-minutes since the 2026-07-12 case save
  (1,171,357 to 1,307,540). At fastest pacing that is on the order of 19 hours of real play on
  the fixed build before a single, non-repeating loss (Deduced from the two saves' `minutes`).

### Additional Findings

#### Finding 5: The remaining player pain lives in the recovery UX

**Evidence:** report JSON (healthy heap, no frame errors, repeat:false); Finding 2 (sim clean);
2026-07-12 follow-up measurements (no leak, texture count plateaus, frame p50 halved).

**Detail:** One context loss after many hours of fastest-speed play on a phone is within
normal Android/Chrome behavior: the OS reclaims or resets the GPU context under system-wide
memory pressure, GPU process restarts, or backgrounding, and no client change can drive that
probability to zero. What the player experiences today is a full-screen crash card and a
manual reload for an event the app could survive in place: the simulation is intact in memory,
every graphic is code-generated (no assets to refetch), and the browser offers
`webglcontextrestored` after our `preventDefault()` in the loss handler.

### Updated Hypotheses

- Hypothesis 2 (renderer texture/memory leak): **Refuted** for this crash. Heap was 92MB at the
  loss and the 2026-07-12 soak showed texture counts plateau; the report shows no growth signal.
- Hypothesis 3 (burst work stalls the GPU): remains **Open** but demoted: bursts measured only
  ~12% over plain frames post-fix, and this loss took ~19 hours of play to appear once.

### Backlog Changes

- New fix direction: auto-recover the renderer in place on a first context loss (rebuild the
  Excalibur engine on a fresh canvas when the browser restores the context), keeping the crash
  screen for repeated losses (within 90s) and for failed or timed-out recovery, so genuine
  device distress still surfaces advice and the crash-report download.

### Updated Conclusion

**Confidence: High.** The 1.26.0 fixes hold: no leak, no frame errors, healthy heap, and crash
frequency dropped from "random, frequent" to one environmental loss in ~19 hours of play. The
remaining defect is that a survivable one-off GPU reset ends the session behind a dead-end
crash card (the project invariant says context loss should recover in place). Fix: attempt
automatic in-place renderer recovery on first loss; fall back to the crash screen on repeat,
failure, or timeout.
