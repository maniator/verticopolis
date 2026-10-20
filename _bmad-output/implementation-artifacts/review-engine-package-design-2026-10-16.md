# Engine package design review handoff, 2026-10-16

Status as of 2026-10-20: planning-only repair, recovered from an uncommitted Codex worktree and pushed by the WS-B evidence thread. The BMAD and GDS review layers ran on 2026-10-20 and their patch findings are applied (see the end of this note). The additions made after the 2026-10-15 GO are planning-only and have not been re-reviewed by the Web Game Room.
PR: #1047, existing branch `claude/engine-set-design-985`.
Baseline: `e114ea0d222a15dd13ff54b3b8f17d4cd10cc2da`.
Claim: https://github.com/maniator/verticopolis/pull/1047#issuecomment-6222718484

The owner requested planning-only fixes in comment 6219595403. No application,
engine, version, CI or rendering code changes have been made. #985 stays open.

## Existing inline findings and proposed resolution

| Comment | Finding | Updated design section |
| --- | --- | --- |
| 4286018917 | Validate served file entries, even when the package string is preserved | 5.3 steps 4 and 5: strict fields, canonical digest and actual byte comparison |
| 4286018929 | Bound BUILD.json before buffering | 5.3 step 3: fixed 16 KiB stream cap, header-independent counting and cancellation |
| 4286018939 | Late import/init after timeout | 5.3: terminal attempt/deadline guards, late-result disposal, no publication or host attachment; already-started initialization cannot be canceled |
| 4286018949 | HTTP 404 versus malformed record classification | 5.3: HTTP failure is load-failed; invalid successful response is mismatch |
| 4286018957 | Repair an existing corrupt cache without a newer worker | 5.4: explicit online repair rewrites only engine precache keys (fetch, verify, then replace) and preserves saves; no promise Reload alone repairs corruption |
| 4286018963 | Missing browser eviction proof | 6.2 spec 7: same-build refill, offline refusal, reconnect recovery, changed-deploy refusal and whole-precache loss |
| 4286018969 | Incomplete CI filters | 7: correctness offline job runs on every PR and main push without path filtering |
| 4286026728 | Unsupported backlog type | This PR no longer adds a #1046 row. The Phase 2 plan PR (#1080) restores it as `design-decision` |
| 4296755130 | Policy for all reasons and both builds | 5.4: complete reason/copy/retry matrix, including existing save-writer compatibility policy |
| 4296755138 | First install differs from an update race | 6.2 spec 9: fresh registration, no controller, no mismatched cached bytes, partial-cache allowance and later offline recovery |

The HTTP fixture server replaces speculative browser routing of worker
requests. Every response snapshots its deployment root on arrival.

## Review result (2026-10-20)

`/bmad-code-review` and `/gds-code-review` ran on the #1047 docs diff with
their three layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). The
two skills run the same layers, so one pass covered both. Patches applied:

- Repair now fetches, verifies against the compiled digests, then replaces in
  place; it never deletes first, so a failed refill cannot strip a wasm-only
  player of the engine. Reachability is checked by a request, not
  `navigator.onLine`.
- The reason matrix is consistent: one `mismatch` string, Repair offered
  under one condition for `mismatch` and `load-failed`, the `no-save-writer`
  exception to the fallback table, `start` and `host` stated as out of scope.
- Wrong-body cases are classified: redirect or HTML content type is
  `load-failed`, a short stream is `load-failed`, a rejecting digest is
  `unverifiable`.
- Added: engine workers must use the verified loader, existing
  pre-integrity cache entries need a purge or new keys, `vite build` only
  throws on a missing record, the remaining readers of `BUILD.json`, the
  production-bundle test for condition 4, and phone measurement over HTTPS.
- Section 10 now says #1046 is restored by #1080; section 11 carries the
  review points that need the implementation's own measurements.

Not changed: decision 5 (no kill switch) is the owner's. The review's
concern about Safari and Firefox is recorded in section 11 as a merge
condition for the wasm-only flip.

Merge order: #1080 first (or together), because section 10 cites the #1046
row that PR restores. Keep #985 open until implementation and CI proof merge.

## Review follow-up (2026-10-20, takeover by the offline-package thread)

- Repair is scoped to the running build's revision keys. A waiting worker's
  engine entries share the precache and are never deleted, rewritten or
  repopulated; spec 8 now proves they stay byte-identical and that the
  waiting build can cold-start offline after it activates.
- The controller check is `navigator.serviceWorker?.controller != null`, with
  a loader test for an undefined `navigator.serviceWorker`.
- Removed a duplicated "First update" paragraph.
- The PR description now lists the three files this diff changes. The #1046
  backlog row is still restored by #1080, so this PR must not merge first.
- Repair is offered whenever a worker controls the page. The offer no longer
  depends on a reachability check; a failed fetch stops Repair and leaves
  every entry as it was.
