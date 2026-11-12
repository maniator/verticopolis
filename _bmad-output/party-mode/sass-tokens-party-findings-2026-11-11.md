# Party findings: Sass for the theme colors and tokens (2026-11-11)

Room: the Web Game Room with BMAD and GDS dev voices pulled in (Winston,
Amelia, Paige, Cloud Dragonborn, Link Freeman). The owner asked the room to
consider Sass for issue #1952, which lifts the title screen's colors out of
`src/styles.css` and `src/ui/splashTemplate.ts` into `src/styles/retro-tokens.css`
so the docs site stops copying them.

What was on the table:

- `retro-tokens.css` is 47 lines of CSS custom properties. Four consumers
  read it: the game (`styles.css` and `retro-page.css` `@import` it), the docs
  site (Starlight's `customCss`), the Rust reference chrome
  (`docs/engine-site/scripts/rustdoc-chrome.mjs` reads it as text and inlines
  it into a `<style>`), and guard tests that read it as text
  (`retroPaletteSingleSource.guard.test.ts` and others).
- The docs site and the Rust reference switch light and dark at run time by
  redefining the same variables under `data-theme` selectors. The game has no
  dark mode.
- `styles.css` is 2,767 lines with 61 hex literals; the splash literals
  (`#ffc94a` six times, `#e6dcc0` three times, `#20204a`, `#0d0d10`,
  `--splash-sky`) are the ones #1952 names.
- No Sass, PostCSS or Lightning CSS config is in either build today.

## The round

🏗️ **Winston:** Start with what a token is here. Every consumer reads
`retro-tokens.css` at run time or as text. A Sass `$variable` exists only at
compile time, so the moment we move the palette into `$r-face` we need a
compile step in front of the game, the docs, the rustdoc script and the
guards. Four builds learn Sass to save us nothing #1952 needs.

💻 **Amelia:** Agree on the tokens. Sass would still help `styles.css`, though.
2,767 lines, one file. Partials and mixins for the bevel boxes would make it
navigable.

📐 **Juno:** The bevels are already tokens: `--bevel-out`, `--bevel-in`,
`--win-shadow`. A mixin would write the same `box-shadow` line we write now.
And partials are just `@import` of plain CSS files, which Vite already
bundles into one sheet.

🕸️ **Theo:** And nesting, the other thing people reach for Sass for, ships in
every browser we support. If an old Safari ever matters, Vite can lower it
with Lightning CSS, no new language.

😤 **Grumbal:** Nobody asked the real question. What breaks? The rustdoc
script does `readFileSync("retro-tokens.css")` and pastes it into a style tag.
Make that `.scss` and the Rust reference ships raw `$r-face: #c0c0c0;` to the
browser, which ignores it, and the page renders in rustdoc's default colors.
No error, no failing test, just a wrong page. The guard that counts `--r-face`
declarations goes quiet the same way.

📚 **Paige:** That's my worry from the docs side. Today the one file is
readable by a person, a test and three builds. "Change the theme here once"
is in its header comment and it's true. With Sass it becomes "change the
theme here, then make sure four pipelines compiled it."

🐉 **Cloud Dragonborn:** The dark mode settles it for me. The docs and the
Rust reference flip themes by redefining custom properties under
`[data-theme]`. Sass can't do that at run time. You'd end up with Sass
variables that compile into custom properties, which is the file we already
have, plus a step.

🎮 **Link Freeman:** So #1952 is a plain CSS change. Add `--splash-sky`,
`--splash-amber`, `--splash-cream`, `--splash-ink` and the deep navy to
`retro-tokens.css`, swap the literals in `styles.css` and `splashTemplate.ts`,
point the docs' `--ts-*` at them, and put the skyline in `src/public/` as one
SVG. That's a small PR.

💻 **Amelia:** Fine, but the 2,767 lines is still real.

🏗️ **Winston:** Then split it into plain CSS files the way `src/styles/`
already does (`overview-map.css`, `retro-components.css`). That's a separate
issue, and it needs no Sass either.

😤 **Grumbal:** Write down when Sass would be worth it, so this doesn't come
back every month.

🐉 **Cloud Dragonborn:** When we need something CSS can't do at all: loops
that generate many rules from a table, or math on colors that `color-mix()`
can't express. Neither exists here.

## Where the room landed

1. **No Sass.** The tokens must stay CSS custom properties, because the docs
   site and the Rust reference switch light and dark by redefining them at
   run time, and because the rustdoc chrome script and the guard tests read
   the token file as text. Sass would add a compile step to four consumers
   and a silent failure mode (raw Sass shipped into the rustdoc page).
2. **Do #1952 in plain CSS** as filed: `--splash-*` tokens in
   `retro-tokens.css`, the literals in `styles.css` and `splashTemplate.ts`
   replaced, the docs' copies removed, and the skyline as one shared SVG.
3. **Amelia's point stands on its own:** `styles.css` at 2,767 lines could be
   split into plain CSS files under `src/styles/`. Worth its own issue if the
   owner wants it; it needs no preprocessor.
4. **Revisit Sass only** if a rule set needs generating from a table or color
   math beyond `color-mix()`.
