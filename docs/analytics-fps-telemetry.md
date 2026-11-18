# FPS telemetry: what a `session_fps` row is, and what it is not

> **Snapshot, 2026-11-04 to 2026-11-17 (UTC), production.** The figures below
> come from one-off HogQL queries run on 2026-11-18 for issue #2391. No
> governed definition covers them yet (the data catalog has none), so they are
> a dated readout. They do not refresh. The live row volume is the **FPS
> reports per day** tile on the Gameplay Analytics dashboard
> (`scripts/posthog-dashboard.mjs`). A coverage share is
> proposed as a metric at the end and is not computed here.

## 1. The reporting unit

`session_fps` is one summary per **reporting window**:

- A window is a page life: one load of the game in a tab. From the release
  after 4.13.1, the stretch of play after the page comes back from the
  browser's back/forward cache is its own window too (#621).
- The row goes out at the window's **first hide** (`visibilitychange` to
  hidden, or `pagehide`), once at least 120 frames were sampled. It is then
  latched, so play after a tab switch and return is not reported again. The
  row describes the window up to its first hide, which makes it a lower bound
  on the window's play.
- `distinct_id` is the per-tab session id. It survives a same-tab reload, so
  one session that reloads sends one row per page life. Rows can therefore
  outnumber sessions, and a row count is never a count of sessions or people.
- `boot` also goes once per page life, so `boot` rows, not distinct `boot`
  sessions, are the like-for-like count of page lives.

The 2026-11-16 discrepancy in #2391 is this mismatch. The 134 `session_fps`
rows came from 97 sessions. The 114 distinct `boot` sessions held 160 page
lives. Rows against page lives is 134 of 160, and sessions against sessions is
97 of 114. Neither is above 100%.

| Day (UTC)  | fps rows | fps sessions | boot rows (page lives) | boot sessions |
| ---------- | -------- | ------------ | ---------------------- | ------------- |
| 2026-11-12 | 122      | 112          | 149                    | 133           |
| 2026-11-13 | 468      | 354          | 542                    | 413           |
| 2026-11-14 | 227      | 131          | 257                    | 150           |
| 2026-11-15 | 168      | 106          | 208                    | 143           |
| 2026-11-16 | 134      | 97           | 160                    | 114           |
| 2026-11-17 | 110      | 70           | 134                    | 85            |

A row can also land on a later UTC day than its `boot`, when a session runs
past midnight. That is one more reason a single day's two counts need not
match.

## 2. What is sampled

- **Only the foreground.** Frames are sampled only while the tab is visible,
  and each resume re-anchors, so hidden time is never one slow frame.
- **Only frames where the simulation runs** (from the release after 4.13.1,
  #603). A paused frame or one frozen behind a modal skips the engine step.
  On a big tower it renders faster than play does, and it used to pull the
  figure toward the display's cap. The first running frame after a pause
  only re-anchors. Rows from earlier releases include paused and frozen
  frames, so compare versions on the same side of that change.
- **Wall-clock deltas,** read with the sampler's own `performance.now()`. The
  engine's frame delta is clamped for frames over 200 ms and would hide
  hitches. A delta over one second is a loop interruption, not a frame, and
  is dropped.
- **A 256-frame reservoir** (Algorithm R) keeps a uniform sample of the whole
  window in bounded memory, and `samples` is the true count behind it.
  `p50` and `low` are estimates from that reservoir.
- **`low` is the 5th percentile** of the window's sampled fps, not its single
  worst frame. A window whose hitches are rarer than 1 frame in 20 reports a
  `low` at its typical rate. `src/analytics.fps.test.ts` pins both cases on a
  long, deterministic session: hitches in 10% of frames give a `low` at the
  hitch rate, and hitches in 1% give a `low` at the typical rate.
- **It is not a benchmark.** It is what players' own devices showed, mixed
  across hardware, browsers and tower sizes. Performance claims rest on the
  pinned on-device protocol and the engine's callgrind tower set, not on this
  event.

## 3. Who is missing

How many eligible sessions send a row has no governed definition yet, so this
note gives no share (section 5 proposes one). What the design says: a window
reports once it has 120 sampled frames, about two seconds of running play at
60 fps, so the windows that send nothing are mostly short visits. These are
never seen at all:

- tabs killed before their first hide
- relays blocked by a content blocker or the per-IP rate limit
- versions before #538
- sessions that never send a `boot`

How the windows are cut also affects what a row reports:

- **Reloads:** each page life reports on its own.
- **First-hide latch:** a long session that tabs away early reports only its
  first stretch.

## 4. Segmenting

From the release after 4.13.1 each row carries the window's peak
`population` and its running `speed`. The **Session FPS by tower size and
speed** tile reads the frame rate within a population band and speed. The
**Engine cost per game hour by version, tower size and speed** tile reads
`session_sim_cost`, which moves with engine work even when the frame rate
stays at the display's cap. Both keep to the event's own anonymous fields and
`version`: no device fingerprint, no person profile and no stitching across
visits.

## 5. Proposed metric

**FPS report coverage:** of the sessions with at least 10 seconds of
foreground play (from the `session_lengths` view), the share that sent
a `session_fps` row within a day of their first `boot`. This is the one rate
that can be defined from today's anonymous data. If it is adopted, it belongs
in the data catalog or in tested report code, per the governance rule in
`CLAUDE.md`. It should not be re-run by hand for a readout.
