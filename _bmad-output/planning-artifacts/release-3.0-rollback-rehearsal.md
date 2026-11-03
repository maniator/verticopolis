# Rollback rehearsal for the Rust-only deploy (#1221)

> **Decision, 2026-11-03: the live rehearsal is skipped before 3.0.** The previous production build still ships the TypeScript engine, so a live rollback now would not rehearse the Rust-only shape. The dry runs below stand in for it, and the live rehearsal runs after 3.0 ships, when both builds are Rust-only. The steps stay as written for that run.
>
> **Procedure, written 2026-11-03. Nothing in it has been run against production, and the live rehearsal (steps L0 to L7) does not start without the owner's explicit go in the project thread.** The script, tests and fixtures exist so the evidence is cheap to produce once he says yes. The Rollback row of #945 (restated and approved on 2026-11-03) reads: redeploy the previous build, confirm it loads saves written by the newer build, and ship no save-format bump in the flip release.

## What a rollback is now

Every deploy is the Rust-only build: no switchable build, no cohort, no TypeScript fallback, `?engine=` ignored. So there is no flag to flip. A rollback is Vercel serving the previous production deployment again (a promote or rollback of an earlier deployment of the same project), and a roll forward is serving the newer one. The browser keeps its storage across both, and its service worker updates to whichever shell the origin serves next.

Two things decide what an older build does with a newer save. Since #1603 the engine refuses a save whose version is above its own, so a save-format bump in the flip release would lock a rolled-back build out of every tower the new build wrote (the preflight fails on any bump). Without a bump, and always for builds before #1603, the loader ignores fields it does not know. So the danger is quiet. A field the newer build wrote is dropped the first time the older build saves, and the player's tower loses that information on the next autosave (EX-1 in the exception register was exactly this). The rehearsal therefore looks for dropped and changed fields, and for a refusal or a trap, in both directions.

## What the rehearsal proves

| Check | Layer | Pass condition |
| --- | --- | --- |
| Save format | preflight | The candidate's `saveVersion` is not above the previous build's (no save-format bump ships). |
| Previous build reads candidate saves | engine | Each candidate-written tower loads on the previous engine and, with no play, serializes to what the candidate itself makes of it: no dropped or changed field outside the allowed-loss list. |
| Previous build plays and saves | engine | It plays 24 game hours with no trap and its save loads back into the candidate with no dropped field. |
| Candidate reads the previous build's saves | engine | The roll forward above. |
| Stored saves load in the previous deployment | browser | Each seeded autosave and slot shows the same name, funds and day on the title screen's tower picker, the engine reports `wasm` with no failure, and no save moves to the unreadable slot. |
| The previous build's own rewrite loses nothing play does not explain | browser | After it continues into the game and autosaves, every field or list the seeded autosave had and the stored autosave lacks (a dropped path, or a list that came back shorter in any place) is either a loss the candidate engine also makes by playing that same save for 24 game hours, at least as large (the engine step checks every 10 game minutes and records, in `churn.json` beside the saves, the most each path lost: places for a dropped field, elements for a shorter list; shown under `toReview`), or an accepted loss. Anything else fails, including a bigger loss than play makes at that path, and a save with no entry in `churn.json`. The play is the engine's own `tick`, so a list that only the browser's frame loop shortens would fail a clean run; a person reads that case against the report. Without `churn.json` only a dropped top-level field fails and the nested rest is listed; the PASS line then says LENIENT. Slots are checked for readability and for the picker row, not for a rewrite. |
| Update and offline path | live only | The installed PWA moves to the rolled-back shell and still plays offline (checklist session C3 and F). |

