---
title: 'Save-quota hardening on the context-loss reload path'
type: 'bugfix'
created: '2026-07-06'
status: 'done'
route: 'one-shot'
backlog: 'pr-110-compress-saves (P2)'
lane: 'bmad (persistence/storage)'
---

# Save-quota hardening on the context-loss reload path

## Intent

**Problem:** `SaveLoad.recoverFromContextLoss` (the WebGL-context-loss auto-recovery
path) flushed the tower with an **unguarded** `save()` and then reloaded. A
`localStorage` write that throws — quota exhausted, Safari private mode, or a
security exception — escaped the `onContextLost` handler and **aborted the reload**,
stranding the player on a dead GPU canvas with no message. (The sibling update path,
`saveBeforeUpdate` in `main.ts`, was already guarded: its try/catch pauses the update
rather than reloading, so progress is never lost there.)

**Approach:** Wrap the pre-reload flush in a try/catch. On failure the GPU is dead and
we cannot keep rendering, but we must not silently reload past unsaved changes either —
so surface the existing boot card (with a Reload button), the same pattern used for a
repeat GPU crash. A failed `setItem` is **atomic** (it never clobbers the key), so any
prior autosave stays intact — no write-to-temp-then-swap is needed. The card copy is
tailored to whether a prior save exists, so a returning player isn't told their tower
is gone when their last autosave is safe.

## Acceptance Criteria

1. A context loss whose pre-reload flush **throws** shows the boot card (Reload button)
   and does **not** call `location.reload()` — the throw no longer aborts recovery. This
   holds even when storage is fully **disabled** (a `SecurityError` where the in-handler
   `hasSave()` read also throws): the catch must not re-throw before the card is shown.
2. The prior autosave is preserved across the failed write and remains loadable
   (a failed `setItem` does not clobber).
3. When a prior save exists, the card says the last saved tower is safe; when none
   exists, it makes no such (false) claim.
4. The happy path (save succeeds) is unchanged: stamp `sessionStorage`, reload
   (deferred while the tab is hidden), with the twice-in-90s loop guard intact.
5. The update path's contract holds: `saveBeforeUpdate` still **throws** on a failed
   flush so `main.ts` pauses the update instead of reloading.
6. Covered by tests in `gameControllersCoverage.test.ts` for AC 1–3 and 5.

## Suggested Review Order

1. [`src/game/saveLoad.ts` — `recoverFromContextLoss` guard](../../src/game/saveLoad.ts)
   — verify the try wraps only `save()`, the catch shows the card + `return`s before the
   reload block, and the reload/loop-guard logic below is unaffected.
2. [`src/storage/SaveGame.ts` — `saveTo`/`save`](../../src/storage/SaveGame.ts)
   — confirm `setItem` is the only write and a throw leaves the prior value intact (basis
   for AC 2); `saveTo` must keep throwing (the update path relies on it — AC 5).
3. [`src/tests/gameControllersCoverage.test.ts` — SaveLoad recovery tests](../../src/tests/gameControllersCoverage.test.ts)
   — the failing-save card test (no reload, prior tower survives) and the
   `saveBeforeUpdate`-propagates-throw test.
