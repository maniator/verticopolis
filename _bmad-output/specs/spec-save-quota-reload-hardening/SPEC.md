---
id: SPEC-save-quota-reload-hardening
companions: []
sources: []
---

> **Canonical contract.** This SPEC is the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only.

# Save-quota hardening on the context-loss reload path

## Why

A **pain to solve.** When the WebGL context is lost (mobile browsers reset it under memory pressure), `SaveLoad.recoverFromContextLoss` flushes the tower and reloads onto a fresh context so the player never sees a dead screen. It flushed with an **unguarded** `save()`: a `localStorage` write that throws — quota exhausted, private mode, or storage disabled (`SecurityError`) — escaped the `onContextLost` handler and **aborted the reload**, stranding the player on a dead GPU canvas with no explanation. The affected player is one whose device is under memory pressure *and* whose storage is full or blocked — precisely the fragile moment this recovery path exists to cover. Backlog P2 (`pr-110-compress-saves`); the sibling update path (`saveBeforeUpdate`) was already guarded.

## Capabilities

- **CAP-1**
  - **intent:** When a context-loss recovery's pre-reload flush throws, the player is handed a recoverable boot card instead of a silently-aborted reload — recovery never dead-ends on a storage failure.
  - **success:** A failing flush produces exactly one boot card with a Reload button and does **not** call `location.reload()`; this holds even when storage is fully disabled (the in-handler `hasSave()` read also throws).

- **CAP-2**
  - **intent:** The card's reassurance matches reality — the player is told their prior tower is safe only when one actually exists.
  - **success:** With a prior autosave present, the card copy contains "last saved tower is safe"; with none, it does not. The card's guidance is accurate for both a full and a blocked storage failure.

## Constraints

- The in-catch `SaveGame.hasSave()` read must be guarded in its own try/catch: `getItem` also throws when storage is *disabled* (`SecurityError`), and an unguarded read would re-throw before the card is shown, re-aborting the reload — the exact defect this fixes.
- `SaveGame.saveTo` must keep throwing on a failed write: the update path (`saveBeforeUpdate` → `main.ts`) relies on the throw to pause the update rather than reload, and that contract must not regress.
- A failed `setItem` is atomic (it never clobbers), so the prior autosave survives untouched — no write-to-temp-then-swap is introduced.
- Card copy must be accurate for **both** failure classes it catches — storage full (quota) and storage blocked (private mode / `SecurityError`) — so "free up space" is not the only guidance offered.

## Non-goals

- Changing the update path (`saveBeforeUpdate`), which is already correctly guarded in `main.ts`.
- Altering PR #110's compression / quota-headroom mechanics — this is failure-path hardening, not a change to how much a save costs.
- Cross-reload post-recovery toast signaling: the boot card is the notification; no state is carried across the reload to surface a message afterward.

## Success signal

A player whose GPU drops while storage is full or blocked sees a clear card — "your latest changes couldn't be saved — storage is full or blocked … free up space or allow site storage, then reload" — with a Reload button and a truthful note about whether their last tower is safe, instead of a frozen dead canvas. Their prior autosave remains loadable after reload.