The allowed-loss list is `scripts/rollback-allowed-losses.json`. It starts empty. An entry needs an exception id (`EX-n`), a kind (`dropped` or `changed`), the path with array indices written `[]`, and a reason, and the owner approves the exception in the register first. Any difference not on the list fails the rehearsal and goes to the owner before the gate review (the acceptance line of #1221). An entry no case hits is reported as stale so the list does not outlive its exception.

## Files

| Path | Role |
| --- | --- |
| `src/build/rollbackRehearsal.ts` | Pure logic: preflight, field-by-field save diff, judgement against the allowed list, the per-tower case, the report. |
| `src/build/rollbackRehearsalNode.ts` | Reads a checkout's records, loads its Node engine package, makes the candidate-written saves from `conformance/fixtures/` (the `.vctower` files and the nine real `.TDT` saves). |
| `src/build/rollbackRehearsalChurn.ts` | The play churn record: which paths the candidate engine loses by playing a save, and the classification of a rewrite's losses against it. |
| `src/build/rollbackRehearsalStore.ts` | The browser half's pure helpers: the seeded saves, the stored form (`VCZ1:`), the picker row a save should produce and the whole-value match. |
| `scripts/rollback-rehearsal.ts` | The command line: `prepare`, `preflight`, `engine`, `seed`, `verify`. |
| `scripts/rollback-rehearsal-browser.ts` | The browser half, for any origin that serves a production build. |
| `scripts/rollback-allowed-losses.json` | Accepted differences. |
| `src/tests/rollbackRehearsalBrowser.test.ts` | Unit tests of the store helpers. |
| `src/build/rollbackRehearsalChurn.test.ts` | Unit tests of the churn record, maximum over the 10-minute checkpoints, list elements lost and the classification. |
| `src/build/rollbackRehearsal.test.ts` | Unit tests with engine doubles (every failure path). |
| `src/tests/integration/rollbackRehearsal.integration.test.ts` | The real WASM engine on real fixtures, plus a previous engine that drops a field and one that refuses. |

The fixtures are the repository's own: nine real `.TDT` saves (TOWER1 to TOWER8 and MYTOWER, imported by the candidate's Rust importer) and eight `.vctower` towers including `towerone-vip-pending` (a Modern booking in flight). The candidate engine loads each, plays 24 game hours and serializes, and those bytes are what the previous build is tested on. Nothing the original game wrote is added to the repository.

## Dry run on any two checkouts (cloud or PC, no production involved)

The candidate is the checkout you are in (a branch or the release candidate). The previous build is another checkout of the commit that is deployed now.

```sh
# 1. The previous build's checkout and engine package (Linux x64: installs the pinned toolchain;
#    elsewhere run `npm ci` and `npm run wasm:build` in the checkout by hand, as in the benchmark protocol)
node scripts/rollback-rehearsal.ts prepare --ref <previous commit, the full 40-character sha> --dir ../vc-previous

# 2. The candidate's own engine package
npm run wasm:build

# 3. The checks that need no browser
node scripts/rollback-rehearsal.ts preflight --previous ../vc-previous
node scripts/rollback-rehearsal.ts engine --previous ../vc-previous --hours 24 --out .rollback-rehearsal
```

`engine` writes `engine-report.md`, `engine-report.json` and the candidate-written saves (`saves/<fixture>.json`) to the output folder, prints the report, and exits 1 on any failure. On PowerShell use `node scripts\rollback-rehearsal.ts ...` and no `npm` flag needs `--`.

The browser half, locally, with the two builds served one after the other on one port so the profile keeps its storage (this is the dry run of steps L2 to L6):

```sh
# in the candidate checkout and in the previous checkout: npm run build  (a production build, not the tooling build)
npx vite preview --host 127.0.0.1 --port 4173 --strictPort        # serve the candidate's dist
node scripts/rollback-rehearsal.ts seed   --origin http://127.0.0.1:4173/ --profile .rollback-profile --saves .rollback-rehearsal/saves
node scripts/rollback-rehearsal.ts verify --origin http://127.0.0.1:4173/ --profile .rollback-profile --saves .rollback-rehearsal/saves --expect-sha <candidate sha7>
# stop the server; serve the previous checkout's dist on the same port (the rollback)
node scripts/rollback-rehearsal.ts verify --origin http://127.0.0.1:4173/ --profile .rollback-profile --saves .rollback-rehearsal/saves --play-seconds 90 --expect-sha <previous sha7> --out .rollback-rehearsal
# serve the candidate again (the roll forward) and verify once more
node scripts/rollback-rehearsal.ts verify --origin http://127.0.0.1:4173/ --profile .rollback-profile --saves .rollback-rehearsal/saves --play-seconds 90 --expect-sha <candidate sha7> --out .rollback-rehearsal
```

