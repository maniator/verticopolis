---
id: SPEC-event-log-toast-freeze
companions: []
sources: []
---

> **Canonical contract.** This SPEC is the complete, preservation-validated contract for what to build, test, and validate.

# Event-log toast/bulletin pump freeze after 200 entries

## Why

A **pain to solve** (player-reported). A thief cosmetic can slink across the tower with **no matching log line and no toast** — an unexplained figure that reads as a bug. A repro-first investigation traced it to a general defect, not a thief-specific one: `Simulation.emit` caps the event log at 200 via push-then-shift, so `log.length` pins at 200; `UI.renderLog` diffs "new entries" off `log.length` (`if (log.length === this.lastLogLen) return`), so once both reach 200 it early-returns **permanently** — every subsequent toast and every bulletin update is silently dropped. Cosmetics (`thiefFx.seq` and siblings) ride a separate monotonic counter and keep animating, so after ~200 events in a session *all* good/bad toasts and the whole event log die while the animations play on. The thief is simply the most dramatic silent cosmetic, which is why a player noticed it. Backlog P2 (`event-visuals`).

## Capabilities

- **CAP-1**
  - **intent:** The toast notifications and the event-log bulletin keep working for the whole session, no matter how many events have already fired.
  - **success:** After more than 200 emits, a subsequent `good`/`bad` emit still produces a toast **and** re-renders the bulletin.

- **CAP-2**
  - **intent:** An event's cosmetic and its explanatory log/toast line can no longer diverge — the fix is general to all events, not a thief special-case.
  - **success:** A thief event triggered after the cap's worth of prior events shows both its cosmetic and its log/toast line.

- **CAP-3**
  - **intent:** The bulletin is a usable, scrollable history the player can look back through — not a 40-line strip that clips — and it keeps accepting new lines forever, never freezing at a limit.
  - **success:** The panel renders a session's worth of recent lines (scrollable via the existing `overflow-y:auto`), the newest line is always present after any number of events, and the oldest lines roll off (append + prune) rather than the panel stalling.

## Constraints

- Diff the log on a **monotonic** signal, not `log.length`: add a `Simulation.logSeq` counter incremented on every `emit` (never decremented by the 200-cap shift); `UI.renderLog` diffs `sim.logSeq` against its last-seen value and clamps the fresh count to `[0, log.length]` (older entries were shifted out and can't be shown/toasted).
- `logSeq` is a transient UI-diff aid: **engine-pure** (no DOM), and **not serialized** — the log itself isn't serialized, so both reset to 0 on reload.
- On a tower swap (`adoptSim`: load / import / new-tower / undo / redo), reset the UI log baseline to the new sim's `logSeq` and refresh the bulletin — otherwise the stale baseline skips or spams toasts for the new sim (a secondary desync the investigation flagged).
- Preserve existing behavior: only `good`/`bad` entries toast; the log stays a bounded ring.
- **Performance (hard, first-class): the rendered bulletin's DOM node count is held CONSTANT** at a fixed cap (`LOG_DOM_CAP` = 300) — append the newest line, prune the oldest — so a long session can never grow the log large enough to jank a slow phone or mobile browser. Never rebuild the whole log via `innerHTML` per frame (that resets scroll during review and is the mobile-perf killer); append incrementally. Bulletin lines use `textContent` (auto-escaped), never interpolated `innerHTML`.
- Buffer and DOM caps are paired (both 300 — a session's worth of scrollback); the engine ring is cheap (~100 bytes/entry) and the DOM stays light.
- **Toast burst is capped, too.** A catch-up frame (fast-forward / backgrounded tab) can flush a batch of up to `LOG_DOM_CAP` fresh entries at once; `renderLog` fires at most `TOAST_MAX` (= 5, the on-screen toast limit) toasts per frame — only the newest good/bad lines of the batch — so a resume never spawns hundreds of transient toast nodes+timers just to prune them. The bulletin still records every fresh line for scrollback.
- **The bulletin line is the durable record.** `renderLog` appends the line *before* calling `toast()`, and wraps `toast()` so a throw can't drop the line or stall the rest of the batch. Slice the fresh window as `log.slice(length - fresh)` with an explicit `fresh <= 0` early-return — never `log.slice(-fresh)`, since `-0` re-renders the whole buffer.

## Non-goals

- Changing the thief cosmetic itself, the 200-entry cap size, or which log kinds surface as toasts.
- Persisting the log or replaying toasts after a reload — the log is transient, so a reload starts clean by design.

## Success signal

In a long session (past 200 logged events), a thief — or any `good`/`bad` event — still shows its toast and its event-log line, so no cosmetic ever plays unexplained. The freeze that silenced all notifications after 200 events is gone.
