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

A run records the browser it used and only compares runs made with the same
one. For acceptance runs:

1. **Playwright's bundled Chromium** (the default when `PW_CHROMIUM_PATH` is
   unset; install once with `npx.cmd playwright install chromium`). This is the
   engine the committed Windows runs used and the one the protocol assumes.
2. An installed Chrome through `PW_CHROMIUM_PATH` is allowed for a one-off
   check, and its results folder says so. It is never mixed into a comparison
   with a bundled-Chromium run, because the version and flags differ.

Headless is the harness's default and the only mode that counts. The report
header records the exact browser version.

**The renderer must be the GPU.** The 2026-10-15 reference runs recorded ANGLE
on Direct3D 11 with the RTX 3060. RUN-0a (2026-10-20) ran the same bundled
Chromium 149 headless on ANGLE with Vulkan SwiftShader, which is software
rendering. That makes FPS, 1% lows, frame-time p99 and every frame-bound part
of M1 to M8 invalid, and it may have moved the bare-step rows too (see the
folder's `READING.md`). Not yet: the harness does not choose or check the
renderer (follow-up #1115). Until it does, read the report's Renderer line
before accepting any run, and reject a run whose renderer names SwiftShader,
llvmpipe or any other software rasterizer.

### Machine state

AC power; Windows in its best-performance power mode; nothing else building,
testing or benchmarking; every browser and editor window closed; the ChatGPT
desktop app and the NVIDIA Overlay closed; no antivirus scan running. Sample
the idle CPU load just before the start and record it in the notes. Note anything unusual (a Windows update pending, thermal state)
in the run's notes. The harness records CPU, memory, OS build, GPU, Node, Rust,
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

| Command (PowerShell) | What it measures |
| --- | --- |
| `npm.cmd run perf:worker -- --reps 10 --viewport 1280x720 --out docs/performance/results/<date>-<sha>-<label>-worker-1280x720` | Bare engine, the four hosts, frames, memory and traffic. Always pass `--viewport 1280x720`: the harness default is 640x360, and the committed desktop acceptance run (`2026-10-15-e25ec01c-worker-1280x720`) used 1280x720. `perf:compare` renders at 1280x720 fixed and has no `--viewport` flag |
| `npm.cmd run perf:compare -- --reps 10 --skip-build --out docs/performance/results/<date>-<sha>-<label>` | Startup, hosted and bare engine, frames with and without audio, memory, transfer and build sizes. Run it after `perf:worker`; `--skip-build` checks the builds on disk are this commit's |

Other flags both accept: `--quick` (a 2-rep smoke test that never counts),
`--resume DIR` (continue a run that stopped; it keeps its own folder),
`--scenarios a,b`. `perf:compare` also takes `--throttles 1,4`;
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

Not yet: the harness has no A/A mode and no calibration script. B3's harness
PR adds `--aa ts|wasm` (the engine in both slots, tagged in `results.json` so
it can never be read as a verdict) and a calibration summary that applies the
steps above to a set of A/A folders.

## 7. Scheduled runs

| Run | Commit | Purpose |
| --- | --- | --- |
| RUN-0a | `e25ec01` | Does the desktop reproduce 702 ms (TS) and 830 ms (WASM) on the large tower's 720 bare steps at 1x, inside the committed intervals? |
| RUN-0b | `main` once PRs #1097, #1098 and the harness PR are merged | The baseline later runs compare with: the shipping host's cost split and each hour's churn, and the A/A passes of section 6.1 |
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
console log to the coordinator. A passing run reproduces the two committed
desktop runs: TypeScript near 702 ms and WASM near 830 ms, each inside the
committed interval.

### RUN-0b, exact steps

Run it only after the harness PR with A/A mode and the cost split is merged;
the commands are completed in that PR's description. The shape:

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
# A/A passes (not yet): five or more per engine, same flags
npm.cmd run perf:compare -- --aa ts   --reps 10 --skip-build --out docs/performance/results/<date>-<sha>-run0b-aa-ts-1
npm.cmd run perf:compare -- --aa wasm --reps 10 --skip-build --out docs/performance/results/<date>-<sha>-run0b-aa-wasm-1
```

RUN-0b also records the shipping host's main-thread cost split (engine step,
per-step sync, hourly serialize, parse and merge) and each hour's churn. Not
yet: the harness reports the first three partly (`perf:worker` times the
hosts; the split into sync, serialize and merge is B3's harness PR).

## 8. After a run

1. Validate the folder (section 4), then compare the identity (section 3).
2. Commit the folder on a branch through a PR. The PR body names the command,
   the machine state notes, the validation result and the verdict against the
   pass rule in section 6, written before the run.
3. A run's report never claims more than its folder shows. Anything that
   rests on clamped frames says so.
