# CLAUDE.md

**[CONTRIBUTING.md](./CONTRIBUTING.md) is the contributor guide. Read it.** It
is the source of truth for dev setup, quality gates, testing & coverage,
architecture, versioning, code review, and merging. **[AGENTS.md](./AGENTS.md)**
adds the agent-specific layer on top: the BMAD/BMGD workflow and the mandatory
review skill. The BMAD agent rules live in `_bmad-output/project-context.md`.

## Non-negotiables (don't skip these)

- **Every non-trivial change gets a deep review, and the deep review IS running
  the BMGD/BMAD review skill in the same session: `/gds-code-review` for
  gameplay/engine work, `/bmad-code-review` for everything else (storage,
  persistence, tooling, UI plumbing).** **TDT / save round-trip work
  (`src/storage/tdt*`, save import/export) is `/gds-code-review`, not bmad,
  even though the mechanism is storage: its correctness is engine-data fidelity
  (population census, elevator/transport behavior, floor/lobby/view mapping), a
  gameplay-parity concern. Run both when a change also carries a big
  tooling/UI-plumbing surface.** Its adversarial layers (Blind Hunter →
  Edge Case Hunter → Acceptance Auditor, plus the Hot-Path Auditor on a
  hot-path diff, then triage) are the review. A self-read or
  a generic `/code-review` does **not** satisfy it. Fix every `patch` finding and
  record every `defer` finding in
  `_bmad-output/implementation-artifacts/backlog.md`. A PR is not "done"
  until the skill has run and its confirmed findings are fixed and re-verified.
  This holds **even for small or test-only changes** that touch engine/gameplay
  invariants (e.g. build caps, transport pooling, economy math). Green quality
  gates are **not** a substitute for the review skill, and "the diff is tiny" is
  not an exemption.
- **Hot paths get the complexity checklist,
  [`docs/performance/hot-path-review.md`](./docs/performance/hot-path-review.md),**
  in Rust, TypeScript, the WASM binding, the hosts, ticks, rendering and the
  other surfaces its section 1 lists. The review skills load it and add a
  Hot-Path Auditor layer that traces callers past the diff. The skills and the
  independent reviewer post its one-row-per-item record (its section 6) on the
  PR each round, and Copilot and Codex are asked to print it. On a hot-path
  diff there is no GO or CONDITIONAL GO without that record, and a Copilot or
  Codex sign-off covers the hot-path part only once a record from the skill or
  the independent reviewer is on the PR. Ported, rewritten, moved or inherited
  code is reviewed as new. A finding is fixed or deferred with evidence and an
  issue, and never dismissed as pre-existing; an added, ported or rewritten
  scan over its tier's budget, or a cache dropped, removed or bypassed without
  the equivalent HP-8 asks for, gets fixed unless the owner accepts the
  deferral in their own words. Section 1
  also records the owner's scope decision for the pull requests that were open
  when the page merged.
- **Quality gates before pushing:** `npm run typecheck`, `npm run lint`,
  `npm test`, `npm run build`. All four must be green. The build needs the
  engine package (`npm run wasm:build`), or `VC_ALLOW_NO_ENGINE=1` for a
  deliberate TypeScript-only build; see CONTRIBUTING.md.
- **American English everywhere;** keep `src/engine/` free of DOM/rendering.
- **No em-dashes in prose** (player-facing copy, docs, comments, commit and PR
  text) in anything new you write. Use commas, colons, parentheses, or separate
  sentences instead. Two standing exceptions: en-dashes in numeric ranges
  (`2–5`, floors `30–60`), and the standalone "—" empty-value placeholder glyphs
  in the stats/editor panels. Existing `src/` code comments are grandfathered;
  don't sweep them, but don't add new em-dashes either. Skip the "X, not Y"
  emphatic-restatement pattern and AI marketing vocabulary (leverage, seamless,
  robust, comprehensive, elevate, streamline, and the like). Keep copy plain,
  human, and grammatically correct.
- **Rust follows the same source rules.** The engine port in `engine-rs/` is held to
  the same conventions as the TypeScript, with no grandfathered comments:
  American English, no em-dashes (`src/tests/rustProse.guard.test.ts` keeps the
  Rust sources at zero), and the 500-line file ceiling that
  `src/tests/fileSize.guard.test.ts` enforces on `src/` and `scripts/` (it scans
  `.rs` files too, inline `#[cfg(test)]` modules included; today's oversized
  Rust files sit on the same shrink-only ratchet, `src/tests/fileSize.ratchet.txt`).
  The other gates have Rust counterparts: lint and typecheck map to `cargo fmt
  --check` and `cargo clippy -D warnings` (`engine-rs.yml`), and the engine
  boundary rules to `engine-rs/tests/independence.rs`, which keeps the simulation
  free of host access (files, network, console, clock; a few named referee
  functions may read fixtures) and the JavaScript binding inside `src/wasm.rs`.
