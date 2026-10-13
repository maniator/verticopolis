# Review: reality check (Reviewer Gate)

- **Spine:** `ARCHITECTURE-SPINE.md` (Rust/WASM web cutover, 2026-10-13)
- **Lens:** every committed decision is reality-checked against the repository and the live registries.
- **Baseline:** `origin/main` at `404bb9c` (merge of #948); PR branch PR #950's branch (open PR #950); npm registry, crates.io and the Rust stable channel queried 2026-10-13.

## Verdict

Pass with fixes. The spine is grounded far better than average: every file path it binds exists on `main`, the pinned crate versions match `Cargo.toml` and `Cargo.lock`, and every issue and PR number resolves to the item the spine says it is. Three things are stated as present-tense fact that are not true on `main`, and the Stack table records manifest ranges without saying they were never checked against current upstream releases.

## Findings

### F1 (high): tier 3 names two binding ops that exist only on an open PR

AD-3 lists `towerSetCars` and `towerResizeTransport` beside `setMoney`, `setCars` and the others as today's tier 3 relay ops, and the Consistency Conventions table says the `tower*` prefix is reserved for tier 3. On `origin/main`, `engine-rs/src/wasm.rs` exports neither name (0 matches). Both appear only on PR #950's branch (commits `e0b044e`, `c6f9e3e`), which backs open PR #950 ("Emit capacity_changed from the simulation layer in TypeScript (#906)"), together with the guard test `towerRelayOps.guard.test.ts` that AD-3's "source guard test" implicitly relies on. That branch shares a name with the merged #938 branch, which makes it easy to assume it landed.

**Fix:** mark both ops and the guard test as "pending #950 / #906", or make AD-3 conditional on #950 merging; cite #906 in Binds.

### F2 (medium): the binding naming convention contradicts the binding on `main`

"`tower*` prefix only for tier 3 relay ops" reads as a description, but on `main` every existing tier 3 op is unprefixed (`setMoney`, `setCars`, `resizeTransport`, `removeUnit`, `removeTransport`), and `setTowerName` (tier 1) carries "Tower" in its name. Even after #950, the prefix marks only the two new ops. The rule is either a rename plan for existing exports (scope it and say so) or the wording should be "new tier 3 ops take the `tower*` prefix".

### F3 (medium): AD-4 describes the frame version and "exported widths" as existing

`FRAME_HEADER = 26` and `PERSON_FIXED = 18` are Rust `pub const`s in `engine-rs/src/wasm.rs` that the binding does **not** export; `src/wasmhost/frameView.ts` re-declares them by hand ("mirrors `PERSON_FIXED`"). No frame layout version exists anywhere in `engine-rs/src` or `src/wasmhost` (searched for `FRAME_VERSION`, `layoutVersion`, `frameVersion`). The catalog digest does exist (`catalog::catalog_digest`, locked in `conformance/catalog-digests.json`). The rule should say the version slot and a JS-visible export of the widths are new work, or a story will treat them as already shipped.

### F4 (medium): Stack table records ranges where the lockfile resolves versions, and nothing marks upstream currency as checked

| Row | Spine | Manifest | Lockfile | Upstream latest (2026-10-13) |
| --- | --- | --- | --- | --- |
| Rust `rust-version` | 1.97 | 1.97 | n/a | 1.99.0 stable (2026-09-28) |
| wasm-bindgen | =0.2.129 | =0.2.129 | 0.2.129 | 0.2.129 (current) |
| serde_json | 1.0.151 | 1.0.151 | 1.0.151 | 1.0.154 |
| TypeScript | ^5.3.3 | ^5.3.3 | 5.9.3 | 7.0.2 (`latest`) |
| Vite | ^7.3.1 | ^7.3.1 | 7.3.6 | 8.3.4 |
| Excalibur | ^0.32.0 | ^0.32.0 | 0.32.0 | 0.32.0 (current) |

All six rows match the repository, so nothing is wrong today. But TypeScript and Vite are each a major version behind upstream, and the cutover runs through a 3.0.0 flip and retirement that will take several release cycles. The spine should list the resolved lockfile versions (5.9.3, 7.3.6), state that the majors are deliberately held for the cutover (or name when they move), and note that a Rust bump also moves the Vercel toolchain (`scripts/vercel-build.sh` installs exactly `rust-version`).

### F5 (low): load-bearing toolchain pieces are missing from Stack

The spine depends on the `wasm-bindgen-cli` matching the crate pin (enforced by `scripts/wasm-build.ts`, `scripts/vercel-build.sh` and `.github/workflows/engine-rs.yml`), the `wasm32-unknown-unknown` target, Node `>=22.18.0` (`package.json` `engines`, needed for running `.ts` scripts natively) and Vitest `^4.1.11` (lock 4.x; upstream 5.0.4), which is the runner for #878 test parity. Add them so a later upgrade review sees the whole chain.

## Verified as stated (no action)

- Paths: `src/wasmhost/wasmHost.ts`, `src/wasmhost/frameView.ts`, `src/dualrun/mirror.ts`, `src/engine/sim/fixedStep.ts`, `src/engine/timePacing.ts`, `src/game/frameLoop.ts`, `engine-rs/src/{wasm,clock,charges,catalog,load,events}.rs`, `src/analyticsEngineBridge.ts`, `src/storage/` all exist on `main`.
- `engine-rs/src/clock.rs` has `pub struct Clock` with no step driver yet, matching AD-2's "moves into the crate".
- Tier 1 and tier 2 exports (`build`, `buildTransport`, `addCar`, `removeCar`, `extendTransport`, `removeFacility`, `fromSave`, `fromVctower`, `frameView`, `catalog`, `drainGameplayEvents`) exist on `main`; binding errors use `JsError` (21 uses).
- AD-5: `MAX_SAVE_INFLATED_BYTES = 32 * 1024 * 1024` in `engine-rs/src/load.rs`; #941, #944 and #949 are merged with matching titles.
- AD-1 "today the instance answers and relays" matches the switch story's "How it works".
- Issues #867, #868, #873, #874, #878, #893, #908 and #923 are open with titles matching their use; #903 and #938 are merged. AD-6 is marked ADOPTED while #873 is still open; acceptable since phases 1 and 2 shipped, but say "phase 3 pending" if any remains.
- Deployment: `vercel.json` runs `scripts/vercel-build.sh`, which installs the pinned Rust and wasm-bindgen CLI, consistent with "unchanged".
- Companions `rust-wasm-web-cutover-plan-2026-10.md` and the readiness report exist only on the plan branch so far; fine for a plan PR, but they must merge together.
