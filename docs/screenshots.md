# Screenshots

How Verticopolis captures screenshots — for the README and feature galleries, and
for showing a change in a pull request.

## Capturing

Screenshots are taken from the **real, built app**, driven headless with
Playwright, so they can't drift from what actually ships. Two entry points:

- `npm run screenshots` — regenerates the full showcase set into
  `docs/screenshots/`.
- A focused capture for one feature:
  `SHOT_SCRIPT=scripts/shot-<feature>.mjs node scripts/serve-and-shoot.mjs`.
  Copy an existing `scripts/shot-*.mjs` as a starting point — each builds a tower
  through the public `window.game` API and screenshots the relevant part of the
  UI (e.g. the `#topbar` HUD) at desktop and mobile widths.

## Committing

Commit the PNGs — don't leave them as throwaway files:

- **Showcase** shots live in `docs/screenshots/`.
- **Feature** shots live in `docs/screenshots/features/`, each with a row in that
  folder's [`README.md`](screenshots/features/README.md) saying what it shows.

## Embedding in a pull request

Any PR with a visual or gameplay change should **show** the change, not just
describe it — a sentence like "the chip now reads Gridlock" is not a screenshot;
reviewers (and the merged record) need the actual image. Commit the before/after
PNGs (above), then embed them in the PR's **Screenshots / recordings** section so
they render inline:

```md
![before](https://raw.githubusercontent.com/<owner>/<repo>/<ref>/docs/screenshots/features/your-shot-before.png)
![after](https://raw.githubusercontent.com/<owner>/<repo>/<ref>/docs/screenshots/features/your-shot-after.png)
```

- `<ref>` is your PR's **branch name** (renders live during review) or `main`
  (resolves once the PR merges).
- For a PR from a **fork**, `<owner>/<repo>` is the fork's owner/repo, not the
  upstream — otherwise the image won't render during review.
- An HTML `<img src="…" width="…">` tag works too, and lets you size the image
  (handy for a narrow mobile shot next to a wide desktop one).
