# Design: version-consistent engine caching (#985, criterion 5)

- **Date:** 2026-10-15
- **Status:** APPROVED for implementation as of 2026-10-15 (Web Game Room
  party GO and owner decisions; see section 10). Revised 2026-10-16 to
  2026-10-20 per the owner's review comments on PR #1047. The additions after
  the GO (the **Repair engine files** action, the `no-save-writer` reason,
  the reason and copy matrix, the byte-cap and deadline rules, the HTTP
  fixture server and e2e specs 7 to 9) are planning-only and have not been
  re-reviewed by the room; the mandatory review of this revision gates the
  implementation PR.
- **Issue:** #985, acceptance criterion 5 ("Version-consistent engine
  caching"). #985 stays open; this document covers one criterion of it.
- **Plan:** cutover story S16 and the Deployment gate row
  (`_bmad-output/planning-artifacts/rust-wasm-web-cutover-plan-2026-10.md`,
  sections 5 to 7; owner decision 6). Gate issue #945.
- **Related:** #874 (fallback with a recorded reason), #963 (About and Copy
  Diagnostics show the mismatch state; it reads this check and builds no
  second one), #979 (`perf:compare` counts precache URLs).
- **Review routing for the implementation:** `/bmad-code-review` (service
  worker, precache, build tooling) and `/gds-code-review` (the engine boot
  check), per #985.

## 1. The criterion, restated

The engine glue (`engine/verticopolis_engine.js`), the binary
(`engine/verticopolis_engine_bg.wasm`) and `engine/BUILD.json` are precached
as one set from one build. The cached files' hashes match `BUILD.json`. After
an update, the page never runs a glue with a binary or a shell from another
build. A mismatch refuses the package and reports the fallback (#874, #963).
The page never runs a mismatched package.

"Shell" here means the app's own JavaScript (the hashed chunks in `assets/`
that `index.html` loads), which holds the host, the frame reader and the
command relay that speak to one exact binding.

## 2. What main does today

- **Package build.** `scripts/wasm-build.ts` (run by
  `scripts/build-engine-wasm.sh` on every Vercel deploy and in CI) writes
  `src/public/engine/` with the glue (about 46 KB), the binary (about
  1.4 MB), `BUILD.json` and `THIRD-PARTY.json`. Vite copies the folder to
  `dist/engine/` unchanged, so the names carry no content hash.
