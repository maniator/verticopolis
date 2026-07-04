# Deferred work

Items surfaced by reviews that are real but intentionally not actioned in the
PR that found them. Pick these up when touching the relevant area.

## Deferred from: code review (2026-07-03, PR #110 — compress localStorage saves)

- **`hasSave()` ≠ `load()` for an unreadable present save** (`SaveGame.ts` `hasSave` vs
  `readSlot`; boot at `main.ts:95`/`257`/`282`). `hasSave()` only checks key presence and
  never decodes, so a corrupt/oversized `VCZ1:` value makes the splash offer **Continue**
  yet drop the player into a fresh tower, which the 30s autosave then overwrites. Pre-existing
  (invalid raw JSON did the same); the `fatal` decoder + 32MB cap widen the "exists but won't
  load" set marginally. A corrupt *compressed* save is unrecoverable regardless, so the
  incremental harm is UX (misleading Continue), not new recoverable-data loss. Fix when
  touching the boot flow: distinguish "no save" from "save present but unreadable" so the boot
  path surfaces the corruption instead of silently starting fresh + clobbering.

- **`localStorage.setItem` `QuotaExceededError` unhandled on the pre-reload paths**
  (`SaveGame.ts` `saveTo`; `saveLoad.ts:55`/`72`). `recoverFromContextLoss` and `onUpdateReady`
  call `save()` immediately before `location.reload()`; an uncaught quota/private-mode throw
  there aborts the reload. Pre-existing (no guard before), and this PR *mitigates* it (~20×
  smaller writes). Fix when hardening persistence: wrap `setItem` and, on failure, keep the
  prior good value + surface a toast rather than throwing across the reload.

## Deferred from: code review (2026-07-04, event visuals — thief/treasure/VIP)

- **VIP inspection limo replays every 5 game-days on a persistently-failing tower**
  (`Simulation.ts` `checkVip` — `triggerVip()` fires before the pass/fail check, and a
  failed inspection reschedules `vipVisitDay = day + 5`). A tower with a Wedding Hall
  stuck below the TOWER criteria replays the 6.5s limo cosmetic every 5 days with no
  throttle — unlike the nag lines, which throttle on `lastVipNagDay`. Low/cosmetic and
  arguably in-character ("the VIP keeps coming back to inspect"); fix by throttling the
  limo (or only firing it on a passing inspection) if it ever reads as noisy.

## Completed

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
