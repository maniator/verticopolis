# Screenshots

How Verticopolis captures screenshots: for the README and feature galleries, and
for showing a change in a pull request.

## Capturing

Every image under `docs/screenshots/**` is produced by **one** generator,
[`scripts/screenshots.ts`](../scripts/screenshots.ts). It drives the **real,
built app** headless with Playwright (through the public `window.game` API), so
the shots can't drift from what actually ships. There are no per-feature scripts
any more; one declarative `SCENES` manifest maps every shot to the state it
needs, so a new shot is a new manifest row, not a new file.

### The committed images come from CI, not a local run

The Chromium build and system fonts decide antialiasing, so an image captured on
one machine's browser rarely matches another's: commit a host capture and every
later regen re-renders every PNG, flooding the diff with noise. So the **canonical
committed set is minted in CI**, inside the pinned Playwright Docker image (one
Chromium build for the whole repo), never on a laptop:

- [`update-screenshots.yml`](../.github/workflows/update-screenshots.yml)
  regenerates `docs/screenshots/**` and commits it back.
- [`update-visual-baselines.yml`](../.github/workflows/update-visual-baselines.yml)
  mints the `e2e/visual.spec.ts-snapshots` baselines the visual-regression gate
  compares against.

Both run in the image pinned to the **exact Playwright version locked in
`package-lock.json`**. A **marker push** triggers them: put `[update-screenshots]`
and/or `[update-baselines]` in the head commit message and push. The bot commits
the refreshed images on the same branch; review that commit's image diff like
code. (Because the bot pushes with `GITHUB_TOKEN`, its commit gets no CI run of
its own, so push or rebase once more after pulling it to land a green check.)

### `npm run screenshots` (local preview only)

```
npm run screenshots        # host Chromium: build + serve + capture
```

Fast, for **previewing** your scene changes locally. The in-canvas game pixels
match the container, but the DOM chrome can differ by a hair, so use it to see
your work, **not** to produce the images you commit. Env knobs:

- `ONLY=milestones,tablet`: re-shoot just those scene ids (fast iteration).
- `RUN_SERVER=1`: spawn a `vite preview` for the capture (what the script uses).
- `BASE_URL` / `PORT` / `PW_CHROME`: point at an existing server / browser.

### How a scene is built

Each scene stages its sim once (a self-contained builder run via `page.evaluate`)
then captures its shots off that state; a shot is a bag of optional drivers
(`clock`, `overlay`, `frame`, `crop`, `viewport`, `setup`). Guardrails are baked
in: the splash is dismissed **and asserted gone**, tower scenes assert a
non-empty tower, milestone scenes assert the sim's own `evaluateStar()` actually
reached the target star (so a milestone can't silently under-build), every
builder reads **canon facility widths from the sim** (never hardcoded strides,
which would overlap and gap a floor), and a pre-capture sweep clears stray toasts
/ event dialogs a running sim may pop. One flake logs `✗ name` and the run
continues; the tail prints a per-directory count and a non-zero exit on any
failure.

## Committing

Commit the PNGs; don't leave them as throwaway files:

- **Showcase** shots live in `docs/screenshots/`.
- **Feature** shots live in `docs/screenshots/features/`, each with a row in that
  folder's [`README.md`](screenshots/features/README.md) saying what it shows.
- **Milestone** (star-ladder) shots live in `docs/screenshots/milestones/`.

A few historical before/after shots capture a *pre-fix* build the current code
can no longer reproduce (`traffic-chip-before`, `tablet-*-before`); the generator
skips them and leaves the committed files untouched.

## Embedding in a pull request

Any PR with a visual or gameplay change should **show** the change, not just
describe it: a sentence like "the chip now reads Gridlock" is not a screenshot;
reviewers (and the merged record) need the actual image. Commit the before/after
PNGs (above), then embed them in the PR's **Screenshots / recordings** section so
they render inline:

```md
![before](https://raw.githubusercontent.com/<owner>/<repo>/<ref>/docs/screenshots/features/your-shot-before.png)
![after](https://raw.githubusercontent.com/<owner>/<repo>/<ref>/docs/screenshots/features/your-shot-after.png)
```

- `<ref>` can be a **commit SHA** (most stable: it survives branch deletion,
  never drifts if the shot is later replaced, and avoids ambiguity with branch
  names containing `/`; preferred for the archival PR record), your PR's **branch
  name** (renders live during review), or `main` (resolves once the PR merges).
- For a PR from a **fork**, `<owner>/<repo>` is the fork's owner/repo, not the
  upstream, otherwise the image won't render during review.
- An HTML `<img src="…" width="…">` tag works too, and lets you size the image
  (handy for a narrow mobile shot next to a wide desktop one).
