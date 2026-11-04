# Interaction benchmark

`npm run perf:interaction` measures how the live game answers a player on a
big running tower: two builds side by side, driven through the same scripted
interactions while the Rust simulation runs at the fastest speed. It is the
measurement for the 3.0 responsiveness work (smooth input on large towers
while the simulation keeps running). It is not a gate, it has no tolerances,
and it is not the protocol's M8 edit scene (`benchmark-protocol.md`), which is
still a plan item.

## What a run does

For each CPU throttle and each repetition, each arm gets a fresh browser. The
arms alternate (A then B on odd repetitions, B then A on even ones). In each:

1. Load the scenario the way a player's load does (default `large`, the
   Tier-1 win tower from `src/tests/perfCompare/scenarios.ts`), with the title
   screen, emergency prompts and the congratulations dialogs calmed after the
   load (a load resets them).
2. Fast-forward to the next 07:30 (the next day's when the save is already
   past it), start the tower at the fastest speed, and warm up for 10 s. At
   the fastest speed the warm-up alone covers about 20 game hours, so the
   phases do not start at 07:30; the report lists the time of day each phase
   started at, per run.
3. Run six phases of 20 s each, one second apart. Inputs are paced against
   the wall clock; a step the page makes late runs at once, without a burst
   to catch up:
   - **idle**: no input;
   - **pan**: middle-button drags across the view and back, a move about
     every 16 ms;
   - **zoom**: a wheel notch every 250 ms, five in and five out, ending on a
     whole cycle (so its window can run up to a cycle past 20 s);
   - **panels**: open and close Statistics, Saves and Settings, one a second
     (a dialog counts as opened only when one is open after the click; on a
     narrow window the side panel is opened before the window and closed
     after it);
   - **build**: place an office and undo it, once a second (a placement counts
     when the tower gained an office; a click the tower refuses is an input
     but not a placement, and is not undone). When no office fits in view,
     the camera first moves to a free spot;
   - **inspect**: click a room with the inspect tool every 500 ms (the
     selection is dropped before each click, and a click counts as taking
     effect when it selected a room).

   The camera is put back after every phase, so each one starts from the
   same view on every run.

Autosave runs once in the middle of every phase, and its timer is switched
off, so its stall lands at the same point for both arms. If a phase's autosave
has not run by the time its window closes, it is cancelled, so it never runs
between phases or inside the next one, and the run is marked not clean. The
time recorded for it covers the synchronous part (the engine serialize and the encode). The
compression runs in a `CompressionStream`, off the main thread; the steps
after it that run on the main thread (the base64 encoding and the storage
write) show in the long tasks.

Per phase it records rAF frame intervals, long tasks, long animation frames
(blocking time), every pointer, wheel and key input's time to when the next
frame's animation callbacks run, slow clicks and keys from Event Timing (at or
above 16 ms, one per interaction: its longest entry's duration and its
largest input delay; Event Timing
leaves out wheel and pointer moves), how many game minutes the tower advanced,
the window's length, and the time spent in the engine steps, the view decode,
the HUD update, the whole frame tick, engine serialization and autosave.
Entries go to a phase by their start time, since the browser reports them
late. Frame errors are counted as the app records them, because a load or an
undo empties the app's own list.

## Reading the report

`report.md` and `results.json` land in
`docs/performance/results/<date>-<commit A>-vs-<commit B>-interaction` (with a
counter when that folder exists) unless `--out` names a folder (the repository keeps a summary of each run and sends the raw folder to the private verticopolis-benchmarks repository, per `benchmark-protocol.md`); `results.json`
is rewritten after every arm, so a run that fails late keeps what it measured.
The report opens with its snapshot date. Frame metrics (p95, p99, 1% low)
compare as paired ratios, B over A, one per repetition. Blocking and input
metrics compare as paired differences, B minus A, because either arm can read
0. Totals are read per second (long-task time, LoAF blocking) or per minute
(slow clicks and keys) of the phase window, since a slower arm can hold a
window open a little longer. Intervals appear from six pairs up, so the
default is six repetitions. A second table lists what each run did (the time
of day the phase started at, the window's length, inputs sent, what took
effect, game minutes, frames), so a phase that measured nothing shows.

A renderer that is not a named hardware GPU stops the run: render cost then
dominates every frame (any cloud container renders with SwiftShader).
`--allow-software` with `--out` turns such a run into a preview whose report
says so, with its date, in its first line, and whose `results.json` carries
`"preview": true`; a preview is never evidence. The run exits 1 when the page
threw an error or left a promise rejection unhandled, the app caught a frame
error, the tower stalled in a phase, the build or panels phase took no
effect (no office placed, no dialog opened), or a phase did not run exactly
one autosave.

## Running it

Both arms must be tooling builds, which publish the `window.game` handle the
script drives. Build each commit in its own worktree:

```sh
git worktree add ../vc-a <commit-a>
cd ../vc-a && npm ci && npm run wasm:build && VC_TOOLING=1 npx vite build --outDir ../dist-a --emptyOutDir
# the same for <commit-b> into ../dist-b
```

Then, from any checkout that has this script:

```sh
PW_CHROMIUM_CHANNEL=chrome npm run perf:interaction -- --a ../dist-a --b ../dist-b
```

Options: `--reps 6`, `--throttles 1,4`, `--phase-ms 20000`, `--warm-ms 10000`,
`--scenario large`, `--viewport 1920x1080`, `--out <dir>`, `--quick` (one
repetition at 1x with 3 s phases, a smoke test) and `--allow-software`. The
browser settings are the ones `perf:compare` and `perf:worker` read (`PW_CHROMIUM_CHANNEL`,
`PW_CHROMIUM_PATH`, `PW_CHROMIUM_ARGS`). It exits 2 when it could not run.
