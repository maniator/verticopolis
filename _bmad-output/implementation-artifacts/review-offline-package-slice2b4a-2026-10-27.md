# Review: #985 slice 2b-4a, respawn refusal latch (2026-10-27)

Surface: engine boot plumbing in `src/wasmhost/workerController.ts` (worker respawn). Reviewed with the
BMAD layers run as subagents: Blind Hunter on the diff only, Edge Case Hunter with the repo, Acceptance
Auditor against the story and design sections 5.3 to 5.5. Result: no `patch` finding.

## Triage

| # | Finding | Verdict |
|---|---------|---------|
| 1 | A worker-side `package-mismatch` without package detail (binary lacks an export the shell calls, or no `catalog`) does not latch, so each adopt re-downloads. | defer |
| 2 | `WorkerHostStatus.refusal` has no reader in the diagnostics report; support copy shows only "Last engine error". | defer to the diagnostics slice |
| 3 | Test gaps: a refusal with `file: null`, and an adopt after the latch. | fixed (new test) |
| 4 | `unverifiable` latching: the first boot does not retry either, so latching is consistent. | dismiss |
| 5 | Transient mismatch from a mid-session update: a retry cannot fix it, the reload prompt clears the latch. | dismiss |
| 6 | Wasm-only build: the worker host does not exist there. | dismiss |
| 7 | Consumers and analytics: `refusal` is read nowhere, no new production field. | dismiss |
| 8 | A refused respawn that settles after `stop()` still writes `refusal`: predates the slice, dead handle only. | dismiss |

## Acceptance

The deferred "respawn refusal latch and detail" note on the `offline-pwa-engine-audio` backlog row is
replaced by the 2b-4a text. Mismatch and unverifiable latch, load-failed keeps retrying, and all are
tested. No version bump: the path is the experimental worker host and nothing changes for a player.