`seed` writes the first four saves into the autosave key and slots 1 to 3 in the exact stored form (`VCZ1:` plus base64 of the raw deflate of the stamped save). `verify` reads each row on the title screen's tower picker, optionally continues into the game and waits for an autosave (`--play-seconds` at least 65, since the 30 second timer skips ticks while the title screen is up), then diffs the stored saves against the seeded ones. Set `PW_CHROMIUM_PATH` to the counting browser on the PC (benchmark protocol, section 1); nothing here is a performance measurement, so any Chromium will do.

## Dry-run results, 2026-11-03 (cloud container, not gate evidence)

Candidate: main at `7933cba` (app 2.77.5, engine crate 1.5.2, save version 7), 17 fixtures, 24 game hours.

| Previous build | Engine layer | Browser layer |
| --- | --- | --- |
| `f3304e3` (app 2.77.5, crate 1.5.2) | PASS, 0 differences in 17 towers | Not run (no production build of that checkout was made; its source still carries the switchable build flag, which main no longer has) |
| `1652109` (app 2.74.3, crate 1.1.1, Oct 30) | **FAIL**, 8 of 9 real `.TDT` towers | Not run (no production build of that checkout was made) |
| The candidate served as both builds (production build, headless Chromium) | Not applicable | PASS: four seeded towers show the right name, funds and day, the engine is `wasm`, and after an autosave no field is missing. This only proves the harness works; it cannot show a rollback loses nothing, because both builds are the same |

The 2.74.3 failure is a real loss, the kind the allowed-loss list exists for. A tower imported from an original `.TDT` save carries `preserveBasementStops` on each express shaft (the 2.77.3 change, "express elevators in imported SimTower towers keep their basement stops"). The older engine does not know the field. It drops it and rebuilds the shaft's `skipFloors` without the basement stops (for example 84 entries become 92 on MYTOWER, and the first skipped floor reads 2 where it was -7). So a rollback past 2.77.3 changes the express stops of every imported tower that has a basement. That is the same class as EX-1 (the loss is an older build's missing knowledge, in the player's tower, without a refusal). The rehearsal that matters runs against the build deployed just before the flip, and the owner decides then whether any such difference is accepted. If it is, the entry goes in the register first and then in `scripts/rollback-allowed-losses.json`.