- **Bump `package.json` `version` on any player-facing change**, keyed to "would a
  player notice anything different?": **major** for a save/compat break or a
  headline milestone, **minor** as the default for anything a player notices,
  **patch** for a fix-only re-deploy; internal-only work needs none. Bump the
  lockfile in lockstep (use `npm version`; a CI guard enforces it). It's injected
  as `__APP_VERSION__` on the splash and anchors the update flow, so a missing bump
  misreports the build. See [CONTRIBUTING.md](./CONTRIBUTING.md) → **Versioning**.
- **Screenshots come from the pinned Playwright Docker container, never a host
  browser.** Regenerate `docs/screenshots/**` either by approving the
  `commit-on-approval` job on the PR's `pr-drift-check` run (it renders in the
  pinned image and commits the refreshed gallery straight to the PR branch) OR
  locally inside that **same pinned image** (the exact
  `mcr.microsoft.com/playwright:v<lockfile-playwright-version>-jammy` the workflow
  resolves), running `npm ci && VC_TOOLING=1 npm run build && RUN_SERVER=1 node
  scripts/screenshots.ts` in it (`VC_TOOLING=1` publishes the `window.game`
  handle the scenes drive; a plain production build compiles it away). Build
  the engine package on the host first, since the image has no Rust toolchain. Output
  from the pinned image is equivalent to CI's and may be committed. There is no `[update-screenshots]` marker workflow
  anymore (retired once drift became a hard gate on the PR); every gallery refresh
  flows through a PR. Mint `e2e/visual.spec.ts-snapshots` only via
  `update-visual-baselines.yml` (`[update-baselines]`) or that same pinned image.
  What is **not** allowed as the final set: `npm run screenshots` on a HOST
  browser (outside the pinned container) or any downloaded-browser capture, which
  render different pixels; those are **preview only**. See
  [CONTRIBUTING.md](./CONTRIBUTING.md) → **Screenshots**.
- **The backlog mirrors to GitHub issues (standing rule, 2026-07-15).** Every
  unresolved curated row in `_bmad-output/implementation-artifacts/backlog.md`
  carries its issue number in the `GH` column: create the matching issue when a
  row lands (a plain title, a type label and a `P1`-`P3` label, row notes as
  the body) and close the issue when the row finishes. The row's `Priority`
  owns the P label: `backlog-priority-labels.yml` re-syncs it whenever a push
  to `main` changes the backlog, and weekly. To change a priority, edit the
  row.
  Only unfinished work keeps a live issue, and a doc may claim something is
  "tracked in the backlog" only when a real row exists. The full rule lives in
  the backlog's "How items flow"; `src/tests/backlogIssueMirror.test.ts`
  enforces the row half in CI.
- **Merge commits only** to `main` (never squash). Commit/push only when asked.
- **Keep a branch's own history readable before it merges.** A tidy branch is
  a handful of commits that each state a real step. When review nitpicks pile
  up into a trail of "fix typo", "address review", and "oops" commits, reshape
  the branch into that coherent set before merge. This tidies the branch only:
  the integration into `main` stays a merge commit, never a squash-merge (see
  above). Because `git rebase -i` and `git add -i` are unavailable here,
  reshape with `git reset --soft <base>` and re-commit, or `git commit --amend`
  for the tip, then push with `git push --force-with-lease`. Avoid force-pushing
  in the middle of an active review round. Any push of new commits re-arms the
  reviewer (Copilot reviews one snapshot at a time), and a force-push also
  rewrites the history it is reading, so batch the fixes and reshape once,
  ideally just before requesting review or just before merge.
- **Resolve Copilot/Codex PR review threads** once addressed. Actually mark
  each thread **Resolved** (`resolve_review_thread`); a reply alone does NOT
  clear it, and unresolved threads block merge under branch protection.
- **Enable auto-merge only after the PR is signed off and CI is green, never
  speculatively.** Signed off means Copilot has reviewed the PR and left no
  blocking finding unresolved (an approval, or a review whose comments are all
  addressed and marked resolved), and no other review is outstanding: when an
  independent review or a review-skill round has been requested or is running
  on the PR, hot-path or not, auto-merge stays off until that review has
  finished on the final commit (the independent reviewer has posted a GO, or a
  CONDITIONAL GO whose conditions it has confirmed met, and the skill's `patch`
  findings are fixed). On a hot-path diff, signed off also needs the section 6
  record of `docs/performance/hot-path-review.md` for the final commit on the
  PR and a completed independent review of that commit, which the PR's author
  requests; the page's section 6 says when a record and a verdict carry to a
  later commit. A reviewer that is still running has not
  signed off. CI green means every required check has passed, the screenshot
  drift check included. Do not arm auto-merge before the PR is signed off and
  CI is green, and do not arm it early so it fires the moment the checks pass.
  Once both are true, auto-merge using a merge commit (never a squash-merge,
  per the merge-commits-only rule above) may be armed without asking again.
  If Copilot raises a finding or a required check fails, hold the PR and fix it
  rather than let it merge.
