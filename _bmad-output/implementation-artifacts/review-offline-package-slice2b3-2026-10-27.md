# Review: #985 slice 2b-3 (engine cache-key rotation), 2026-10-27

`/bmad-code-review`, plumbing surface (the precache manifest, a build transform and e2e). Run as separate subagents: Blind Hunter (diff only), and Edge Case Hunter with Acceptance Auditor (diff, repo, design section 8). Hot-path review: not applicable, build-time change.

## Checked against the installed Workbox (7.4.1)

- `PrecacheStrategy._handle` returns any entry found under the expected key before it considers integrity, so a worker whose files have the same MD5 keeps a damaged set stored under the plain-MD5 keys.
- `PrecacheController.activate` deletes every key not in the new manifest, so the old keys go when the rotated worker activates.
- `manifestTransforms` run after the built-in transforms and nothing later in `vite.config.ts` rewrites the revision.
- Every consumer of the revision treats it as an opaque string: Repair's `precacheKey`, `engineDistProblems`, `shellRevisionProblems`, `scripts/verify-precache.ts` (reads only `url`), and the e2e helpers.
- The 4 MiB budget is summed from file sizes, so the change does not touch it. Rolling back to a build without the suffix is safe: the rolled-back worker finds no plain keys, fetches all three files, and its activation removes the rotated keys.

## Patch findings, all fixed

- **The first e2e did not run the install-trust path** (all reviewers). It seeded entries behind an installed rotated worker and reloaded, which only runs the fetch-on-miss path, so it would pass with the suffix removed. It now seeds a damaged set under the plain-MD5 keys, then installs a second worker with identical engine bytes (`reissueWorker` serves the first deployment's `sw.js` with one comment line added), takes the update, and checks that each engine file has only its rotated key and the build's own bytes. With no suffix the seeded entry would sit under the second worker's own key and stay.
- Glue, binary and record are all checked, the precache is selected by name, and the suffix is imported instead of hardcoded.
- The unit test compares the record entry's revision as well, and pins that an entry with no revision gets the rotated one.
- Stale "MD5 of the file" comments in `vite.config.ts`, `enginePackageRecord.ts` and `shellRevisionProblems` now describe the suffix. The `revisionOf` regex in `e2e/deployments.ts` is `[a-f0-9]{32}(?:-i\d+)?`.
- Story, backlog row and design section 8 record the choice of rotation over a purge.

## Deferred (on the #985 backlog row)

The real old worker is never run (an old-format build would be the true fixture); a suffix bump has no test of its own. Cost to note for the owner: each player re-downloads the engine files (about 1.5 MB uncompressed, 430 KB compressed for the binary) once on the first update after this ships, including players on slice 1 workers who were never at risk.