Decision (party roundtable, 2026-11-03, relayed by the coordinator at Naftali's request): add nothing to the register now and do not block the flip. The realistic rollback target is the deploy live just before the flip, and `f3304e3` knows the field with 0 differences. An entry is by path, so a `preserveBasementStops` or `skipFloors` entry would hide a real regression in the shipped build. Condition: the pre-flip rehearsal pins its previous build by commit, and if that build is older than 2.77.3 the finding comes back and blocks until the owner rules on it in their own words. This is recorded as evidence, not dismissed.

The eight `.vctower` towers and TOWER8 pass against both previous builds. An identity run (the same engine on both sides) also exposed that a save is not always a fixed point of load and serialize (MYTOWER gains a third milestone on its first reload), which is why the case compares the previous build with what the candidate itself makes of the save, not with the raw text.

## The live rehearsal (needs the owner's explicit go)

Do not start this section on a guess. It touches production only through the rollback itself, which is his to approve or run. The Vercel tools or CLI reach the project, so the permission to use them for this is a separate yes.

Two exposures to weigh before he says yes:

- **Real players are on the rolled-back build while it lasts.** L3 serves the previous build to everyone. Any player who loads the game in that window runs the older engine, and the first autosave it makes can drop the fields the engine layer lists (that is the whole risk being rehearsed). Keep the window short, pick a quiet hour from the analytics dashboard, and run L0 first so a known loss is accepted before anyone is exposed. A preview deployment of the previous commit cannot stand in for this: it is a different origin, so it does not test the production domain's stored saves and service worker. It does serve as a trial run of L1 to L6 (point `--origin` at it).
- **A rollback on Vercel can pause automatic promotion of new pushes** to production until the candidate is promoted again. L6 promotes it, and nobody should merge to `main` during the window.

The browser runs add synthetic sessions to analytics (L1, L2, L4 and L6 each open the site). The script cannot decline the consent prompt for you; note the start and end times on #945 so the traffic can be excluded from the stage readouts.

| Step | Action | Evidence |
| --- | --- | --- |
| L0 | Before anything: the candidate is the production deployment. Record its deployment id, URL and commit, and the previous production deployment's id and commit (Vercel deployments list). Run the dry run above with `--previous` set to that previous commit and read the engine report. A FAIL or an unexplained loss stops here and goes to the owner. | Both ids, the commits, `engine-report.md`. |
| L1 | In a fresh browser profile (a new folder, not the owner's own), run `seed` against the production URL. This stores candidate-written towers in that profile only and opens the site once (it counts as one session in analytics unless consent is declined; add the `--headed` switch and decline analytics in the consent prompt). | `seed` output: engine `wasm`, no failure, the build record from `version.json`. |
| L2 | Run `verify --expect-sha <candidate sha7>` once against the candidate (read only; it prints that no data-loss check ran). | Rows `ok`. |
| L3 | **The rollback.** The owner rolls production back to the previous deployment (Vercel dashboard, Deployments, the previous production deployment, "Promote to Production" or Instant Rollback), or tells the thread to do it. Record the time. | The deployment now aliased to the production domain. |
| L4 | Run `verify --play-seconds 90 --expect-sha <previous commit sha7> --out <folder>` against production. The run fails by itself, and is void, when the origin's `version.json` names another build or when the page is running a shell the origin no longer serves (the installed service worker keeps the old shell until it updates: wait, reload, run again). Both checks matter, because `version.json` is always fetched fresh and cannot tell what shell the page runs. | The JSON report, `PASS`, with every `toReview` entry read and noted. |
| L5 | In that profile open the game once by hand and keep a screenshot of About on the rolled-back build and of the Saved Towers list. For the installed-PWA clause, install the app first (session C of the PC checklist) and relaunch it offline after L3. | Two screenshots. |
| L6 | **The roll forward.** Promote the candidate back. Run `verify --play-seconds 90 --expect-sha <candidate sha7> --out <folder>` once more: the towers the previous build rewrote must load on the candidate. | The JSON report. |
| L7 | Paste the engine report, the three browser reports (with what `toReview` listed and your read of it) and the deployment ids on the Rollback row of #945. Any difference not on the allowed-loss list goes to the owner before the gate review. | A comment on #945. |

If L4 fails, roll forward (L6) as part of the approved window, keep the report, and stop. A rollback that cannot load a newer save is the finding the rehearsal exists to make, and production is back on the candidate within minutes.

## What this does not cover

- A browser holding the candidate's service worker while the origin serves the previous shell: session C3 of [`release-3.0-pc-verification-checklist.md`](release-3.0-pc-verification-checklist.md) covers the update path, and `e2e/offlineUpdate.spec.ts` and `e2e/engineRepairDeployments.spec.ts` cover a deployment change in CI.
- The play churn is sampled every 10 game minutes, so a list that shrinks and regrows inside one sample would be missed and a clean run could fail on it; the failure names the path for a person to read.
- The play path is the engine's `tick`, two game minutes at a time, not the browser host's frame loop (event draining, boundary markers); the browser layer covers the host path for one tower.
- A previous deployment that still boots a TypeScript engine, or has no title-screen picker, fails the browser layer by design (it requires the Rust engine and the picker). That does not apply to the Rust-only previous builds this rehearsal is for.
- A field the previous build drops only while playing (not at load). The engine layer diffs the load-and-serialize step against what the candidate makes of the save; the played save is only checked for being readable, for the candidate keeping what the previous build wrote, and (browser layer) for losses that play alone does not explain.
- An allowed-loss entry is by path, not by value: a `changed` allowance for a path hides any change at that path in any tower. Add entries narrowly, and expect a loss like the 2.74.3 one to need an entry for the shaft's `skipFloors` list as well as for `preserveBasementStops`.
- The unreadable-save slot is sticky across phases: if L4 moves a save there, L6 reports it again, so read the L4 report first.
- Towers the candidate writes after the previous build's last release in ways the fixtures do not produce (a tower built by hand with every facility). The fixtures are the repository's nine real saves and eight towers; a hole is a new fixture.
- The crash path of the old step 4 (a forced trap landing on a TypeScript engine) no longer exists. The forced-trap spec that ends on the recovery path is the End to end row's concern (#945), not this one.
