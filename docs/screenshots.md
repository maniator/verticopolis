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

### The committed images come from the pinned Docker image, not a host browser

The Chromium build and system fonts decide antialiasing, so an image captured on
one machine's browser rarely matches another's: commit a host capture and every
later regen re-renders every PNG, flooding the diff with noise. So the **canonical
committed set is minted inside the pinned Playwright Docker image** (one Chromium
build for the whole repo), never from a host browser. That image is what CI runs,
and running the **same pinned image locally is equivalent** and may be committed
(see [CONTRIBUTING.md](../CONTRIBUTING.md) → Screenshots). In CI, two workflows
produce it, both in the image pinned to the **exact Playwright version locked in
`package-lock.json`**:

- [`pr-drift-check.yml`](../.github/workflows/pr-drift-check.yml) regenerates
  `docs/screenshots/**`. On every render-affecting PR it renders the gallery and
  compares it against the committed set; if they differ the required `drift-gate`
  check is red until the gallery is refreshed. To refresh it, a maintainer
  approves the run's `commit-on-approval` job (Actions tab -> the run -> Review
  deployments -> approve `screenshot-approval`), which commits the regenerated
  pixels straight to the PR branch. It calls the reusable capture in
  [`screenshot-capture.yml`](../.github/workflows/screenshot-capture.yml).
- [`update-visual-baselines.yml`](../.github/workflows/update-visual-baselines.yml)
  mints the `e2e/visual.spec.ts-snapshots` baselines the visual-regression gate
  compares against. A **marker push** triggers it: put `[update-baselines]` in the
  head commit message and push.

The bot commits the refreshed images on the same branch; review that commit's
image diff like code. Because the bot pushes with `GITHUB_TOKEN`, that commit
fires no workflow run of its own. For the visual baselines that just means the
commit carries no CI run. For the docs gallery it also means the required
`drift-gate` check does not re-run on the new head by itself, so re-trigger CI on
that commit for the gate to re-evaluate the refreshed gallery and go green before
merge.

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

### Mode-forked shots: the `-classic` / `-modern` suffix

Most of the game renders identically under the Classic and Modern rule-sets, so
the gallery captures almost every scene **once**, in one mode, and adding a
second mode there would double render time for identical pixels. But the
pricing split (v1.50.0, PR #440) made a handful of surfaces genuinely diverge,
and those shots now render **one variant per mode**, suffixed `-classic` /
`-modern`:

- **The new-game dialog** (`00b-onboarding-*`): the rule-set picker with the
  Classic card selected vs the Modern card (and its calendar sub-picker).
- **The editor card's price control** (`features/editor-pricing-*`): the 1994
  rung picker (Classic) vs the free +/- steppers (Modern).
- **The batch pricing dialog** (`10-batch-pricing-*`): the rung-picker dialog
  body (Classic) vs the number-band editor (Modern).
- **The stats Tenancy block** (`features/stats-tenancy-*`): Classic shows the
  Vacancies row's off-market (No Rate) split; Modern (which never holds the
  No-Rate state) shows plain vacancies plus the Modern-only Households readout.

The Classic halves render off the existing classic scene towers; the Modern
halves share one compact modern-rules tower builder across two light scenes
(`pricing-modern` for the features-resolution shots, `pricing-modern-batch`
for the showcase-resolution batch dialog, since a scene's outDir decides its
device scale factor and each half of a pair must mint at its sibling's scale).
Every non-diverging scene stays single-mode. When a future change makes
another surface diverge, fork **only that surface's shot** the same way
(suffix both variants, matching resolution; never fork a whole scene that
renders the same in both modes).

## Committing

Commit the PNGs; don't leave them as throwaway files:

- **Showcase** shots live in `docs/screenshots/`.
- **Feature** shots live in `docs/screenshots/features/`, each with a row in that
  folder's [`README.md`](screenshots/features/README.md) saying what it shows.
- **Milestone** (star-ladder) shots live in `docs/screenshots/milestones/`.

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