- **`BUILD.json`** is `{ "sources": "<sha256 of the Rust sources>" }`
  (`engineSourceHash` in `src/wasmhost/packageHash.ts`). It describes the
  sources only. Nothing records a hash of the glue or the binary themselves
  (`THIRD-PARTY.json` records the binary's SHA-256, for the notices). CI's
  package cache (`.github/actions/engine-wasm`) reads `.sources`.
- **Precache.** `vite.config.ts` uses vite-plugin-pwa `generateSW`
  (Workbox 7.4.1) with
  `globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,mp3,wasm}"]`.
  Since 2.32.0 the glue and the binary are precached. `BUILD.json` is
  excluded (no `.json` in the glob), marked `runtime: false` in
  `src/wasmhost/engineAssets.ts`. Each unhashed entry gets a Workbox
  `revision` (an MD5 of the file). No entry carries `integrity`.
- **Build checks.** `scripts/verify-precache.ts` (postbuild) fails when a
  run-time engine file is missing from the manifest, when a build-only one
  is in it, when `dist/engine/` holds an unlisted file, and when the
  precache exceeds 4 MiB (about 2.9 MiB today).
- **Load.** `loadWasmEngine` in `src/wasmhost/startWasmHost.ts` imports the
  glue by URL (`import(/* @vite-ignore */ url)`), then calls its default
  `init()`, which fetches the binary beside itself
  (`new URL("verticopolis_engine_bg.wasm", import.meta.url)`), and
  `checkBinding` checks that the expected methods exist. No byte or version
  check happens. The dual run's worker (tooling only) loads the same URL.
- **Fallback.** `loadBootEngine` in `src/wasmhost/engineBoot.ts` records a
  load failure as `{ stage: "load", message }` on `window.__vcEngineBoot`.
  A switchable build falls back to the TypeScript engine; a wasm-only build
  shows the engine failure screen (`showEngineFailure`, copy from
  `engineFailureCopy`) and registers the worker so a waiting update
  activates at once.
- **Update flow.** `src/pwa.ts`: `registerType: "prompt"`, no
  `clients.claim`; a new worker waits until the player picks "update now"
  (`updateSW(true)`: skip waiting, then reload) or every tab of the old
  version closes. `version.json` (never precached, `no-store`) is polled
  hourly and on focus to label the prompt. `cleanupOutdatedCaches` is on.
- **Hosting.** `vercel.json` sets `immutable` on `/assets/*`, `no-cache` on
  `sw.js` and `no-store` on `version.json`. `/engine/*` has no header of its
  own, so it gets Vercel's default for static files (`public, max-age=0,
  must-revalidate`; confirm against a live response during implementation).
- **e2e.** `e2e/offline.spec.ts` and `e2e/offlineColdStart.spec.ts` (with
  `e2e/offlineHelpers.ts`) prove the glue and binary are in the precache and
  that a fresh offline session runs the engine. Nothing checks that the
  cached files belong together.

## 3. Threat model: which mixes can happen

Facts the analysis rests on (read from `workbox-precaching` 7.4.1):

- Precache cache keys carry the revision (`?__WB_REVISION__=<md5>`), and all
  versions share one cache. A waiting worker writes its own keys beside the
  active worker's keys, so the active worker keeps serving its own set.
- `install()` fetches entries **one at a time**, in manifest order.
  Revisioned entries are fetched with `cache: "reload"`, which skips the
  HTTP cache. In a current `dist/sw.js` the order is the icons,
  `index.html`, the binary, the glue, the audio files, then `assets/` and
  `manifest.webmanifest`. The order is Workbox's glob order and nothing
  in this repository pins it.
- Workbox never compares a fetched body with its revision. A body is stored
  under whatever revision the manifest names.
- On activate, keys missing from the new manifest are deleted.
- A precache miss falls back to the network. With an `integrity` value in the
  manifest, both the install fetch and that fallback fetch carry it, so the
  browser rejects a body whose hash differs.
- Activation through skip-waiting moves every page the old worker controlled
  to the new worker (the service worker spec's Activate step), whatever shell
  those pages run.

| # | Route | Can it happen? | What mixes | Result today |
| --- | --- | --- | --- | --- |
| R1 | **Install overlapping a deploy.** `sw.js` comes from build A; the alias moves to build B partway through the sequential install (2.9 MiB, seconds on a slow link). | Today it is mostly blocked by two accidents: the engine files are fetched before `assets/`, and the main chunk's name changes on every commit (`__APP_SHA__` is compiled in), so A's chunks 404 on B and the install fails. It reopens when the glob order changes, when a deploy rebuilds the same commit with different engine bytes (a toolchain change), or if old deployments' assets stay reachable (Vercel's skew protection, if it is ever turned on). | Shell A with engine B stored under A's revisions, or binary A with glue B when the switch lands between the two engine fetches. Lasts until the next worker installs. | Runs the mix. A LinkError only when the import sets differ; with matching import sets the wrong engine runs quietly. |
| R2 | **Uncontrolled page.** First visit, Shift-reload (bypasses the worker), a browser or private window without service workers, or an origin with no worker yet. Every file comes from the network. | Yes, in a short window: a deploy that lands between the shell's chunks and the glue, or between the glue and the binary. | Shell A with engine B, or glue A with binary B. | Runs the mix. |
| R3 | **Activation during another page's boot.** Tab 1 picks "update now"; tab 2 is between importing the glue and fetching the binary, or has not imported the glue yet. | Yes, rare. | Tab 2's shell A (and maybe glue A) with binary B from the new worker (A's keys were deleted). | Runs the mix, or fails with a LinkError. |
| R4 | **Waiting worker beside an active one.** | Safe: separate cache keys. The active worker serves only its own set. | None. | Covered by Workbox. |
| R5 | **HTTP cache.** | Low. `/engine/*` revalidates on every use (default `max-age=0`), and the install skips the HTTP cache. A proxy that ignores the headers could still serve old bytes to an uncontrolled page. | Like R2. | Runs the mix. |
| R6 | **A precache entry missing** (DevTools, an extension, a partial clear; browsers evict a whole origin at once, so ordinary eviction removes the set together). | Rare. | The missing file comes from the live deploy. | Runs the mix. |
| R7 | **A worker from before 2.32.0.** It never precached the engine, so its shell takes whatever engine the network serves. | Yes, until that player updates. Those shells are switchable builds, and the WASM engine runs there only when the player opted in. | Old shell with the current engine. | Runs the mix. Code that shipped before this design cannot be changed, so only a server-side change (a new package name) could make those shells refuse. |
| R8 | **A long-lived tab across a deploy.** | Safe while the page lives: the module loads once at boot, and every later tower (`adoptSim`) reuses it. On reload it is R1 to R3. The dual run's worker loads the URL again later (tooling only). | None until reload. | Covered. |
| R9 | **Build pipeline.** `BUILD.json`, glue and binary written by different runs. | Low: `wasm-build.ts` deletes the folder and writes all files in one run, and CI's cache stores the folder as a unit. Nothing proves it in `dist/`. | Any. | Not checked. |

The routes that need a fix are R1, R2, R3, R5, R6 and R9. R7 is the one
route that new code cannot reach on the client.

## 4. Options considered

### A. Content-hashed engine file names

Emit `verticopolis_engine.<hash>.js` and `verticopolis_engine_bg.<hash>.wasm`,
either by letting Vite own the package (import the glue and `?url` the binary
so both land in `assets/`) or by a post-build rename that also rewrites the
binary name inside the glue. The shell names the exact files it needs.

- **Proves:** names bind the shell to the glue and the glue to the binary,
  so on an honest host no route can pair files from two builds. An old
  shell's request for its own hashed name after a deploy gets a 404 and
  fails as a load error. Old names served unchanged also stop R7 shells from
  loading a new engine (they ask for the unhashed name, which would no
  longer exist).
- **Costs:** changes the package layout that `engineAssets.ts`,
  `enginePackageNames.ts`, `verify-precache.ts`, `wasm-build.ts`, the dual
  run, `perf:compare`'s `categorize` (`engine/` prefix), the e2e helpers and
  `VC_ALLOW_NO_ENGINE` builds (Vite would need a stand-in module) all depend
  on. A glue rewrite needs its own guard. `BUILD.json` keeps a fixed name
  and gains no tie of its own.
- **Fails when:** the host serves other bytes under a name (a corrupted edge
  copy, a hand-edited deploy, a test harness); nothing reads the bytes. A
  404 reports a generic load failure, with nothing that names the mismatch.

### B. Check the fetched bytes against digests compiled into the shell

At build time, read the digests of the glue and binary and compile them into
the shell. At boot, fetch `BUILD.json`, the glue and the binary as bytes,
hash them with `crypto.subtle.digest("SHA-256")`, compare, and only then
instantiate, from the same bytes that were hashed: the glue through a Blob
URL module import, the binary through `init({ module_or_path: bytes })`.

- **Proves:** the exact glue and binary bytes this page is about to run are
  the ones its own shell was built with. Covers every route, since it checks
  what arrived and ignores how it arrived (R1 to R3, R5, R6).
- **Costs:** about 1.45 MB hashed per boot (a few milliseconds on a desktop;
  an estimate to measure on a slow phone); one extra copy of the binary in
  memory during load; the binary compiles after the download finishes, which
  removes streaming compile on an online first visit (from the precache this
  is negligible). Blob import needs a glue with no relative imports (true
  today; `glueLoads` already checks the shape). `crypto.subtle` needs a
  secure context (HTTPS or localhost). No new network request beyond
  `BUILD.json`.
- **Fails when:** it detects a mix but cannot prevent one. A player whose
  precache holds a mixed set (R1) is refused on every boot until a new
  worker installs, and in a wasm-only build that means no game while
  offline. Old shells (R7) are out of reach.

### C. A build id inside the binary, compared with the glue's and the shell's

The crate exports its build id (planned anyway for #963's
`engineIdentity()`); the shell compares it with the id it expects.

- **Proves:** the binary claims the expected build. Says nothing about the
  glue: wasm-bindgen's glue carries no id, and adding one means patching its
  output.
- **Costs:** a binding call, and the check runs after instantiate, so engine
  code has already run.
- **Fails when:** the id is the Rust source hash and the bytes changed
  without a source change (a new wasm-bindgen or Rust release, a different
  feature set): two different binaries report one id. A forged or stale
  `BUILD.json` is not caught either. Good for diagnostics (#963), weak as the
  gate.

### D. Tie the precache entries together

Two variants:

- **D1, a shared revision.** Give the three engine entries one revision (the
  package digest). Workbox still stores whatever the network returns under
  it, so R1 is unchanged. Rejected.
- **D2, `integrity` on the engine entries.** A `manifestTransforms` function
  adds `integrity: "sha256-<base64>"` computed from the built files. The
  browser rejects a body that differs, during install and on a precache-miss
  fallback. A raced install (R1) fails as a whole; the old worker and its
  consistent set stay, and the next update check installs cleanly from the
  settled deploy. A missing entry (R6) can only be refilled with the right
  bytes.
- **D2 proves:** a worker's precache holds exactly the engine bytes its
  manifest names. Runs at no cost at load (the browser checks during the
  fetch); adds about 60 bytes per entry to `sw.js`.
- **D2 fails when:** the page has no controlling worker (R2), when another
  page's update swaps the worker mid-boot (R3), and for R7. It also says
  nothing about whether the manifest matches the shell; that tie comes from
  the build.

### E. A separate engine cache per build

Keep each build's engine in its own named cache that only that build's shell
reads. This needs custom worker code (`injectManifest`), dropping the
`generateSW` setup the whole precache relies on. Rejected for its size.

## 5. Recommendation

**B and D2 together, with `BUILD.json` widened and precached.** D2 stops a
mixed set from ever entering the precache, which matters most for an offline
wasm-only player, who has no way to repair the set. B is the gate: it checks
the bytes about to run on every route and refuses a mix with a reported
reason. Option A is held back as a follow-up (open question 2); C only feeds the
diagnostics.

### 5.1 `BUILD.json`, schema 2

`scripts/wasm-build.ts` writes:

```json
{
  "schema": 2,
  "sources": "<sha256 hex of the Rust sources, unchanged>",
  "package": "<sha256 hex of the canonical JSON of the files map below>",
  "files": {
    "verticopolis_engine.js": { "sha256": "<hex>", "bytes": 46445 },
    "verticopolis_engine_bg.wasm": { "sha256": "<hex>", "bytes": 1407701 }
  }
}
```

- `sources` keeps its name and meaning, so CI's cache key and
  `packageHash.test.ts` read it as before.
- `package` is the build id for the bytes. Two builds with identical bytes
  share it; a toolchain change that alters the bytes changes it even when
  `sources` stays the same. Displays use its first 12 hex digits.
- A pure function (`engineBuildRecord(glue, wasm, sources)`) produces the
  record, so a unit test pins the shape and the canonical JSON.

### 5.2 Build time

1. **The expected record goes into the shell.** `vite.config.ts` reads
   `src/public/engine/BUILD.json` and defines `__ENGINE_PACKAGE__` as
   `{ package, files }`. It is `null` only when the package folder is
   absent and `VC_ALLOW_NO_ENGINE=1` allows that (the same rule as
   `missingEngine` in `src/precacheEntry.ts`); a record that is missing
   without the opt-in, unparsable or not schema 2 stops `vite build` at config
   time (not Vitest or a dev serve, which define `null` so `npm test` runs
   without a Rust toolchain). The value lands in the hashed shell chunk, so the shell's own name
   moves when the expected package moves.
2. **`BUILD.json` joins the precache** by its own path:
   `globPatterns` gains `"engine/BUILD.json"` (the shape
   `src/build/workboxGlob.ts` already reads), and `engineAssets.ts` marks it
   `runtime: true` in the same change. `THIRD-PARTY.json` stays out.
3. **Integrity on the three engine entries.** A `manifestTransforms` entry
   in the workbox options reads each engine file from the build output and
   adds `integrity: "sha256-<base64>"`. The other entries are unchanged (see
   open question 3 for widening it).
4. **`scripts/verify-precache.ts` gains these failures:**
   - an engine run-time entry (now three) without `integrity`, or whose
     `integrity` differs from the file in `dist/`;
   - a file in `dist/engine/` whose SHA-256 or size differs from
     `dist/engine/BUILD.json`;
   - a `package` that does not match the `files` block;
   - a shell that does not carry the same `package` id: the chunk
     `index.html` boots must carry it, and every emitted chunk that carries
     an id (the dual run's worker chunk can too) carries this one;
   - a glue that loads anything beside itself other than the binary
     (`glueLoads`), since the Blob import cannot resolve a relative import.

### 5.3 Run time

`loadWasmEngine` becomes "fetch, verify, then instantiate". The verification
lives in a small module (`src/wasmhost/enginePackageCheck.ts`) with
injected `fetch` and `digest`, so the unit tests run in Node:

1. If `__ENGINE_PACKAGE__` is `null`, refuse: "this build carries no engine
   package", with `load-failed` (the message names the missing package).
2. If `crypto.subtle` is missing (an insecure context), refuse with reason
   `unverifiable` (open question 4).
3. Fetch `engine/BUILD.json`, the glue and the binary in parallel, each with
   the browser's default cache mode (a controlled page reads the precache),
   under one `AbortController` that the load timeout also aborts. A network
   error, a status other than 200, a redirect to another origin, or an HTML
   content type (a captive portal page) is a load failure (`load-failed`),
   kept apart from a mismatch. Any other 200 body that fails the digest in
   step 5 is a `mismatch`. A digest call that rejects or throws is
   `unverifiable`. Read bodies through a bounded stream reader, before
   concatenating chunks: `BUILD.json` has a fixed 16 KiB cap, and glue and
   binary have their exact sizes from the compiled record as caps. Reject
   an excessive `Content-Length` early, but count actual bytes even when
   the header is absent or false. On overflow cancel the reader, abort
   sibling fetches and refuse with `mismatch`. An unavailable stream refuses
   with `load-failed`; do not use an unbounded `arrayBuffer()` fallback.
4. Parse an HTTP-successful `BUILD.json`. Empty, unparsable, not schema 2, or a `files`
   block that does not name exactly the glue and the binary: refuse
   (`mismatch`, with the served id unknown when there is none). A size
   that differs from either record refuses before hashing. A stream that
   ends before the expected byte count is interrupted (`load-failed`); a
   complete body of another size is a `mismatch`. A missing HTTP
   resource (including 404) was already classified as `load-failed` in
   step 3; an HTTP 200 with an invalid or incomplete record is `mismatch`.
   Validate digest syntax (64 lowercase hex digits), finite nonnegative
   integer byte counts, and the exact two file names before using fields.
5. Hash the glue and the binary. Refuse (`mismatch`) when either digest
   differs from `__ENGINE_PACKAGE__`, or when `BUILD.json`'s `package`
   differs from it. Also recompute the served record's canonical `package`
   digest from its validated `files` block, compare it with its own
   `package`, and compare each served file entry with the actual fetched
   size and digest. Preserving the expected package string while changing
   its file entries must refuse. The canonical encoding is UTF-8
   `JSON.stringify` of a newly constructed object with file keys in the
   order shown in section 5.1 and each entry's keys ordered `sha256`,
   then `bytes`, with no whitespace. Never hash the received JSON text.
   A `BUILD.json` that differs only in `sources` passes: the bytes are identical.
6. Import the glue from a Blob (type `text/javascript`) built from the
   verified bytes themselves, with no decode and re-encode in between; call
   `init({ module_or_path: wasmBytes })` with the verified binary; revoke
   the Blob URL once the import settles, whether it succeeded or not; then
   run `checkBinding` as today. No second fetch of either file happens after
   the check. A content security policy added later must allow `blob:` for
   scripts (the site sets none today).

The loader owns one deadline and a terminal attempt state shared with
`loadBootEngine`; expiry marks the attempt terminal before publishing
`timeout`. Check that state and the monotonic deadline after every await
(headers, each body chunk, digest, import, init), immediately before import
and init, and before returning the checked binding or attaching a host.
An import already running cannot be canceled. Initialization already
running may finish or even instantiate after the deadline; its result is
discarded and never published, attached, or ticked. Fetch abort alone does
not cancel those operations. Always observe late rejections, revoke Blob
URLs on eventual settlement, and release any created engine handle. No
second attempt starts automatically. The deadline bounds the wait for the
player. It cannot interrupt a synchronous browser compilation that has
already started, so the discarded engine may keep using CPU and memory
until it settles; the implementation measures that cost (condition 1).

The loader's deadline is the existing 90-second load timeout, the same one
`loadBootEngine` reports. Dev serves
(`import.meta.env.DEV`) skip the check and report `verified: false`, since
`npm run wasm:build` during a dev session would otherwise refuse the new
package until a server restart. The dual run's worker uses the same loader,
so tooling never runs a mix either. Today `engineWorker.ts` and the dual
run's worker import the glue and call `init()` themselves, so the
implementation routes both (and the worker respawn path) through the verified
loader, or hands them verified bytes; until then R8 stays open for them.

### 5.4 Fallback, diagnostics and recovery on every refusal

A refusal throws `EnginePackageMismatch` (or `EnginePackageUnverifiable`)
carrying `file` (`glue`, `wasm` or `build-record`), the expected and found
digests (12 hex digits each), the expected `package` id, the served one when
`BUILD.json` named one, and whether a worker controlled the page
(`navigator.serviceWorker?.controller != null`; `navigator.serviceWorker` is
undefined when service workers are disabled or the context is insecure, and
that must not throw before the refusal is built).

`EngineBootFailure` gains a `reason` code for the load stage:
`load-failed`, `timeout`, `mismatch`, `unverifiable` and `no-save-writer`.
The `start` and `host` stages keep their stage as the reason, and #963 maps
them to its own labels; they are outside this matrix and unchanged by this
design. `loadBootEngine` sets the code; the message stays a
plain sentence. The ids shown on the `mismatch` screen are format
arguments of the catalog string, for example "(expected 3f2a9c01d4e7,
found 91be0477aa13)".

| Build | On a load refusal (every reason except `no-save-writer`, below) |
| --- | --- |
| Switchable (today's default; WASM opt-in) | Runs on the TypeScript engine. `__vcEngineBoot` is `{ engine: "ts", failure: { stage: "load", reason, ... } }`. One `console.error`. #963 shows the fallback reason and available ids. The player can keep playing and saving with TypeScript. |
| Wasm-only (3.0.0 on) | `engine: "none"`. The engine failure screen uses the reason-specific string below, `role="alert"`, and initial focus on Reload. No host attaches. The existing waiting-update registration stays, with its single-reload guard. |

| Reason | Copy and retry policy in both builds |
| --- | --- |
| `mismatch` | "The engine files do not match this version of the game. The engine was not started." Show both package ids when known, otherwise an unavailable label. Reload is a manual retry. The **Repair engine files** action is offered whenever a worker controls the page, online or not (reachability is decided by the fetch attempt itself, see the corrupted-entry recovery rules below); on an uncontrolled page there is no worker to refetch, so only Reload is offered. |
| `load-failed` | "The engine files could not be loaded. Connect to the internet and try Reload." Covers HTTP errors, interrupted streams, import/init failures, and a missing compiled package. That last case explains that a corrected deployment is needed. Repair is offered under the same conditions as for `mismatch`. |
| `timeout` | "The engine took too long to load. Try Reload when your connection is ready." The expired attempt stays terminal. Reload starts a fresh document and attempt. |
| `unverifiable` | "This browser connection cannot verify the engine files. Open the game using HTTPS." Reload alone cannot repair an insecure context. Do not offer cache repair for this reason. |
| `no-save-writer` | Existing compatibility policy stays: a wasm-only build refuses with "The engine cannot save towers. Reload after the game is updated." A switchable build keeps its existing TypeScript save writer; this is not a package-verification failure and does not force engine fallback. The player-facing sentence is new (the existing message, "the engine package has no save writer (encodeVctower); rebuild it", reads as a developer note), so it moves into the string catalog. |

Every screen includes Copy Diagnostics, including when no module loaded.
Offline copy adds "Connect to the internet before repairing engine files."
All copy and labels come from `engineFailureCopy`, the module that holds the
existing engine failure sentences, with ids as arguments. The new Repair and
Copy Diagnostics controls render inside `#boot-fallback-host`: everything
else in the body is made inert while the failure shows.

**Corrupted-entry recovery.** A normal Reload does not repair an existing
corrupted Cache Storage response: Workbox integrity is checked on network
fetches only; a cache hit is returned as stored. The explicit online **Repair engine files**
action writes only the precache keys of the running build: the three engine
URLs under this deployment's exact origin and base path, with the Workbox
revision this shell was built for. Every worker version shares one precache,
so a waiting worker's engine entries sit beside them under other revision
keys. Repair never deletes, rewrites or repopulates those; a waiting build
keeps its own valid set and can still cold-start offline once it activates.
Restrict cache names to this app's Workbox precache namespace;
leave other applications' caches, all shell/audio entries, IndexedDB,
localStorage and saves alone. Do not unregister workers or clear site data.
Repair replaces in place and never deletes first. For each of the three
engine URLs it fetches from the network (`cache: "reload"`), checks the
bytes against the digests compiled into the shell, and only then writes the
response over the existing key. A failed fetch or digest leaves the old
entry untouched. `navigator.onLine` is not trusted: the action simply stops at
the first failed fetch and says so, and Repair stays available for retry.
That keeps a wasm-only player from losing the only local engine copy to a
flaky connection. After the writes, request one registration update check and
offer Reload; never promise that the live deployment has been repaired. A
different live deployment may still fail until its worker activates, and a
broken live deployment remains refused after repair.
Because Repair touches only the running build's keys, another tab or a
waiting install is not affected by it; their integrity checks and the page
byte gate still refuse any mix.
Repair never activates a worker itself or triggers an automatic reload.

Rules for both:

- The page adds no reload of its own on a mismatch. The player presses
  Reload, or a waiting worker activates through the existing update path
  (unchanged by this design; that path already ends in one guarded reload). This avoids a reload loop when the live
  deploy itself is broken.
- Nothing about a mismatch is sent anywhere, with one exception: S16's
  consented fallback-use counter, when it exists, receives the `reason` code
  only. That counter covers opt-in players on the switchable build, so
  decision 2 reads a bounded sample.
- Copy Diagnostics (#963) copies the reason, both ids and the `controlled`
  flag. They hold no personal data.

### 5.5 How each route ends up

| Route | After this design |
| --- | --- |
| R1 install overlapping a deploy | The integrity check fails the install; the old worker stays with its set, and the next update check installs B. On a first install there is no old worker: the page stays uncontrolled (so B covers it) and the next visit installs again. If the race hits `index.html` (unprotected), B's shell meets A's verified engine and B refuses it until B's worker installs, which the boot's own update check starts. |
| R2 uncontrolled page | B refuses; a reload fetches a consistent set. |
| R3 activation mid-boot | B refuses; a reload runs the new shell with its own set. |
| R5 HTTP cache | B refuses. |
| R6 missing entry | D2 refills it only with matching bytes; otherwise the fetch fails and the load is refused as `load-failed`. |
| Corrupted existing entry | The page refuses with `mismatch`; only explicit online repair rewrites the engine cache keys, and only with bytes that match the compiled digests. A subsequent matching refetch may recover; Reload alone is not promised to recover. |
| R7 pre-2.32.0 shell | Unchanged until that player updates. Opt-in players only, on a switchable build. |
| R9 build pipeline | `verify-precache.ts` fails the build. |

## 6. Test plan

### 6.1 Unit (Vitest, Node)

- `engineBuildRecord`: the shape, canonical `package` digest, and `sources`
  carried through.
- `enginePackageCheck`, with an injected fetcher and digest:
  - a stream that ends early gives `load-failed`; a redirected or non-200
    response gives `load-failed`; a 200 body of the wrong bytes gives
    `mismatch`;
  - a matching set passes, and the instantiate step receives the same
    buffers that were hashed (the fetcher counts calls: one per file);
  - a glue mismatch, a binary mismatch, a `BUILD.json` naming another
    `package`, and an HTTP-successful `BUILD.json` empty, unparsable or schema 1 each refuse
    with the right `file` and both ids;
  - `BUILD.json` differing only in `sources` passes;
  - a fetch failure or HTTP 404 for each file gives `load-failed`, kept apart from `mismatch`;
  - a forged `files` block retaining the expected package id refuses;
    canonical serialization ignores received field order and whitespace;
  - oversized record/glue/binary bodies refuse before buffering, with and
    without `Content-Length`, including a false small header; the exact cap
    passes and cap plus one fails, with reader cancellation and sibling abort;
  - expiry during fetch, digest, deferred import and deferred init publishes
    one `timeout`; resolving or rejecting later never publishes a module,
    attaches a host, ticks, logs an unhandled rejection, or leaks a Blob URL;
  - no `crypto.subtle` gives `unverifiable`; `__ENGINE_PACKAGE__ === null`
    refuses;
  - `navigator.serviceWorker` undefined (service workers disabled or an
    insecure context) still yields the `unverifiable` refusal with the
    diagnostics `controlled: false`, not a TypeError;
  - a fetcher that returns glue A, then binary B (the R3 shape) refuses.
- `engineBoot`: every reason in section 5.4 in both build modes, including
  existing switchable save-writer behavior; reason-specific copy online and
  offline, unavailable ids, alert role, focus and Copy Diagnostics.
- Repair: exact base-path/cache-namespace selection, the running build's
  revision keys only (other revision variants, including a waiting worker's,
  untouched),
  a failed or digest-failing fetch leaving the old entry untouched, a
  failure partway through the three files, failed update check, and no
  saved-data mutation.
- A production-bundle test: the `import.meta.env.DEV` skip is compiled out
  (condition 4), by building with `vite build` and asserting the loader chunk
  carries the check unconditionally.
- `verify-precache` helpers (pure functions moved beside
  `src/precacheEntry.ts`): a missing or wrong `integrity`, a `dist/engine`
  file that differs from `BUILD.json`, a shell chunk carrying another id,
  and `BUILD.json` absent from the manifest.
- `engineAssets.test.ts`: `BUILD.json` is `runtime: true` and the glob
  covers it by path.
- `src/tests/perfCompare/bundle.test.ts`: `precacheUrls` parses entries that
  carry `integrity` in either key order (today's second pattern requires
  `url` to be the last key and would miss them).

### 6.2 e2e (Playwright, production build, `chromium-wasm` and `chromium-wasm-only`)

How to manufacture a mismatched set:

- **Salted binary.** Append a valid WebAssembly custom section (id `0`, a
  name such as `vc-test-salt`, a few bytes) to the built binary. It still
  validates and instantiates with the same imports, so only the byte check
  can stop it. A salted glue is the glue plus a trailing `// salt` comment.
  A helper in `e2e/offlineHelpers.ts` does both in memory.
- **Second build.** A CI step copies the package aside, salts it, rewrites
  its `BUILD.json`, runs a second `vite build` into `dist-b/` (the define
  and the shell chunk hash change with it, and so does `sw.js`), and
  restores the package. Use a same-origin HTTP fixture server that can
  switch its document root from `dist/` to `dist-b/` at the "deploy" moment
  and override individual engine responses. It must observe both page and
  service-worker requests; do not depend on `page.route` or `context.route`
  intercepting worker requests. Each response snapshots its root at request
  arrival so a switch cannot change a streaming response halfway through.

Specs:

1. **The cache matches `BUILD.json`.** After the online install, read the
   three precached responses from Cache Storage, hash them in the page, and
   compare with `BUILD.json` and the shell's expected id (#985 test 4, first
   half).
2. **A tampered precache is refused.** Overwrite the binary's precache entry
   with the salted binary through `caches.open()` and `cache.put()` under
   the same key, reload, and assert no instantiate happened, the boot state
   says `mismatch` with both ids, a switchable build runs on TypeScript, and
   a wasm-only build shows the mismatch screen. Repeat for the glue.
3. **Uncontrolled mix.** With `serviceWorkers: "block"`, route the binary to
   the salted copy; assert the same refusal.
4. **Install race.** Serve A's `sw.js` and route `engine/*` to B's bytes
   during the install. Assert the new worker becomes redundant, the old
   set still serves and boots the engine, and no cache key holds B's engine
   bytes under A's revision.
5. **Update moves the set together.** Install A, switch to B, trigger the
   update check, accept the prompt, then assert the shell's id, the cached
   files and `BUILD.json` are all B and that no A engine key remains in the
   cache (this also covers #985 criterion 7's "old engine caches removed").
   Then go offline and cold start: B's engine runs with no fallback reason.
6. **No reload loop.** A mismatch that persists after one reload leaves the
   page on the failure screen (or the TypeScript engine). The test counts
   main-frame navigations with `page.on("framenavigated")` and expects the
   count to stop at the one reload it made.
7. **Eviction and recovery (R6).** Install A, assert it controls the page,
   then delete each engine entry separately. With A still deployed, reload
   online and prove the missing response is fetched with manifest integrity,
   cached under A's key, and WASM advances without fallback. Delete again,
   go offline and reload: expect `load-failed` and the section 5.4 result.
   Reconnect to A and manually reload: the same key refills and WASM runs.
   Repeat deletion with B deployed but A controlling: B must never be stored
   under A's key, and A refuses until B's worker and shell activate. Finally
   remove the whole precache while offline and assert the browser's unavailable
   navigation outcome; reconnect and prove a new online visit recovers.
8. **Corrupted-cache repair without a new worker.** Tamper A's cached glue,
   binary and record separately while A remains deployed and no worker waits.
   Reload alone still refuses. Use Repair engine files online, then Reload;
   prove the set now matches A and WASM runs, with an online save intact.
   Offline, or with the engine fetch blocked, Repair stops at the first
   failed fetch and every existing entry is unchanged. A corrupt live
   response stays refused with no retry loop. Repeat with another A tab and
   a waiting B worker: no tab may run mismatched bytes during repair, B's
   engine entries are byte-identical before and after Repair, and after B
   activates the page cold-starts offline on B's engine.
9. **First-install race.** Start with an empty profile and no registration.
   Serve A's worker with B's engine response during installation. Assert the
   installer becomes redundant, the page stays uncontrolled, and no B bytes
   are stored under A's engine keys. A failed install may leave correctly
   fetched partial entries; do not falsely require an atomic cache rollback.
   With one settled deployment, close all pages and revisit online, assert
   a successful install/control and a fully matching set, then close all
   pages and cold-start offline with WASM advancing and no fallback.

R3 (activation mid-boot) is timing-dependent in a browser; the unit test
with the A-then-B fetcher covers its logic.

## 7. CI and bundle-budget impact

- **Precache:** one more URL (`engine/BUILD.json`, under 1 KB). The 4 MiB
  budget in `verify-precache.ts` is unaffected. `sw.js` grows by about
  200 bytes of integrity strings.
- **`perf:compare` (#979):** `precacheUrls` must learn the integrity key
  order (6.1), and the baseline shows the extra precache URL once. The
  first comparison after the change should show `engine-meta` precached
  bytes rising by the size of `BUILD.json` and nothing else.
- **Load time:** to measure, against the gate's provisional "cold load
  within +500 ms" row: hashing about 1.45 MB, and the loss of streaming
  compile on an online first visit. The plan's perf harness records it on
  the late-game fixture.
- **Phone measurement:** `crypto.subtle` is missing on a plain-HTTP LAN
  address, so the check refuses with `unverifiable` there. Measure on a
  phone through an HTTPS preview deploy or a local HTTPS tunnel.
- **Browsers:** the e2e projects are Chromium only. `Request.integrity`
  on service worker fetches and `import()` of a Blob URL are supported in
  current Firefox and Safari, but no test here proves it; the unit tests
  cover the logic, and a manual pass on Safari is part of the
  implementation's review.
- **CI time:** the second build for e2e spec 5 adds one `vite build` (no
  Rust rebuild) to the offline e2e job. The job must run on every PR that
  can change the precache or the engine package (#985's release rule):
  run it unfiltered on every pull request and on main pushes. This includes
  build wrappers, `.github/actions/engine-wasm/**`, dependency lockfiles,
  `conformance/events/**`, public audio, loader imports and future inputs
  without maintaining a second, inevitably incomplete dependency list.
  Keep this correctness job separate from heavyweight fuzzing and performance
  jobs. Changes to its own workflow must exercise this gate too.

## 8. Migration and rollback

- **Order.** Ship before the 3.0.0 flip, on the switchable default, so one
  release runs the check where a refusal falls back to TypeScript and only
  opt-in players are affected. The fallback-use signal (S16) then shows
  whether mismatches happen in the field before wasm-only removes the
  fallback. A mismatch fallback counts toward the gate's Reliability row
  (engine fallback under 0.1%), which is the point: the row should see it.
- **First update.** Players on a 2.32.0-or-later worker update as usual:
  the new worker installs the new set with integrity checks, and activation
  deletes the old keys. Workbox returns an already cached entry without
  checking its integrity, so a mixed set stored by a worker that predates
  integrity would survive that update. The implementation changes the
  engine cache keys with the first schema 2 worker: each engine entry's
  revision is its MD5 plus a suffix no earlier worker used (`-i2`), so the
  new worker fetches all three files with integrity and its activation drops
  the old keys. Until the update lands the page byte gate refuses such a set
  and Repair fixes it (slice 2b-3). Players on older workers (R7) are
  unaffected until they update.
- **`BUILD.json` consumers.** Besides CI, the readers are
  `scripts/gen-third-party-notices.ts`, `src/build/rustNotices.ts`, the
  `perfCompare` environment check and the `engine-wasm-download` action; each
  reads `.sources`, which is unchanged, and the implementation lists them in
  a test. CI reads `.sources` (unchanged).
  `packageHash.test.ts` reads `sources` (unchanged). Nothing at run time
  read the file before.
- **Version bump.** The implementing PR follows CLAUDE.md's rule: a player
  on the default build notices nothing, so the bump rides with the #985
  offline release (patch or minor, as #985 says).
- **Rollback.** Reverting the change and redeploying ships a `sw.js`
  without integrity and a shell without the check; workers update normally.
  A Vercel instant rollback to any build with the check is safe, because
  each build checks only against itself. No runtime switch disables the
  check (open question 5).

## 9. Open questions for the owner (decided in section 10)

1. **`BUILD.json` at run time.** The AC names it as part of the precached
   set; the byte digests compiled into the shell already decide the verdict,
   and `BUILD.json` adds the served build's id for diagnostics and one more
   way to refuse. Keep it required (recommended), or make it advisory so a
   missing record never stops an otherwise matching engine?
2. **Content-hashed names (option A) later?** They would end R7 for good and
   cut needless refusals, at the cost of a package layout change across the
   build, the checks, the dual run and `perf:compare`. Recommended as a
   follow-up only if the S16 signal shows mismatches in the field.
3. **Integrity beyond the engine set.** Adding it to `index.html` and the
   other revisioned entries would make the whole install consistent (it
   closes the shell half of R1). The risk: anything that rewrites HTML at
   the edge, such as the Vercel Toolbar on preview deployments, would fail
   every install there. Keep it to the engine set now, with a backlog row
   for the shell?
4. **Insecure contexts.** Production is HTTPS, but a preview build tested
   over a LAN address has no `crypto.subtle`. Refuse there (recommended:
   the build mode falls back or stops as for any mismatch), or ship a small
   JavaScript SHA-256 so the check runs everywhere?
5. **A kill switch.** If the check ever refused a good package in the
   wasm-only build, a redeploy (or a Vercel rollback) is the only fix. Is
   that acceptable, or should a build-time flag be able to turn the check
   off for an emergency release?
6. **Which id #963 shows as "the build".** The binary can embed `sources`
   but cannot know its own byte digest. This design shows both: `package`
   for "is this the right engine", `sources` for "which Rust code".

## 10. Decisions (2026-10-15)

The Web Game Room party (with the security engineer and the adversary from the
review crew) gave a GO to implement section 5 as written. The owner accepted
the room's positions on all six open questions.

| # | Question | Decision |
| --- | --- | --- |
| 1 | `BUILD.json` at run time | Required. |
| 2 | Content-hashed names (option A) | Only if the S16 fallback-use signal shows mismatches in the field. |
| 3 | Integrity beyond the engine set | Engine set only for now. The shell is tracked as #1046 (a `design-decision` backlog row restored by the Phase 2 plan PR #1080, which records the preview-deploy problem). |
| 4 | No `crypto.subtle` | Refuse with `unverifiable`. No JavaScript SHA-256. |
| 5 | Kill switch | None. A redeploy or a Vercel rollback is the fix; each build checks only against itself. |
| 6 | The id #963 shows | Both: `package` and `sources`. |

Conditions the implementation PR must meet:

1. **Measure before relying on it.** Set the measurement before the code
   lands: warm-precache boot and a cold online first visit on the throttled
   mid-range profile, before and after, against the plan's "cold load within
   +500 ms" row. If the cold first visit misses, the options are a smaller engine
   package or a deferred first load; compiling while bytes arrive would
   change the verify-then-instantiate guarantee in section 5.3, so it needs
   its own design and review. Dropping the check is not an option.
2. **Switchable build first.** The check ships on the switchable default; the
   wasm-only build relies on it only after the S16 signal is in.
3. **An accessible mismatch screen.** The wasm-only failure overlay gets
   `role="alert"` and keeps focus on Reload (`showEngineFailure` already does
   both, so tests pin them for the new reasons), and the new copy goes through
   `engineFailureCopy` with the ids as format arguments.
4. **The dev skip cannot ship.** A test proves the `import.meta.env.DEV`
   skip is compiled out of a production bundle.


## 11. Review notes carried to the implementation PR (2026-10-20)

The parallel review of this revision raised points that need the
implementation's measurements or tests, not more prose. The implementation
PR resolves each before it merges:

- Name the instrumentation each e2e spec uses to prove its claim (for
  example, a `WebAssembly.instantiate` spy installed before the module
  loads for spec 2), and split spec 7 into one scenario per test.
- Cite the `workbox-precaching` source lines behind the claims in section 3
  (one-at-a-time install, `cache: reload`, integrity on precache-miss
  fetches), and state that deploys are atomic alias flips; rolling or
  staged releases would need a different fixture.
- Record the measurement protocol for condition 1 (hardware profile,
  fixture and acceptance number) as the plan's PC protocol, not an ad hoc run.
- Safari and Firefox are not covered by CI. With no kill switch (decision 5),
  the manual pass on both browsers is a merge condition for the wasm-only flip.