- **When the automated PR reviewers are down, loop the BMGD/BMAD review skill
  until the changes are clean.** Copilot/Codex being unavailable never lowers
  the bar or unblocks merge; it just removes the outside reviewer, so the deep
  review skill has to carry that load too. First request the review as usual,
  then confirm from the PR's checks and review status that the outside review
  is genuinely unavailable rather than merely slow: a job that errored or never
  started counts as down, one that ran and is only pending means wait for it,
  not loop. If one of the two reviewers can still review, use it; only stand in
  with the skill when neither Copilot nor Codex can. This applies only where the
  change would already need the deep review; the non-trivial-change bar in the
  first non-negotiable still governs, so a one-line or docs-only tweak the bots
  would have waved through does not suddenly require the loop (it just waits for
  the bots to return, or you ask the user if that wait blocks something). Run
  the review skill on the full change per the gameplay-vs-plumbing split above
  (`/gds-code-review` or `/bmad-code-review`, both when the change spans both
  surfaces), fix every `patch` finding and record every `defer` in
  `_bmad-output/implementation-artifacts/backlog.md`, then run the skill again
  on the updated diff. Keep cycling until a full pass surfaces no new `patch`
  findings ("nothing left to fix"); one clean run straight after a fix round is
  not enough on its own, since each fix can open the next finding, so take one
  more confirming pass. If the loop does not converge after a couple of rounds,
  a `patch` finding needs human judgment you cannot settle, or the reviewers
  stay down once the change is clean, stop and ask the user rather than loop
  forever or merge on your own. Note on the PR that the reviewers were down and
  how many rounds ran. Re-request Copilot/Codex and hold merge as usual the
  moment they are back.
- **A published analytics number is either computed by a governed definition,
  or by reviewed code that a test binds to one.** What is banned is the third
  case: a measure improvised in a session and published. A readout may narrate,
  interpret, argue and recommend, all the things a dashboard is bad at, but its
  arithmetic has to come from somewhere that would catch it being wrong. The
  governed sources are the **Verticopolis: Gameplay Analytics** dashboard, the
  `session_lengths` view, its saved insights, and the PostHog data catalog;
  check the catalog first. `scripts/posthog-report.mjs` is the worked example of
  the second clause: it computes its own HogQL, and that is fine, because it
  documents what it measures and where it is a lower bound, and
  `src/posthog-report.test.ts` pins its page-life walk against the view's copy
  so the two cannot drift. Improvising is how a published readout came to report
  211 sessions at a median of 86s when the real figures were 132 and 42s: it
  counted `session_end` rows, which re-fire on every tab-hide. A doc comment,
  the view, the dashboard and the saved insights all carried that correction
  already, and prose did not stop the query running. If no governed definition
  covers the measure and you are not writing tested code, say so in the readout
  and propose a metric rather than quietly inventing a number.
- **A published snapshot says so, at the top.** Anything dated and not
  refreshing carries its window above the figures rather than in a footer, with
  a pointer to wherever the live number lives: the dashboard when it carries
  that figure, otherwise the script and the test that produce it, since a
  governed definition is not always a dashboard tile. A date a reader meets
  after believing the number is too late.

## Canon reference (don't re-derive from memory)

- **The engine crate version (`engine-rs/Cargo.toml`) goes up with the
  conformance lock, the save/frame layout/catalog/identity versions and the
  binding declaration `src/dualrun/engine.d.ts`.** Raise it in `Cargo.toml`,
  `Cargo.lock` and `engine-rs/consumer/Cargo.lock`, then run
  `npm run engine:compat`; a guard fails the PR otherwise. Steps and limits are
  in CONTRIBUTING.md → Versioning → The engine crate version.

- **Per-tower build caps live in `src/engine/facilities.ts`** (`BUILD_CAPS`,
  `POOLED_CAPS`, `MAX_CARS`, `maxSpanFor`) and are enforced in one place,
  `Tower.capReason`. That file is the single source of truth; mirror the 1994
  original there, not from recollection.
- **Transport pooling matches the original and is deliberate:** all three
  elevator kinds (standard + service + express) share **one 24-shaft pool**, and
  express is **not** counted separately. Stairs + escalators share a separate
  **64-link pool**. Cars/shaft: 8 for every elevator kind (service included: it
  is a staff-only standard elevator, not a reduced one). Spans: standard &
  service 30 floors, express the whole tower, stairs/escalators a fixed 2 floors.
  Do not "fix" express out of the elevator pool; that would break canon.
