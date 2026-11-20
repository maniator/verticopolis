# Windows in the game's code

The look of every window (the tokens, `.win`, `.win-title`, `.btn`, `.well`,
the window grammar, the responsive tiers) is the design system in
Verticopolis/components:
[`docs/design-system.md`](https://github.com/Verticopolis/components/blob/main/docs/design-system.md),
with the stylesheet the game imports from `@verticopolis/components`. This
page keeps the rules for the game's own TypeScript that builds those windows.

- **Two ✕ builders, no third.** `UI`'s `titleBarClose()` (`src/ui/UI.ts`)
  builds the ✕ for DOM-built windows (the modal, the inspector), and the
  `titleBar` template in `src/ui/templates/editor.ts` builds the editor card's.
  Never hand-write a third copy; extend one of those.
- **The ✕ goes through the cancel path.** A modal's ✕ does what Esc does.
  Never call `closeModal()` directly from a close affordance, or a modal that
  resolves a pending choice (the emergency dialog) deadlocks the paused game.
- **Focus lands on the primary action.** The ✕ is appended after
  `showModal()`, so keyboard focus lands on the primary button, not on
  dismiss.
- **One phone query.** `mobileMq` in `src/main.ts` mirrors the phone tier of
  the stylesheet (`max-width: 767px`, or a short landscape screen
  `max-width: 1023px and max-height: 599px`). Change the two together.

The 1994 desk's window rules (what moves, resizes, minimizes and where each
window starts) are [desk-windows.md](./desk-windows.md).
