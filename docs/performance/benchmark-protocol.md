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
`--resume` refuses a change of any of them. `perf:calibrate` (not yet, #1124)
will refuse passes that differ in them and passes without a verified GPU.

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
  process that died mid-run looks.

A `--quick` smoke run turns the first four into warnings so the cloud smoke
still works, and its report says at the top that no frame row in it is GPU
evidence. A register exception turns the first three into warnings (below) and
leaves the missing renderer an error. The last two stay errors in every mode,
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
testing or benchmarking; every browser and editor window closed; the ChatGPT
desktop app and the NVIDIA Overlay closed; no antivirus scan running. Sample
the idle CPU load just before the start and record it in the notes. Note
anything unusual (a Windows update pending, thermal state) in the run's
notes. The harness records CPU, memory, OS build, GPU, Node, Rust,
wasm-bindgen, Playwright and browser versions in `results.json`.

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
   patch (section 7). The notes paste `git status --porcelain` and the patch's
   SHA-256. Not yet: the harness does not record the declared patch's SHA-256
   or the porcelain output itself; B3's harness PR adds both.

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
first scenario's rows are not. The committed folder `2026-10-14-01c6153`, the
figures that `ts-vs-wasm.md` takes from it, and the #1051 PC passes (see the
reading notes in #1139) are such results. Re-run before citing a cross-engine
ratio on a scenario after the first.

| Command (PowerShell) | What it measures |
| --- | --- |
| `npm.cmd run perf:worker -- --reps 10 --viewport 1280x720 --out docs/performance/results/<date>-<sha>-<label>-worker-1280x720` | Bare engine, the four hosts, frames, memory and traffic. Always pass `--viewport 1280x720`: the harness default is 640x360, and the committed desktop acceptance run (`2026-10-15-e25ec01c-worker-1280x720`) used 1280x720. `perf:compare` renders at 1280x720 fixed and has no `--viewport` flag |
| `npm.cmd run perf:compare -- --reps 10 --skip-build --out docs/performance/results/<date>-<sha>-<label>` | Startup, hosted and bare engine, frames with and without audio, memory, transfer and build sizes. Run it after `perf:worker`; `--skip-build` checks the builds on disk are this commit's |

Other flags both accept: `--quick` (a 2-rep smoke test that never counts),
`--resume DIR` (continue a run that stopped; it keeps its own folder, and an A/A folder resumes with `--aa <engine>` repeated),
`--scenarios a,b`. `perf:compare` also takes `--throttles 1,4` and
`--aa ts|wasm` (section 6.1);
`perf:worker` also takes `--read-model` (Node only, no browser).

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
  for frame rates. Not yet: `perf:worker`'s report still leads with
  TypeScript ÷ WASM (its `ratios.csv` has both) and `perf:compare` already
  prints WASM ÷ TypeScript. B3's harness PR makes both lead with the gate's
  orientation. Until then, invert before comparing to a pass rule.
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

| # | Metric | Scenarios | Pass rule |
| --- | --- | --- | --- |
| M1 | Bare engine, 720 steps | medium, large; 1x, 4x | Ratio upper bound at most 1 + δ |
| M2 | Hosted main-thread time, 720 steps | medium, large; 1x, 4x | As M1 |
| M3 | Frame time p99, and 1% low FPS | medium, large; 1x, 4x | As M1, for each |
| M4 | Main-thread blocking (long tasks past 50 ms) | large; 1x, 4x | Paired difference upper bound at most ε |
| M5 | Cold start to ready | 1x, 4x | Paired difference upper bound at most that throttle's ε |
| M6 | Peak JS heaps plus WASM linear memory | large; 1x, 4x | Ratio upper bound at most 1.25 (a memory ceiling, outside δ) |
| M7 | 5,000+ population fixture in `npm run perf` | CI | A CI tripwire, read on the candidate commit's CI run. Not a desktop metric |
| M8 | Scripted build-and-demolish scene (PF2) | large; 1x, 4x | Frame p99 as M1, long tasks as M4. Own δ and ε, fixed when PF2 lands |

M5 replaces the old fixed 500 ms cold-start allowance, which would let a
measured regression pass. A failed verdict stands: a run is repeated only
after a code change or a recorded cause.

### 6.1 Calibrating δ and ε (A/A passes)

An A/A pass runs the same engine in both slots (`wasm` against `wasm`, `ts`
against `ts`) with the verdict runs' repetition count. Identical engines
straddle 1.0, so a tolerance of zero could never pass; the A/A spread is the
noise the tolerance has to cover.

1. Run **at least five A/A passes per engine**, at 1x and 4x, each with 10
   repetitions, on the medium and large scenarios.
2. Each ratio family gets its own δ: M1 and M2 (times), M3 (frames). The
   value is the smallest round number that clears the largest A/A upper bound
   across both engines and both throttles. ε does the same for the paired
   differences: one ε for M4's long tasks, and one for M5's cold start at each
   throttle.
3. **Exceedance check.** With the pass count chosen, estimate how often a
   stable harness would exceed each tolerance: the share of A/A passes whose
   upper bound lands above the candidate value, leaving one pass out in turn
   (leave-one-out, so the pass that sets the tolerance cannot vouch for
   itself). Add passes until that share is **under 5%** for every family.
   With five passes, one exceedance is 20%, so five is the floor and the usual
   answer is more.
4. **Caps.** A δ above **0.05**, a long-task ε above **50 ms** of blocking
   (one 100 ms task), or a cold-start ε above **5% of TypeScript's median cold
   start** at that throttle is not adopted. Add repetitions or remove the
   noise source and calibrate again. After two rounds that still miss the
   cap, the coordinator takes it to the owner.
5. The calibrated values are fixed before RUN-1 and committed in the
   calibration run's folder.
6. RUN-3 repeats one A/A pass per engine beside the verdict. An A/A pass
   outside δ or ε goes to the owner, who decides whether RUN-3 stands.

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

Two limits are open, so the calibration is not complete:

- **δ and ε are adopted only from the calibration summary** that applies steps
  1 to 4 to a set of A/A folders (follow-up #1110). RUN-0b may collect the
  folders. Nobody reads values off them by hand.
- **M4's ε has no A/A source yet.** `perf:compare` measures no long tasks and
  `perf:worker` has no `--aa` (follow-up #1111), so the long-task ε stays
  uncalibrated until that lands. RUN-1 needs M4, so #1111 and its A/A passes
  land before RUN-1, either inside RUN-0b or as a follow-on campaign.
- **The harness for each metric.** The reference figures of RUN-0a come from
  `perf:worker`, and the calibration summary reads `perf:compare` folders. A
  tolerance calibrated on one harness's noise is not applied to the other's
  ratios, so the summary calibrates per harness and the table in section 6
  names the harness for each metric (recorded in #1110).

## 7. Scheduled runs

| Run | Commit | Purpose |
| --- | --- | --- |
| RUN-0a | `e25ec01` | Does the desktop reproduce 702 ms (TS) and 830 ms (WASM) on the large tower's 720 bare steps at 1x, inside the committed intervals? |
| RUN-0b | `main` once PRs #1097, #1098 and the cost-split harness PR are merged, and A5's design rule is committed | The baseline later runs compare with: the shipping host's cost split and each hour's churn, and the A/A passes of section 6.1 (folders only; the values come from the calibration summary, #1110) |
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

Run it after the harness PR with the cost split is merged. A/A mode has
landed; that PR's description completes the commands. The shape:

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
# A/A passes: five or more per engine, same flags
npm.cmd run perf:compare -- --aa ts   --reps 10 --skip-build --out docs/performance/results/<date>-<sha>-run0b-aa-ts-1
npm.cmd run perf:compare -- --aa wasm --reps 10 --skip-build --out docs/performance/results/<date>-<sha>-run0b-aa-wasm-1
```

Before the 10-rep commands, set the settled browser variables (the owner's
decision for #1115; section 1 "Which browser counts") and run `npm.cmd run
perf:worker -- --quick --reps 1 --scenarios <one>` once to read the console's
renderer line. The 10-rep commands start only after it names a hardware adapter. Both
harnesses repeat the check before they build and stop on anything else.

Start RUN-0b only after A5's design rule is committed (plan section 5.2).
RUN-0b also records the shipping host's main-thread cost split (engine step,
per-step sync, hourly serialize, parse and merge) and each hour's churn. Not
yet: the harness reports the first three partly (`perf:worker` times the
hosts; the split into sync, serialize and merge is B3's harness PR).

## 8. After a run

1. Validate the folder (section 4), then compare the identity (section 3).
2. Commit the folder on a branch through a PR. The PR body names the command,
   the machine state notes, the validation result and the verdict against the
   pass rule in section 6, written before the run. An A/A folder has no
   verdict; its PR names the command, the validation result and the pass
   number.
3. A run's report never claims more than its folder shows. Anything that
   rests on clamped frames says so.
