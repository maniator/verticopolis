# Party findings: the docs site's look (2026-11-11)

Room: Web Game Room, a UI/UX round on `docs/engine-site/` after the owner
moved it to Starlight and asked that it wear the game's own colors and theme
elements. His notes on the first pass: the black rule under the title bar
"looks crappy", and the Rust API reference button needs padding. On the
table were screenshots of the first pass, the game's title screen
(`docs/screenshots/00-splash.png`) and its How to Play window
(`02-help.png`).

## The round

🎨 **Sally:** The first pass borrowed the wrong game. A developer's first
look at Verticopolis is the title screen: the dusk sky, the setting sun, the
skyline, VERTICO in cream and POLIS in amber. Our landing page is the teal
desktop you only see in the margins behind a window. It reads as "Windows 3.1
theme for Starlight", not as this game.

📐 **Juno:** So split it the way the game splits it. The landing is the title
screen: the `--splash-sky` gradient, the sun, the skyline, the wordmark as
the same SVG `<text>`, and the splash buttons (cream plate, 2px ink border,
amber primary). Every other page is the How to Play window: navy title bar,
silver panels, navy selected row. Two looks, each one the game already has.

🎲 **Samus Shepard:** And drop the app icon from the hero. The wordmark is
the brand; the icon next to it is the same tower drawn twice.

😤 **Grumbal:** The owner's two notes were a line and some padding. Fix
those, then redecorate.

🎨 **Sally:** The line and the padding are symptoms. Three hero buttons in
three different styles (silver, navy, white) is why one of them looked
unfinished. The splash has one rule: exactly one amber plate, everything
else cream. Do that and the padding problem goes away, because they share a
size.

📐 **Juno:** The rule was the header's own 1px hairline plus my 2px black
border on top of it. A Win 3.1 title bar has no rule under it; it ends where
the navy ends. Navy edge, gone.

♿ **Wren:** Two conditions. One: the global focus ring is navy in the game,
and on the dusk sky it vanishes. The splash already uses a 2px amber
`#ffc94a` ring there; copy that. Two: body text stays on a white well, not on
silver. Silver is fine for a dialog you read for ten seconds and tiring for
a 600-line changelog.

😤 **Grumbal:** And the cards? Silver boxes with a bevel floating on teal look
like a skin.

📐 **Juno:** On the dusk sky they become little game windows: a navy title
strip with the white title, silver body, the hard 2px shadow. That's
`.win` + `.win-title` from `retro-components.css`, pixel for pixel.

🎨 **Sally:** The sidebar group labels should be the Tools panel's section
labels: small, uppercase, navy, letter-spaced ("TOOLS", "STRUCTURE"). That
one detail does more for "this is the game" than any color.

📱 **Ben:** On the phone, the splash stacks its buttons and keeps them at
least 42px tall. The first pass's hero buttons were fine, but the "Next"
pagination box at the bottom was a white rounded rectangle from Starlight,
the one thing on the page that wasn't ours.

♿ **Wren:** Square it and bevel it like every other control, and keep it
44px.

😤 **Grumbal:** Last one. You're copying the skyline paths and the splash
colors into the docs. Copies drift.

📐 **Juno:** The chrome tokens already come from `retro-tokens.css` at build
time. The splash colors are literals in the game's `styles.css`, not tokens,
so the docs can't import them without editing the game's CSS, which is a
deployed path and out of scope for a docs PR. Copy them with a comment that
names the source, and lift them into `retro-tokens.css` in a later app PR.

😤 **Grumbal:** Write that down where someone will find it, or it never
happens.

## Decisions

1. **Landing = the title screen.** Dusk sky gradient, sun, skyline, the
   VERTICO/POLIS wordmark (same SVG text and font stack) with an
   "ENGINE DEVELOPER DOCS" tagline. No app icon in the hero.
2. **One amber button.** "Use it from JavaScript" is the amber primary;
   "Use it from Rust" and "Rust API reference" are cream plates. All three
   are the splash button (2px ink border, bevel, hard shadow, 42px tall, same
   padding).
3. **Cards are game windows** on the sky: navy title strip, silver body,
   hard shadow.
4. **Pages = the How to Play window.** Navy title bar with no rule under it;
   silver sidebar with Tools-panel section labels (small, uppercase, navy,
   letter-spaced); navy selected row; reading text on a white well.
5. **Focus:** 2px navy ring on pages (the game's global rule), 2px amber on
   the dusk sky (the splash's rule).
6. **Pagination and the phone controls** are square, bevelled and at least
   44px tall.
7. **Provenance:** chrome tokens come from `src/styles/retro-tokens.css`
   at build time; the splash literals (`--splash-sky`, `#ffc94a`, `#e6dcc0`,
   the skyline paths) are copied from `src/styles.css` and
   `src/ui/splashTemplate.ts` with a comment naming them. Follow-up: lift the
   splash colors into `retro-tokens.css` so both read one source.
