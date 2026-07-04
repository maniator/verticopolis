# Deferred work

Items surfaced by reviews that are real but intentionally not actioned in the
PR that found them. Pick these up when touching the relevant area.

## Deferred from: code review (2026-07-03, PR #110 — compress localStorage saves)

- **`localStorage.setItem` `QuotaExceededError` unhandled on the pre-reload paths**
  (`SaveGame.ts` `saveTo`; `saveLoad.ts:55`/`72`). `recoverFromContextLoss` and `onUpdateReady`
  call `save()` immediately before `location.reload()`; an uncaught quota/private-mode throw
  there aborts the reload. Pre-existing (no guard before), and this PR *mitigates* it (~20×
  smaller writes). Fix when hardening persistence: wrap `setItem` and, on failure, keep the
  prior good value + surface a toast rather than throwing across the reload.

## Completed

- ~~**`hasSave()` ≠ `load()` for an unreadable present save**~~ — done 2026-07-04:
  `SaveGame.loadResult()` distinguishes an absent save from a present-but-unreadable one;
  boot (`main.ts`) uses readability (not mere presence) for the splash so a corrupt save
  no longer offers "Continue", and it emits a bulletin/toast telling the player their save
  couldn't be read before starting fresh. Unit-tested (`storage.test.ts`) and live-verified.

- ~~**Inspector card re-shows on continued hover after ✕-dismissal**~~ —
  done 2026-07-02: `inspectDismissed` latch in `main.ts` keeps the card closed
  while the pointer keeps picking the same facility; the latch is spent as soon
  as the pick moves to anything else (fresh hover = fresh intent). The ✕ routes
  through the new `onInspectorClose()` callback so the app owns the state.
- ~~**`escapeAttr` used for text content / raw engine-string interpolation**~~ —
  done 2026-07-02: single shared `escapeHtml` in `src/ui/escape.ts` replaces the
  two duplicate local helpers, and the previously **raw** user-controlled
  `u.label` in the inspector card (settable via Rename) is now escaped — the
  exact regression this entry predicted had already shipped.
