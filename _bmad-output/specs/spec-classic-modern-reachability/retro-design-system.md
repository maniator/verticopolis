# Retro design system: reusable page chrome

Load-bearing detail for CAP-6 (the reusable retro page kit). SPEC.md cites this
companion. The goal: the `/help` page and any future standalone page (changelog,
credits) wear the same Windows-3.1 window chrome the game already uses, from ONE
source, with no palette duplicated per page.

## What exists today

`src/styles.css` (roughly lines 22-64) holds the retro tokens as `:root` custom
properties: `--r-face #c0c0c0`, `--r-shadow #808080`, `--r-light #dfdfdf`,
`--r-hi #ffffff`, `--r-title #000080`, `--r-title-fg #ffffff`,
`--r-desktop #008080`, the `--r-font` MS Sans Serif stack, the `--bevel-out` /
`--bevel-in` bevel composites, and `--win-shadow`. The window/panel component
classes (`.win`, `.win-title`/title bar, `.well`, `.field`, `.btn`, `.kv`) build
on those. `gallery.html` currently re-declares its own copy of the palette (the
duplication this capability removes).

## The extraction

Split the shared layer out of `styles.css` into two files under `src/styles/`,
then re-import so the game's computed styles and render are unchanged (the
extraction moves rules between files; the guarantee is on the rendered result,
not on byte-identical CSS):

| File | Holds |
| --- | --- |
| `src/styles/retro-tokens.css` | the `:root` retro custom properties (palette, font, bevels, shadow) only |
| `src/styles/retro-components.css` | the shared component classes: `.win`, title bar, `.well`, `.field`, `.btn`, `.kv` |
| `src/styles.css` | `@import`s both at the top, keeps all game-only rules; app render unchanged |
| `src/styles/retro-page.css` | `@import`s the same two, plus standalone-page layout: the teal desktop ground, centered `.win` max-width, `.win-body` padding, the divergence grid, the status bar |

`gallery.html`'s duplicated palette is retired in favor of importing
`retro-tokens.css`, so there is exactly one declaration of `--r-face` in the
codebase.

## The shell helper

`pageShell(title, backHref, mainContent, links?)` (a small lit template helper,
e.g. `src/ui/templates/pageShell.ts`) returns the window frame: the navy title
bar with the app icon, the `title` text, a "Back to game" `<a href=backHref>`
button, and any sibling-page `links` (e.g. Sprite Gallery), wrapping
`mainContent`, with a footer carrying a second "Back to game" link. `/help` is
its first consumer; the gallery and future pages pass their own title and body.

## Second consumer: the sprite gallery

`src/gallery.html` is restyled onto this same kit: it drops its inline copy of
the palette (currently duplicated in a `<style>` block) and imports
`retro-tokens.css` + `retro-page.css`, so `retro-tokens.css` becomes the ONLY
`--r-face` declaration in the codebase. Its header becomes the shared title bar
(via `pageShell` or the same chrome), and it gains the sibling nav: a link to
`/help` and a "Back to game" link to `/`. The gallery `<canvas>` render is not a
CSS concern; its cell-height fix is specified in SPEC.md CAP-7.

## Theme

The game commits to the single retro (light silver) world by design. The
standalone page layer (`retro-page.css`) still defines a dark-theme token
override (`@media (prefers-color-scheme: dark)` plus a `:root[data-theme]`
hook) so a shared `/help` link is comfortable in a dark viewer, without touching
the in-game look. Bevels and the navy title bar stay legible on both grounds.

## CSS Modules: explicitly rejected

Not adopted. The repo styles through one global token-based sheet and lit-html
templates carry plain `class="..."` string literals (no JSX `className` rewrite
for a bundler to hash), so CSS Modules would fragment the token model and lose
their ergonomic win while duplicating the class-prefix convention already in use.
This extraction (shared tokens + components, re-imported) IS the reuse mechanism.
If component-scoped styles are ever wanted, the lit-native path is Shadow-DOM
`static styles` on custom elements; that is a larger change and out of scope here.

## Tests

- A guard test: no HTML/CSS file other than `retro-tokens.css` declares
  `--r-face` (single palette source; the gallery de-dup is verified here).
- `styles.css` still resolves every retro token the game uses (import wiring
  intact), so the game render is unchanged by the extraction.
