# Desktop benchmark protocol

> **Protocol, written 2026-10-20 for the 3.0 gate (#945). Not a result.** It
> says how a performance run is made, read and committed. The numbers it
> produces live in committed folders under
> [`results/`](results/); the pass rule is OD-4 in
> `_bmad-output/planning-artifacts/release-3.0-web-plan-2026-10-20.md`
> (sections 5.2 and 5.3). Where the harness code does not do something this
> page asks for yet, the line says "not yet" and names the follow-up.

Performance acceptance figures come only from the owner's desktop, run in a
local session and committed as a results folder. A cloud container never
produces a number that counts, and no figure from before this protocol is
evidence. [`ts-vs-wasm.md`](ts-vs-wasm.md) is the pre-3.0 snapshot that
motivated it.

## 1. The machine

| Item | Value |
| --- | --- |
| CPU, memory | Ryzen 5 5600X, 31.9 GB |
| OS | Windows 11 Pro, build 26200 |
| Node | 22.22 (`.nvmrc`) |
| Browser | see "Which browser counts" |

### Setup (PowerShell)

- **Use `npm.cmd`, not `npm`.** In PowerShell, `npm` resolves to `npm.ps1`,
  which swallows the `--` that separates npm's flags from the script's. Write
  `npm.cmd run perf:compare -- --reps 10`, never `npm run ... -- ...`.
  (The harness's own builds already call node and npm-cli.js directly, with no
  shell; see PR #1093.)
- **Cargo is not on `PATH` by default.** `npm.cmd run wasm:build` needs it. In
  the same PowerShell window, before building:
  `$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"`, then check
  `cargo --version` and `wasm-bindgen --version`.
- **Git line endings.** Until PR #1098 is merged, check out with
  `git -c core.autocrlf=false clone ...`. After it, the engine source hash
  reads CRLF as LF and either setting works.
- **Build with the harness.** `perf:worker` and `perf:compare` both run their
  two builds (production for sizes, `VC_TOOLING=1` for timings) through
  `src/tests/perfWorker/build.ts`. Do not build by hand.

### Which browser counts

A run records the browser it used (product, version, channel, extra switches,
executable path and the WebGL renderer), and a report is comparable with a
reference only when the browser build, the channel, the switches and the
renderer all match. The references are the 2026-10-15 runs, RUN-0a, the A/A
folders of one calibration and any earlier acceptance run. When any of those
differ, the reference is run again on the same settings before it is used.
`--resume` refuses a change of any of them. `perf:calibrate` refuses passes
that differ in them and passes without a verified GPU (`gpuVerified`).

What the references ran, from their committed `results.json` files: the two
2026-10-15 folders (`2026-10-15-e25ec01-worker` and
`2026-10-15-e25ec01c-worker-1280x720`) ran the full bundled Chromium binary
(`.../ms-playwright/chromium-1228/chrome-win64/chrome.exe`, user agent
`HeadlessChrome/149.0.0.0`), reached through `PW_CHROMIUM_PATH`, and got ANGLE
on Direct3D 11 with the RTX 3060. RUN-0a ran Playwright's default headless
shell (`executable: null`, `HeadlessChrome/149.0.7827.55`) and got SwiftShader.
So the reference build is the full binary, and the lever that is expected to
bring the GPU up on the owner's PC is `PW_CHROMIUM_PATH` pointed at that
`chrome.exe`. `PW_CHROMIUM_CHANNEL=chromium` launches the same binary in the
same headless mode, so it should match, but it records a channel where the
references record a path, and only the PC probe can show that the two give the
same renderer. Until the probe has run, a channel run is a different setting
from the references.

Until the owner accepts a browser setting, nothing counts as the acceptance
setting: the owner names the build, the channel and the switches in the
decision that settles #1115, and this section is edited to say so in the same
change. An installed Chrome (`PW_CHROMIUM_CHANNEL=chrome`, or
`PW_CHROMIUM_PATH` at an installed `chrome.exe`) is a one-off check whose
results folder says so. Installed Chrome updates itself, so a run on it
records the version it ran, and a later run on a newer version is not
comparable.

Headless is the harness's only mode and the only mode that counts. Headed mode
(the first option #1115 lists) is declined: the harness has no headed launch,
and a headed browser changes the frame pacing the protocol measures. If no
headless setting reaches the GPU on the owner's PC, headed mode is still owed
as its own change, with its own references.

**The renderer must be the GPU.** The 2026-10-15 reference runs recorded ANGLE
on Direct3D 11 with the RTX 3060. RUN-0a (2026-10-20) ran on ANGLE with Vulkan
SwiftShader, which is software rendering. That makes FPS, 1% lows, frame-time
p99 and every frame-bound part of M1 to M8 invalid, and it may have moved the
bare-step rows too (see the folder's `READING.md`).

The harness fails closed. A full run passes the renderer check only when the
WebGL renderer, read at the start of each browser process, after its frames
and again after its throttled cold start (the reads are kept apart, so a
later read cannot hide an earlier one), names a hardware adapter:
a string with a known device family (GeForce, RTX, Radeon, Iris, UHD, Arc,
Apple M-series, Adreno, Mali and the like), or a vendor word beside a model
number, and no software or virtual-adapter word. A bare vendor word names no
device. Version numbers, driver builds (`D3D11-31.0.15.3623`, `Vulkan 1.3.260`)
and years do not count as model numbers, and Firefox's masked strings ending in
`, or similar` are refused. A generic Intel string with no model (`Intel(R) HD
Graphics`, `Intel(R) Graphics`, `Mesa Intel(R) Graphics (RPL-P)`) fails closed
too: the check cannot tell it from a masked one. If a real run reports one,
the owner names it in the decision that settles #1115. The probe asks for the
high-performance adapter, as the game does.
These are all errors in a full run:

- a software rasterizer (SwiftShader, llvmpipe, WARP, Microsoft Basic Render
  Driver, Mesa software and the like);
- a virtual display adapter (VMware SVGA, VirtualBox, Parallels, Citrix,
  Microsoft Basic Display Adapter and the like);
- a string that does not name a device, including a masked string, a bare
  vendor and an unrecognized vendor;
- no renderer recorded at the start of any process, including a `null` or empty
  read, or none at a later read of a process that had none at the start;
- different renderers across processes or across the reads of one process,
  whichever read they come from;
- a renderer read at the start and none at a later read, which is how a GPU
  process that died mid-run looks;
- a `webglcontextlost` event on any canvas in any page of a process run (the
  run's `contextLost` list). The renderer reads come from a new canvas, so a
  GPU process that restarted mid-run still reads the same adapter there while
  the game's own context is gone, and the game recovers by rebuilding its
  canvas. The frames around that are not measurements. The probe canvas the
  harness makes stays detached, so releasing it is not counted, and the
  service-worker first visit (a side measurement with no frames) is not
  counted either.

A `--quick` smoke run turns the first four into warnings so the cloud smoke
still works, and its report says at the top that no frame row in it is GPU
evidence. A register exception turns the first three into warnings (below) and
leaves the missing renderer an error. The last three stay errors in every mode,
quick or excepted. The same check runs on a throwaway browser launch before
the builds, under one 60-second deadline from the launch call through the
read, plus at most 5 seconds for the close, so a setting that does not reach
the GPU stops a full run in seconds. The launch
reads a blank page, so it cannot see a process whose game page later falls
back to software; the end read catches that after the run (a page-level start
check that stops such a run early is tracked in the backlog).

An exception is an entry of the release exception register
(`_bmad-output/planning-artifacts/release-3.0-exception-register.md`) that is
**approved** and names #1115. Only the owner approves an entry. A run declares
one with `PW_RENDERER_EXCEPTION=EX-<n>`, and the harness fetches `origin/main`
(best effort) and reads the entry from `refs/remotes/origin/main` before it
builds anything, so a branch, a tag or an uncommitted edit cannot approve its
own exception and an entry revoked on main counts as revoked. The register in
the working tree must match main's, line endings aside, and main's commit is
recorded. Exactly one entry must carry the id (`## EX-<n>` followed by a colon
or space, ending at the next level-1 or level-2 heading, with code fences and
HTML comments ignored). It must have exactly one bullet that looks like a
status (`- **Status:** ...`, or the same with the colon outside the bold, with
`*` or `+` for the bullet, indented, or as a `Revoked` or `Withdrawn` line),
that one bullet must be written `- **Status:** approved` at the left margin
(a value wrapped onto indented lines is joined first and must still read
exactly `approved`, so the register's house style `approved (date, ...)` is
refused), the entry must not say revoked, withdrawn or rescinded anywhere, and
it must name `#1115`. An id that is not in the
register, an entry that is only proposed, rejected or "approved in principle",
an entry about something else, a tree whose register differs from main's and a
main that cannot be read all stop the run. With a valid entry, the first three
errors become warnings that name it. `results.json` records the id, the entry's
SHA-256 and main's commit (`browser.rendererException`,
`browser.rendererExceptionSha256`, `browser.rendererExceptionCommit`) and puts
the first two in the machine identity (main's commit is a record only, so an
unrelated merge to main does not refuse a resume), an `--out` folder name must contain
`exception-ex-<n>` (the default name has it), the report leads with a banner,
and `browser.gpuVerified` is `false` for every run that declared an
exception, whatever it read. `gpuVerified` is `true` only when every good run
passed the check with no exception and no `--quick` allowance, so a consumer
such as `perf:calibrate` can refuse a run on that flag alone. A run under an
exception is GPU evidence only as far as the entry says.

The harness does not force the GPU. When the browser comes up on a software
rasterizer, choose the browser for the next run through the environment
(PowerShell: `$env:NAME = "value"`) and read the first lines of the console,
which print the product, version and renderer before anything builds:

- `PW_CHROMIUM_PATH` points at a browser binary (the reference build above is
  the first thing to try). `PW_CHROMIUM_CHANNEL` is one of `chromium` (the
  full bundled Chromium in new headless mode), `chrome`, `chrome-beta`,
  `chrome-dev`, `chrome-canary` or `msedge` and its variants. Set one of them,
  not both. An empty `PW_CHROMIUM_PATH` counts as unset.
- `PW_CHROMIUM_ARGS` takes only switches that choose how the GPU is reached:
  `--use-angle=<backend>`, `--use-gl=<backend>`, `--ignore-gpu-blocklist` and
  `--enable-gpu-rasterization` (without it Chromium may rasterize on the CPU
  with a GPU present, which is the question itself). Names are read in lower case (Chromium on
  Windows lowercases them), values must be plain words, and a switch given
  twice is refused. Everything else is refused, because it replaces the
  harness's own switches or changes what is measured (feature lists,
  `--enable-zero-copy` and other switches that change how frames are made once
  the GPU is reached, process-model and
  compositor switches, a debugging port, extensions, a proxy, an unlocked
  frame rate). Playwright already passes `--no-sandbox`.
- Both are parsed before any build or results folder exists, so a mistake
  fails at once.
- The results record the channel, the executable and the switches
  (`browser.channel`, `browser.executable`, `browser.args`), the report's
  Browser row prints them, and the browser version and renderer are part of
  the machine identity that `--resume` checks.

Which of these brings the GPU up on the owner's PC is not known from the
cloud. The PC probe for #1125 (a project file, `pc-probe-1125-gpu.md`, not in the
repo) settles it, and its notes say what was set. Backlog row #1115 closes only after a PC report names a hardware
renderer, this section names the counting build, channel and switches, and the
references have been run again where those differ.

RUN-0a is the exception to all of this. Its `e25ec01` tree has neither the
check nor the variables above, and both of its runners launch with
`PW_CHROMIUM_PATH` only. A RUN-0a repeat therefore keeps the manual rule: read
the report's Renderer line and reject the run when it names SwiftShader,
llvmpipe or any other software rasterizer. The only lever it has is
`PW_CHROMIUM_PATH`, pointed at the full bundled Chromium the references used
(`chrome.exe` under `chromium-1228\chrome-win64`); it cannot set the channel
or any switch. If that does not reach the GPU, the repeat waits for a commit
that has the check.

### Machine state

AC power; Windows in its best-performance power mode; nothing else building,
testing or benchmarking; no local model inference, model download or other
heavy agent work (the owner's rule, 2026-10-20); every browser and editor
window closed; the ChatGPT desktop app and the NVIDIA Overlay closed; no
antivirus scan running. Sample the idle CPU load just before the start and
record it in the notes. Note anything unusual (a Windows update pending,
thermal state) in the run's notes. The harness records CPU, memory, OS
build, GPU, Node, Rust, wasm-bindgen, Playwright and browser versions in
`results.json`.

## 2. Preconditions

A run on `main` needs all of these merged:

- PR #1093 (shell-free Windows builds for both harnesses).
- PR #1097 (the `perf:compare` Node check imports the engine glue by `file:`
  URL; before it, `perf:compare` fails on Windows with
  `ERR_UNSUPPORTED_ESM_URL_SCHEME`).
- PR #1098 (#880, line-ending-stable engine source hash).

RUN-0a is the exception: it runs the `e25ec01` tree with one declared build patch (section 7).

## 3. Identity

A run proves it measured the commit it names.

1. A clean checkout of the SHA: `git status --porcelain` prints nothing.
2. `npm.cmd ci`, `npm.cmd run wasm:build`.
3. The harness builds and runs. Its `results.json` records the commit, the
   engine source hash (`BUILD.json`) and `environment.dirty`.
4. On Linux, `git archive <sha> | tar -x -C <dir>` and
   `engineSourceHash` of `<dir>/engine-rs` must equal the recorded hash. **A
   mismatch voids the run.** The `.wasm` file's own SHA-256 is recorded for the
   record only: the build embeds the builder's cargo registry paths, so the
   binary differs across machines for the same sources (#1079).
5. **A dirty tree voids the run.** The one exception is RUN-0a's declared
   patch (section 7). A harness at or after the cost-split PR (#1124) records
   what git reports in `environment.tree` and prints it in the report as a
   "Working tree" row: the `git status --porcelain` lines, the SHA-256 of the
   tracked changes, the SHA-256 of each untracked file, and the tracked files
   marked assume-unchanged or skip-worktree (git hides edits to those from
   status and diff, so any such file makes the tree dirty). `docs/performance/results`
   is left out of all four. A clean tree prints "clean" only when the record
   is complete.
   The tracked-changes hash is the SHA-256 of the raw bytes of
   `git -c diff.suppressBlankEmpty=false -c core.compression=-1 -c core.quotepath=true diff HEAD --binary --full-index --no-color --no-ext-diff --no-textconv --no-renames --src-prefix=a/ --dst-prefix=b/ -U3 --inter-hunk-context=0 --diff-algorithm=myers --indent-heuristic -O/dev/null --ignore-submodules=none -- . ':(exclude)docs/performance/results'`
   with `GIT_DIFF_OPTS` removed from git's environment, which fixes the common
   settings (context lines, algorithm, colors, renames, prefixes); a diff
   driver from `core.attributesFile` or `.git/info/attributes` still changes
   the output. The same command piped to `sha256sum` reproduces the hash on
   the same machine (on Windows, run the command from Git Bash so
   the bytes are not re-encoded). The hash identifies a tree on one machine
   under one git configuration; it is not promised to match another
   machine's. With `core.autocrlf=true` git normalizes tracked files to LF
   before it diffs them, and untracked files are hashed as the raw bytes on
   disk, so a CRLF checkout can hash an untracked file differently from an LF
   one. A symlink is hashed as `symlink:` plus its target text. The record is **incomplete**
   (and the run void) when git fails, a file cannot be read or is over
   256 MiB; the report says so instead of printing "none", and
   `perf:compare` and `perf:worker` each record a validation error for it and
   print the same report text. It holds
   what git reports: ignored files and a mode change under
   `core.fileMode=false` fall outside it (backlog row #1123).
   A tree holding exactly RUN-0a's patch (SHA-256 `cf781ee6…d73a1`) on
   `e25ec01` with `build.ts` untracked records the status
   ` M src/tests/perfCompare/main.ts`, ` M src/tests/perfWorker/main.ts` and
   `?? src/tests/perfWorker/build.ts`, tracked changes
   `de44774bc060738a5d83e231198d4c5ddb57b153a609370aa0419e58b85532b7` and
   `build.ts` `e1c69bac2a055a193ecf9d13f032c63df5c6781114680b8b915426e64ba55ec3`.
   Those hashes were computed by hand on a fresh Linux worktree with LF
   endings, with the flags above; no test pins them.
   The `e25ec01` harness itself predates the record, so for RUN-0a the notes
   paste `git status --porcelain` and the patch's SHA-256 by hand.

## 4. Runs

At least **10 valid paired repetitions** per engine, each in a fresh browser
process, with the engine order rotated (the harness alternates which engine
goes first). A failed repetition is re-run and the report says how many were.
Every desktop metric runs at **1x and 4x** CPU throttle, on the small, medium
and large scenarios with their pinned scenario hashes.

`perf:compare` opens a fresh page for every scenario and engine in the timed
simulation passes and in each gameplay-frames block (#1162). Before that change
it ran every scenario after the first in a page an earlier scenario had used,
and the TypeScript engine ran slower there: most likely JIT state left by the
earlier tower, though a reload in the same tab keeps the renderer process, so
the cause is not settled. On the owner's PC the large tower took 1,441 ms on the
TypeScript engine after medium (the #1051 before pass, main `06a6dcb`, 1x, bare
engine, 2026-10-20) against 705 ms in a page of its own with `perf:worker`; the
WASM engine was not affected. The bias favors WASM. Every `perf:compare`
result from before the change is affected on its medium and large rows (the
default run is small, medium, large): the timed simulation rows, the gameplay
frames and the audio-on frames. Memory, startup, transfer, build size and the
first scenario's rows are not. The committed folder `2026-10-14-01c6153` (small,
medium, large) and the figures that `ts-vs-wasm.md` takes from it are such
results, on their medium and large rows. So are the #1051 PC passes (`06a6dcb`
and `a532572`, medium then large), on their large rows only, since medium was
their first scenario. Re-run before citing a cross-engine ratio on a scenario
after the first.

| Command (PowerShell) | What it measures |
| --- | --- |
| `npm.cmd run perf:worker -- --reps 10 --viewport 1280x720 --out docs/performance/results/<date>-<sha>-<label>-worker-1280x720` | Bare engine, the four hosts, frames, memory and traffic. Always pass `--viewport 1280x720`: the harness default is 640x360, and the committed desktop acceptance run (`2026-10-15-e25ec01c-worker-1280x720`) used 1280x720. `perf:compare` renders at 1280x720 fixed and has no `--viewport` flag |
| `npm.cmd run perf:compare -- --reps 10 --skip-build --out docs/performance/results/<date>-<sha>-<label>` | Startup, hosted and bare engine, frames with and without audio, memory, transfer and build sizes. Run it after `perf:worker`; `--skip-build` checks the builds on disk are this commit's |
| `npm.cmd run perf:restore -- --reps 10` | The runtime fallback's restore points (#874) on the hosted engine alone, unpaired: engine saves beyond the merges' and the hosted saves (expected 0), every engine save per command and its time, the event reads' time and share of a step, what one restore point and one restore cost on each tower, and step times for plain frames, a drag, a click and rapid edits (an undo capture and a build per frame), each frame ending with the event drain. Writes `docs/performance/results/<date>-<sha>-restore-points/`. It builds into `dist-perf/` as `perf:compare` does, and after a `perf:compare` run on the same commit `--skip-build` reuses that build |

Other flags both accept: `--quick` (a 2-rep smoke test that never counts),
`--resume DIR` (continue a run that stopped; it keeps its own folder, and an A/A folder resumes with `--aa <engine>` repeated),
`--scenarios a,b`. `perf:compare` also takes `--throttles 1,4` and
`--aa ts|wasm` (section 6.1);
`perf:worker` also takes `--read-model` (Node only, no browser).
`perf:restore` takes `--quick`, `--scenarios`, `--throttles`, `--skip-build`
and `--out`, but not `--resume`: a stopped run starts again in a new folder,
and its `results.json` keeps the runs it finished. In PowerShell, quote a
list (`--scenarios "small,large"`): an unquoted comma makes an array, which
reaches the script as separate arguments.

A results folder is `docs/performance/results/<date>-<sha>-<label>/` with the
raw samples and the machine-written `report.md`, its snapshot header on top,
committed through a PR. **A run that is not committed is not evidence.** Not
yet: the edit scene (M8, PF2) and the stress fixture exist only as plan items.

### Validation

The harness's own pass must be green before anything is read: start and end
digests equal across engines and against the Node conformance check, no
fallback to TypeScript, and clamped frames reported. A failed validation still
writes its folder; commit it with the failure named, and do not average over
it.

A full run also fails validation on the renderer check ("The renderer must be
the GPU"): software, virtual, unknown or missing renderers, mixed adapters
and a lost end read. A `--quick` run or a declared exception turns the first
three into warnings, and the report says so at the top.

## 5. Reading the numbers

- **Orientation.** Every gate ratio is written so that above 1.0 means WASM is
  worse: WASM ÷ TypeScript for times, memory and long tasks; TypeScript ÷ WASM
  for frame rates. `perf:worker`'s report puts a gate column in that
  orientation (`wasm / ts`, and `ts / wasm` for rates) right after the
  metric, then the per-mode values, then the other modes over the shipped host
  as measured (for a rate, above 1.0 there is better); its `ratios.csv` has
  every pairing. Not yet: `perf:compare` still prints WASM ÷ TypeScript for
  every row, rates included (follow-up #1123), so above 1.0 on its mean FPS
  and 1% low FPS rows is better there: invert those before applying a pass
  rule. `perf:calibrate` inverts 1% low FPS itself.
- **Intervals.** Ratios are paired by repetition. The interval is the
  distribution-free 95% order-statistic interval over the paired ratios. A
  verdict needs at least 10 valid pairs.
- **Zero references.** A metric whose TypeScript reference is zero in a
  repetition (long tasks are 0 ms on TypeScript at 1x) has no ratio. Read it as
  the paired difference in milliseconds (WASM minus TypeScript).
- **Memory.** Peak JS heap plus WASM linear memory, with peak WASM memory per
  phase recorded: linear memory never shrinks, and the hourly serialize builds
  a large string inside it.

## 6. The pass rule (fixed before any verdict run)

On the host that ships (`wasm`, main thread) against `ts`, the same build,
every desktop metric at both throttles. A speed metric passes only when the
**upper bound** of its paired interval stays within the tolerance. An upper
bound below 1.0 is "beat". Tolerances come from measured noise (section 6.1),
never from a number picked to pass.

| # | Metric | Scenarios | Pass rule | Harness |
| --- | --- | --- | --- | --- |
| M1 | Bare engine, 720 steps | medium, large; 1x, 4x | Ratio upper bound at most 1 + δ | `perf:compare` |
| M2 | Hosted main-thread time, 720 steps | medium, large; 1x, 4x | As M1 | `perf:compare` |
| M3 | Frame time p99, and 1% low FPS | medium, large; 1x, 4x | As M1, for each | `perf:compare` |
| M4 | Main-thread blocking (long tasks past 50 ms) | large; 1x, 4x | Paired difference upper bound at most ε | `perf:worker` |
| M5 | Cold start to ready | 1x, 4x | Paired difference upper bound at most that throttle's ε | `perf:compare` |
| M6 | Peak JS heaps plus WASM linear memory | large; 1x, 4x | Ratio upper bound at most 1.25 (a memory ceiling, outside δ) | `perf:worker` |
| M7 | 5,000+ population fixture in `npm run perf` | CI | A CI tripwire, read on the candidate commit's CI run. Not a desktop metric | — |
| M8 | Scripted build-and-demolish scene (PF2) | large; 1x, 4x | Frame p99 as M1, long tasks as M4. Own δ and ε, fixed when PF2 lands | — |

M5 replaces the old fixed 500 ms cold-start allowance, which would let a
measured regression pass. A failed verdict stands: a run is repeated only
after a code change or a recorded cause.

### 6.1 Calibrating δ and ε (A/A passes)

An A/A pass runs the same engine in both slots (`wasm` against `wasm`, `ts`
against `ts`) with the verdict runs' repetition count. Identical engines
straddle 1.0, so a tolerance of zero could never pass; the A/A spread is the
noise the tolerance has to cover.

1. Run A/A passes of each engine at 1x and 4x, each with 10 repetitions (the
   verdict runs' count: a pass with another count does not pool with them) on
   the medium and large scenarios. How many passes per engine is a parameter of
   `perf:calibrate` (`--min-passes`, default 5), because step 3 ties the count
   to a coverage limit the owner sets (an open amendment to OD-4).
2. Each ratio family gets its own δ: one for M1 (time), one for M2 (time) and
   one for M3 (frames). The
   value is the smallest round number that clears the largest A/A upper bound
   across both engines and both throttles. ε does the same for the paired
   differences: one ε for M4's long tasks, and one for M5's cold start at each
   throttle, taken as the upper bound of the 95% order-statistic interval of
   the median paired difference (WASM slot minus TypeScript slot, one-sided).
   Not yet: the verdict report has to print that same statistic before M5 can
   be judged against ε.
3. **Coverage.** For passes that are exchangeable, on average over
   the draw of the passes, a fresh pass lands above the largest of n passes
   with probability 1/(n + 1) (before rounding).
   `perf:calibrate` computes that from the engine with the fewest passes and
   states it as the guarantee. A 5% limit needs at least 20 passes per
   engine. Five passes guarantee only 1/6, about 16.7%, so with five the tool
   reports the calibration as not adoptable. The pass count and the limit are
   the owner's to change (an open amendment to OD-4); `--min-passes` and
   `--exceedance-limit` can state a looser pair, and the tool then marks the
   result as not adoptable until the owner approves it. A leave-one-out
   column runs beside it for information: it leaves each pass out in turn and
   asks whether that pass lands above the candidate the others set. Only the
   largest pass can, so it reads 0 or 1. It never blocks adoption and does not
   replace the guarantee.
4. **Caps.** A δ above **0.05**, a long-task ε above **50 ms** of blocking
   (one 100 ms task), or a cold-start ε above **5% of TypeScript's median cold
   start** at that throttle is not adopted. Add repetitions or remove the
   noise source and calibrate again. After two rounds that still miss the
   cap, the coordinator takes it to the owner.
5. The calibrated values are fixed before RUN-1 and committed in the
   calibration run's folder.
6. RUN-3 repeats one A/A pass per engine beside the verdict. An A/A pass
   outside δ or ε goes to the owner, who decides whether RUN-3 stands.

`perf:calibrate` takes only A/A folders and refuses any folder that does not
record `gpuVerified: true`, so the 2026-10-15 references, which predate
`gpuVerified`, the channel and switches record, and the end-of-run renderer
reads, cannot feed a calibration. It checks all three renderer reads (start,
after the frames, after the throttled cold start).

`perf:compare --aa ts|wasm` runs one engine in both slots. `results.json`
records it in `config.aa`, and each run records the slot (`engine`) and the
engine it was asked to run (`ranEngine`, which is `config.aa ?? engine`). The
engine the page reported running is checked against `ranEngine` during the run
(`engineActive`), so a page that fell back to the other engine fails
validation. The slot labels stay `ts` and `wasm`, and every ratio is slot
`wasm` over slot `ts`. Validation judges each run by `ranEngine` and refuses a
folder whose runs do not match `config.aa`; a resume refuses a checkpoint from
a different mode.

Four things keep an A/A folder from passing for a comparison:

- The report opens with a banner, says "A/A calibration results" in its title,
  names the columns by slot, and has no Verdict column. The comparisons CSV
  reads `A/A` where a real run gives a verdict word, so no A/A ratio is
  called equivalent or faster. The interval bounds are the result.
- The three CSVs end in an `aa` column.
- The folder's own name (the last path segment) must contain `aa-<engine>`. It
  gains `-aa-<engine>` without `--out`, `--out` is refused without it, and a
  run without `--aa` refuses an `aa-ts` or `aa-wasm` name.
- The limitations that describe two different engines are left out of the
  report and replaced by a note. The WASM-only ones stay in an `--aa wasm`
  folder.

Which rows an A/A folder keeps: a metric both engines produce is kept for both
slots. A metric only one engine produces is kept for both slots when that
engine is the A/A engine (`--aa wasm` keeps the WASM linear memory, the
engine-hosted and fetch/compile startup rows and the attribution shares) and
left out when it is the other one. The cold WASM load steps are left out of
both modes. An `--aa ts` pass still runs that probe, on the verdict run's
schedule, so the page lifecycle matches. Boot order differs only when the two
slots run different engines, so DOMContentLoaded and the load event are
compared in an A/A folder. An `--aa ts` pass still needs the WASM package
and the Node check of both engines to pass, because the harness validates the
whole setup.

`npm run perf:calibrate -- <A/A folder>... --out <dir>` (`npm.cmd run
perf:calibrate` in PowerShell) applies steps 1 to 4 to a set of
`perf:compare` A/A folders and writes `calibration.json` and `calibration.md`
into the new `--out` folder. `--min-passes N` sets the passes asked for per
engine (default 5) and `--exceedance-limit X` the coverage limit (default
0.05).

It leaves out a folder that is not an A/A pass, failed validation, ran on a
dirty tree or without a complete working-tree record (section 3 step 5,
including files git was told to ignore changes in), is a `--quick` run, had
fewer than 10 repetitions, lacks the medium and large scenarios at 1x and 4x,
did not render on a verified hardware GPU (the check in "The renderer must be
the GPU", at the start and the end of each process run; a declared renderer
exception also leaves a pass out), or repeats another folder (the same
`results.json` once parsed and written back with sorted keys, so a re-save
with other line endings or indentation counts as the same file, or the same
start time, commit and engine). It raises a problem when the passes it keeps
differ in commit, machine and runtime (CPU, logical CPUs, memory, OS, kernel,
architecture, Node, Rust, Playwright), browser (executable, channel,
switches, version, renderers), engine build, or run parameters (the whole
configuration except the A/A engine and the quick flag: repetitions,
scenarios, throttles, steps, step size, frame window, speed, viewport and
warm-up).

Per pass it takes each family's value as the largest upper bound across the
medium and large scenarios at 1x and 4x (other scenarios and throttles in a
folder do not feed it), and a ratio cell with fewer than 10 valid pairs
leaves that family without a candidate for every pass. The candidate is the
largest such value rounded up (δ to 0.01, ε to 5 ms, never below one step).
It holds the candidate to its cap, states the guarantee of step 3 and runs
the informational leave-one-out column. Any folder it leaves out is listed in
`calibration.md` and `calibration.json` with the reason, and the output keeps
each input's canonical `results.json` SHA-256. It reads 1% low FPS as
TypeScript over WASM. It exits 0 only when nothing was left out, no problem
was raised, and every family has a candidate inside its cap with the
guarantee under the limit and the protocol's pass count and limit in use. `calibration.md` opens
with the window of the passes (earliest and latest start) and the commit,
because it is a snapshot, and calls the numbers provisional: it covers M1,
M2, M3 and M5; M4's long-task ε needs `perf:worker` A/A passes (`perf:worker`
has no `--aa` yet, follow-up #1111), and nothing in it sets a tolerance until
the owner adopts the numbers.

The harness for each metric is the last column of the table above: a tolerance
calibrated on one harness's noise is not applied to the other's ratios, and
RUN-0a's reference figures come from `perf:worker`. Nobody reads δ or ε off
the folders by hand: RUN-0b collects them and the values come from
`perf:calibrate`'s output.

One limit stays open, so the calibration is not complete:

- **M4's ε has no A/A source yet.** `perf:compare` measures no long tasks and
  `perf:worker` has no `--aa` (follow-up #1111), so the long-task ε stays
  uncalibrated until that lands. RUN-1 needs M4, so #1111 and its A/A passes
  land before RUN-1, either inside RUN-0b or as a follow-on campaign.

### 6.2 BEFORE/AFTER comparison of a candidate PR

A candidate (for example #1068) is measured against `main` in two full
`perf:worker` runs on the PC, BEFORE on `main` and AFTER on the candidate,
with the same machine, browser, GPU check and flags. Both runs use a
confirmed hardware renderer (the fail-closed check of section 1: no
`--quick`, no renderer exception), `--scenarios medium,large`, the default
throttles (1x and 4x) and `--reps 10`, which is the protocol's minimum for a
verdict. Build each commit with the engine package first and run from a clean
tree (section 3).

```powershell
# On main, then on the candidate commit; same shell, same environment.
npm.cmd run perf:worker -- --reps 10 --viewport 1280x720 --scenarios medium,large --out docs/performance/results/<date>-<sha>-before-worker-1280x720
npm.cmd run perf:worker -- --reps 10 --viewport 1280x720 --scenarios medium,large --out docs/performance/results/<date>-<sha>-after-worker-1280x720

# A light attribution pass on main only (the cost split and the WASM churn rows).
npm.cmd run perf:compare -- --reps 3 --scenarios medium,large --throttles 1 --skip-build --out docs/performance/results/<date>-<sha>-attribution-main

# The comparison. Folder order matters: BEFORE first, then AFTER.
npm.cmd run perf:before-after -- docs/performance/results/<before folder> docs/performance/results/<after folder> --out docs/performance/results/<date>-<sha>-before-after
```

Both commits need the harness of #1124 and #1125 (the working-tree record and
the renderer checks): `perf:before-after` refuses a run that records no
`gpuVerified: true` or no clean tree record, so a build from before them
produces folders the comparison cannot use. For a candidate such as #1068,
build BEFORE and AFTER from `main` after those two PRs and put the candidate on
top of that. The results record no harness hash, so check by hand that the two
commits measure with the same code: `git diff <BEFORE commit> <AFTER commit> --
src/tests/perfWorker src/tests/perfCompare scripts/perf-worker.ts` must be empty
apart from tests (`*.test.ts`) and the comparison tool itself
(`beforeAfter*.ts`). That covers every file that measures, including
`perfCompare/stats.ts` (the 1% low and frame percentiles), `perfCompare/page.ts`
(the long-task probe behind blocking time) and `perfWorker/build.ts`, along with
the runner files. A candidate that edits them is measured with the BEFORE
harness copied onto it, or not at all (backlog row #1141 would record the hash
and make the tool check this). One exception, ruled for the #1068 pair on
2026-10-20: a measured commit may add counters or fields to the measuring files
when the diff between the two harness states is additions only, the independent
reviewer confirms that at both commits, the additions stay outside the timed
regions (a new non-test file that only a comparison or reporting tool reads,
such as #1068's `crossRun.ts`, is covered when nothing the measuring code runs
imports it), rows that only the candidate's run has are never cited as ratios (the
comparison does not pair them), the readout names every addition, and a
same-commit pair is run first to show the additions leave the numbers alone.

The controls assume the candidate leaves the code they run alone. The readout
lists every file the candidate changes that a control mode runs, and says why
that does not move the control. For #1068 this includes the move of the
TypeScript load path out of `src/engine/sim/serialization.ts`, which the `ts`
mode runs for its startup rows.

`perf:before-after` pairs repetition i of BEFORE with repetition i of AFTER
for every metric and mode, and writes `comparison.json`, `comparison.csv` and
`comparison.md`. The argument order sets the roles (BEFORE first), whichever run
happened first; the two runs must not overlap in time. It reads each ratio so
that above 1.0 is worse: AFTER over BEFORE for times and memory,
BEFORE over AFTER for rates and frame rates. The interval is the
distribution-free order-statistic one from `perfCompare/stats.ts` (at least
95%; 97.9% at 10 pairs). Counts, main-thread blocking and any metric with a
zero denominator in a pair have no ratio: the row is read on the per-repetition
difference with its interval, signed so that positive is worse in either
direction, as section 5 already gates M4. A blocking row that goes from 0 to
400 ms in every repetition reads 400 ms [400, 400] and is never reported as too few pairs.

The two runs happen hours apart, so the machine can drift between them. The
default controls are `ts`, `wasm` and `wasm-frame` for two runs of one build
(an A/A pair) and `ts` alone when the commit or the engine build differs, because a
candidate that changes the WASM engine or its host moves the WASM modes too;
`--controls` replaces the list and a subject that is also a control is a usage
error. A control is judged on its median: a ratio above 1.05 or below 1/1.05
by default voids the subject rows of that metric, in either direction, even
when the control has too few pairs for an interval. Main-thread blocking is
judged on its median difference against a fixed 50 ms, the cap section 5 puts
on ε for M4, until the owner adopts a calibrated value; counts and metrics
with a zero denominator are judged on the difference against the tolerance
share of the control's own size, so any change from zero voids. The tolerance
is 5%, the cap on δ in section 6.1, until the owner adopts the calibrated value
(`--tolerance`, above 0 and at most 0.5; a value above 5% prints a banner in
the report), so an effect smaller than it cannot be told from allowed drift.

A control on a metric that a cap or a floor can pin (the frame-loop rates and
times, main-thread blocking and counts) whose values all lie within a third of
the tolerance of each other across both runs (for blocking, within a tenth of
the 50 ms) is flat: a rate pinned at its cap, a time at a floor, blocking that
stays at zero. Heap sizes, byte counts and the hosted and bare CPU times are
never flat, however precise, because a baseline that moved would show there. It could not
have shown drift, so it does not vouch, the report lists it as `CONTROL FLAT`,
and a subject row that only flat controls cover is uncontrolled with a note
saying so. A control whose median held but whose interval reaches past the
tolerance is called noisy. It still vouches, but a subject row that only noisy
controls cover has its own status (`noisy-controlled`) and its own count.

Two figures sit beside each ratio row, and they assume different things. The
raw ratio assumes the machine drifted no more than the control's median shows.
The net-of-control ratio, the subject's per-repetition ratio over the middle of
the vouching controls' per-repetition ratios with its own interval, assumes the
drift is common to the subject and the control and carries the control's
scatter. The net is wider than the raw interval when the control's scatter is
independent of the subject's and narrower when they share it, so neither is
the better figure by rule. Only a ratio row with a vouching control that has a
per-repetition ratio has a net; a row without one says why in its notes. A
metric no control measures is marked uncontrolled. Void comes before too few
pairs. The status `ok` in the files only means no control moved: it is not a
verdict. A row needs at least 10 pairs (`--min-pairs`, never below 6); the
report states the number used and each row's pair count.

At 4x the `wasm-worker` rows are daggered. They read "controlled (main thread
only)" because the throttled controls vouch for the main thread, and the
worker's engine thread was barely throttled (the probe: a busy loop took 41 ms
at 1x and 44 to 58 ms with the page at 4x, 7 to 41% slower, against about 4x on
the main thread). Compare such a row only with another run of the same mode.

Metrics one run lacks, or has values for on one side only, or whose unit or
direction differs, are listed under "Metrics not compared". Rows that no run
has data for (PSS off Linux, the bare-engine rows of hosts that do not measure
them) are left out and counted. The report lists the modes that are neither
control nor subject.

The command exits 1 when the two runs cannot be compared at all, and writes
the reasons into `comparison.md`: either run failed validation (including
listed errors), was `--quick` or does not say it was not, ran on a dirty tree,
declared a renderer exception or did not record `gpuVerified: true`; any of its
three renderer reads (at the start, after the frames and after the cold
start) is not verified hardware; the runs differ in scenarios, run parameters,
machine, runtime, browser or renderer; a metric's repetitions repeat, fall
outside the run or do not match its values, or a metric is listed twice; the
two results have the same content; the runs overlap or have no readable times; or
no subject metric is in both runs. A different engine build or commit is the
point of the comparison and is not refused. It exits 2 for a usage error
(including a subject that is also a control), an unreadable or malformed
folder, or an `--out` folder that already exists, and writes nothing then. It
exits 0 whenever the runs could be compared: void, uncontrolled and regressed
rows are in the files and the exit code says nothing about them. Folder
arguments and `--out` resolve against the repository root. The `results.json`
SHA-256 in the report is over the canonical form (`stable()` in
`perfCompare/calibrate.ts`), so it is not the `sha256sum` of the file.

For the evaluation of #1068, `perf:before-after` is the one governed
comparison: its output is where a readout takes the before and after figures
for throughput, 1% low FPS, main-thread blocking and memory from. The
TypeScript-baseline figures (each run's own `wasm-worker` over `ts` ratios) come
from that run's `perf:worker` report, so nobody computes them by hand. #1068's own `perf:worker-diff`
(`crossRun.ts`) is not cited in a readout. Memory is read once per scenario at
1x only, so there is no 4x memory row.

What it does not do, so a reader does not assume it:

- **No check of the delta oracle, save fidelity, event order or crash
  recovery.** The comparison adds nothing to the validation of the two runs
  and those properties belong to tests. The readout cites the candidate's
  tests by name and CI run: on `main` today `src/tests/integration/wasmWorkerHost.integration.test.ts`,
  `wasmWorkerLifecycle.integration.test.ts`, `wasmWorkerSaves.integration.test.ts`
  and `e2e/wasmWorker.spec.ts`, plus any delta-oracle and read-model tests the
  candidate adds (for #1068, `wasmWorkerDelta.integration.test.ts`).
- **No real 4x worker throttle.** CDP CPU throttling does not reach a Web
  Worker (measured on Chromium 141), so the `wasm-worker` rows at 4x have a
  barely throttled engine thread. Those rows carry a dagger in both reports and
  the CSV `unthrottled` column says `worker`.
- **No separate hour-pass spike row.** The hourly main-thread spike is read
  from the per-batch maximum and the frame-time p99 rows.
- **No GPU driver version check.** The runs do not record it.

## 7. Scheduled runs

| Run | Commit | Purpose |
| --- | --- | --- |
| RUN-0a | `e25ec01` | Does the desktop reproduce 702 ms (TS) and 830 ms (WASM) on the large tower's 720 bare steps at 1x, inside the committed intervals? |
| RUN-0b | `main` once PRs #1097, #1098 and #1124 (the cost-split harness) are merged, and A5's design rule is committed | The baseline later runs compare with: the shipping host's cost split and each hour's churn, and the A/A passes of section 6.1 (folders only; the values come from `perf:calibrate`) |
| RUN-1 | after S6 | The shipping host after S6; the input to cohort stage 3 (M2 to M6 at 1x and 4x) |
| RUN-2 | after #1051 (and #859), and the cold-start fix if needed | Bare tick parity and cold start |
| RUN-3 | the candidate commit | The gate verdict with one A/A pass per engine beside it |

### RUN-0a, exact steps

RUN-0a asks whether the 2026-10-15 desktop figures (702 ms TypeScript, 830 ms
WASM on the large tower's 720 bare steps at 1x) reproduce. That question is
about the engine at `e25ec01`, so the run needs that commit's engine sources;
a later `main` commit has a different engine and says nothing about it. The
2026-10-15 runs built `e25ec01` on Windows from a clean tree and recorded
engine source hash `b2786beb…`, which equals the Linux hash of that commit.

At `e25ec01` the harnesses still build through `sh("npm", ...)`, which dies on
Windows (`spawnSync npm ENOENT`, `src/tests/perfWorker/main.ts` line 200). The
run applies one declared patch, `patches/run0a-e25ec01-build-fix.patch`
(SHA-256 `cf781ee652a9377252ae6be5da73a0b990e325c39984be292be3a715bbad73a1`).
It adds `src/tests/perfWorker/build.ts` (copied from `main`, PR #1093) and
replaces the build calls in both `src/tests/perfWorker/main.ts` (lines
200 and 201) and `src/tests/perfCompare/main.ts` (lines 132 to 134) with
`buildProduction(repo)` and `buildTooling(repo, distPerf)`. It touches no
engine source, so the engine source hash must still equal `b2786beb…`. No hand
editing is needed: the commands below apply it with `git apply`.

```powershell
git -c core.autocrlf=false clone https://github.com/maniator/verticopolis.git "C:\Users\nafta\projects\vc-run0a"
cd "C:\Users\nafta\projects\vc-run0a"
git checkout e25ec01
git status --porcelain            # must print nothing
# Fetch the declared patch from the protocol's branch (or main, once #1099 merges).
git fetch origin claude/benchmark-protocol
git checkout FETCH_HEAD -- docs/performance/patches/run0a-e25ec01-build-fix.patch
(Get-FileHash docs/performance/patches/run0a-e25ec01-build-fix.patch -Algorithm SHA256).Hash   # must be CF781EE6...D73A1
git apply docs/performance/patches/run0a-e25ec01-build-fix.patch
git reset -q HEAD -- docs/performance/patches/run0a-e25ec01-build-fix.patch
Remove-Item docs/performance/patches/run0a-e25ec01-build-fix.patch
git status --porcelain            # exactly: M perfCompare/main.ts, M perfWorker/main.ts, ?? perfWorker/build.ts
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
npm.cmd ci
npm.cmd run wasm:build
npm.cmd run perf:worker -- --reps 10 --viewport 1280x720 --out docs/performance/results/<date>-e25ec01-run0a-worker-1280x720
```

The run's notes paste both `git status --porcelain` outputs and the patch's
SHA-256. The folder is marked `-dirty` by the harness because of the declared
patch; that is expected for RUN-0a only. Send the results folder and the
console log to the coordinator. A passing run meets the machine state and the
GPU renderer above and reproduces the 1280x720 reference run
(`2026-10-15-e25ec01c-worker-1280x720`): TypeScript near 702 ms and WASM near
830 ms, each inside that run's committed interval ([670, 734] and [786, 971]).
The earlier 640x360 run (`2026-10-15-e25ec01-worker`, 705 and 806) used another
viewport and is not the rule's reference; its WASM interval ([791, 830]) is
narrower, and a run is reported against both when a reader asks.

### RUN-0b, exact steps

Run it after #1124 (the harness with the cost split) is merged. A/A mode has
landed. The shape:

```powershell
git -c core.autocrlf=false clone https://github.com/maniator/verticopolis.git "C:\Users\nafta\projects\vc-run0b"
cd "C:\Users\nafta\projects\vc-run0b"
git checkout <main-sha>
git status --porcelain
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
npm.cmd ci
npm.cmd run wasm:build
npm.cmd run perf:worker  -- --reps 10 --viewport 1280x720 --out docs/performance/results/<date>-<sha>-run0b-worker-1280x720
npm.cmd run perf:compare -- --reps 10 --skip-build --out docs/performance/results/<date>-<sha>-run0b
# A/A passes: as many per engine as section 6.1 step 3 asks for (an open amendment to OD-4), same flags.
# Calibrate them with:
# npm.cmd run perf:calibrate -- <folders> --out docs/performance/results/<date>-<sha>-calibration
npm.cmd run perf:compare -- --aa ts   --reps 10 --skip-build --out docs/performance/results/<date>-<sha>-run0b-aa-ts-1
npm.cmd run perf:compare -- --aa wasm --reps 10 --skip-build --out docs/performance/results/<date>-<sha>-run0b-aa-wasm-1
```

Before the 10-rep commands, set the settled browser variables (the owner's
decision for #1115; section 1 "Which browser counts") and run `npm.cmd run
perf:worker -- --quick --reps 1 --scenarios <one>` once to read the console's
renderer line. The 10-rep commands start only after it names a hardware adapter. Both
harnesses repeat the check before they build and stop on anything else.

Start RUN-0b only after A5's design rule is committed (plan section 5.2).
RUN-0b also records the shipping host's main-thread cost split and each
hour's churn, both from `perf:compare`:

- **Cost split.** The hosted WASM scenarios run once more with a timer on the
  engine's tick, on every other export the host calls and on `JSON.parse`.
  The report lists, as shares of that pass's step time, the engine step
  (`share in the engine's tick`), the hourly serialize, the per-step sync
  reads (every export except tick and serialize), `JSON.parse`, and the merge
  and the rest of host JS. Within one pass the five add up to one. The
  report shows the median of each across repetitions, and medians do not add
  up exactly, so the five rows can sum to a little under or over one.
  `results.json` keeps every export's call count and time
  (`attribution.byExport`). Only the outermost wrapped call is timed and
  `JSON.parse` is timed outside the wrapped exports, so no time lands in two
  parts. Each part is clamped into the category it belongs to, so the five add
  up to one even when timer noise makes them overlap. Host JS that a per-step
  sync does outside an export call lands in "merge and the rest". The wrappers
  cost time, and the per-call timer weighs more on a part with many small
  calls (`JSON.parse`), so the shares are approximate. The timed passes run
  separately and carry no timers.
- **Churn.** The "Hourly save churn" section is the share of the save's unit
  text that changes from one in-game hour to the next on the WASM engine in
  Node. The denominator is the unit text of the later hour's save plus the text
  of units that disappeared since the earlier hour (a unit that disappears
  counts as changed at its old size). The hours are 60 in-game minutes of steps counted from the end of
  the warm-up steps, so they start where the scenario starts and not at a clock
  hour (the medium tower starts at :57.47). Every window holds one hour pass,
  at the same position, but that position is the scenario's own. A step that
  does not divide an hour is refused. The character counts leave out the keys
  and punctuation between units, so they are smaller than the serialized
  save. The unit definition is in `src/tests/perfCompare/churn.ts`. This
  is a different measure from `perf:worker --read-model` in
  `docs/architecture/read-model-deltas.md`, which counts changed units per
  merge on the TypeScript engine. A5's design rule reads RUN-0b's WASM
  numbers on the large tower.

## 8. After a run

1. Validate the folder (section 4), then compare the identity (section 3).
2. Commit the folder on a branch through a PR. The PR body names the command,
   the machine state notes, the validation result and the verdict against the
   pass rule in section 6, written before the run. An A/A folder has no
   verdict; its PR names the command, the validation result and the pass
   number.
3. A run's report never claims more than its folder shows. Anything that
   rests on clamped frames says so.
