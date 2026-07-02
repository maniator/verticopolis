# Deferred work

Items surfaced by reviews that are real but intentionally not actioned in the
PR that found them. Pick these up when touching the relevant area.

## Deferred from: code review of PR #91 (2026-07-02)

- **Inspector card re-shows on continued hover after ✕-dismissal** on narrow
  *hover-capable* windows (≤860px with a mouse/pen): `showInspector(null)` hides
  the card, but the next `pointermove` over the same facility re-opens it
  (`main.ts` `onHover` → `inspectPicked`). Standard hover-tooltip semantics —
  adding a "dismissed until the picked target changes" latch is a design call.
- **`escapeAttr` is used for text-node content** throughout the stats/inspector
  HTML builders, and engine-internal strings (`c.dayName`, star text) are
  interpolated unescaped. Safe today (all engine constants), but the pattern
  invites an injection regression if one of them ever becomes user-influenced.
  Pre-existing; consider a dedicated `escapeText` helper when next in there.
