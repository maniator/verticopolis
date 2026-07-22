import { test, expect } from "@playwright/test";
import { buildToStar } from "./helpers";

/**
 * Visual regression gate — the CI tripwire for the class of bug unit tests
 * can't see: a selector change inflating the title-bar ✕, a mis-scoped media
 * query stretching a button into a pill, a sprite refactor shifting a pixel.
 * (All three shipped before this gate existed.)
 *
 * Baselines are committed in visual.spec.ts-snapshots/ and MINTED BY CI (push
 * a commit containing "[update-baselines]" — see the update-visual-baselines
 * workflow): rasterization differs across Chromium builds, so only the CI
 * renderer's output binds. Review the bot's baseline commit like code — an
 * unexplained pixel change IS the bug. Local runs skip the pixel comparison
 * (see ignoreSnapshots in playwright.config.ts) but still smoke the dialogs;
 * on CI failure the actual/diff images land in test-results/ (uploaded as
 * the playwright-visual-diffs artifact).
 *
 * Determinism: the gallery pins performance.now before load (same trick as
 * scripts/screenshots.mjs) so canvas animation frames bake at one instant.
 * The dialog shots capture opaque DOM windows — no canvas bleed-through —
 * over a paused game (buildToStar sets speed 0) with the clock pinned.
 */

// The sprite gallery (gallery.html) is a pure canvas of every facility, and the
// drift-gate already renders and pins it as docs/screenshots/06-sprite-gallery.png
// (a hard required check). A second pixel baseline here was redundant with that,
// so it was dropped; the DOM-chrome and tower-scene shots below stay, since they
// catch selector/media-query/composition regressions the canvas drift shots can't.

test.describe("dialog chrome", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as any).game));
    // Same setup as the milestones progression: drop the splash overlay
    // without resetting the sim, then grow a real 1★ tower. buildToStar
    // freezes time (speed 0) and fixes funds, so the only nondeterministic
    // value left is the clock — pin it back to the founding minute.
    await page.evaluate(() => document.getElementById("splash")?.remove());
    const star = await page.evaluate(buildToStar, 1);
    expect(star).toBe(1);
    await page.evaluate(() => {
      ((window as any).game.sim.clock as { minutes: number }).minutes = 7 * 60;
    });
  });

  test("stats dialog matches baseline", async ({ page }) => {
    await page.click("#btn-stats");
    await expect(page.locator("#modal .modal-box")).toHaveScreenshot("stats-dialog.png");
  });

  test("editor card matches baseline", async ({ page }) => {
    // Select an office through the same path a canvas click takes.
    await page.evaluate(() => {
      const g = (window as any).game;
      const office = g.sim.tower.units.find((u: { kind: string }) => u.kind === "office");
      g.selectPicked({ type: "unit", id: office.id, kind: office.kind });
    });
    await expect(page.locator("#editor")).toHaveScreenshot("editor-card.png");
  });

  test("update prompt matches baseline and freezes the sim", async ({ page }) => {
    // Surface the update prompt exactly as the PWA layer does when a new build is
    // found — passing deterministic build info (the real fetch of version.json is
    // in pwa.ts, out of the test graph) so the "Build …" line is stable. The
    // activate callback is a no-op so the page doesn't reload.
    await page.evaluate(() =>
      (window as any).game.onUpdateAvailable(async () => {}, { version: "1.1.1", sha: "abc1234", notes: [] }),
    );
    await page.waitForSelector("#modal[open]");
    // The muted build-id line is present and reads the incoming build.
    await expect(page.locator("#modal .build-id")).toHaveText("Build 1.1.1 · abc1234");

    // While the prompt is open the sim is FROZEN — even at full speed the clock
    // must not advance, so a player reading it can't lose game-hours. (Restore
    // speed 0 afterward so the shot stays deterministic like the sibling tests.)
    await page.evaluate(() => ((window as any).game.setSpeed(3)));
    const before = await page.evaluate(() => (window as any).game.sim.clock.minutes);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => (window as any).game.sim.clock.minutes);
    expect(after).toBe(before);
    await page.evaluate(() => ((window as any).game.setSpeed(0)));

    await expect(page.locator("#modal .modal-box")).toHaveScreenshot("update-prompt.png");
  });

  test("update prompt with what's-new notes matches baseline", async ({ page }) => {
    // The optional "What's new" block: when the incoming build carries
    // player-facing notes (harvested from `Player-note:` trailers), the modal
    // shows up to three, above the build-id line. Deterministic stub info.
    await page.evaluate(() =>
      (window as any).game.onUpdateAvailable(async () => {}, {
        version: "1.1.1",
        sha: "abc1234",
        notes: [
          "Modern towers now draw families of two to five.",
          "Elevators pick up waiting riders more reliably.",
          "Condos sell for more as your tower's rating climbs.",
        ],
      }),
    );
    await page.waitForSelector("#modal[open]");
    await expect(page.locator("#modal .whatsnew li")).toHaveCount(3);
    await page.evaluate(() => ((window as any).game.setSpeed(0)));
    await expect(page.locator("#modal .modal-box")).toHaveScreenshot("update-prompt-notes.png");
  });

  test("deferred update chip matches baseline", async ({ page }) => {
    // Find an update, then choose "Later" — the deferred state where the modal
    // is gone but the "↻ Update" chip stays in the speed toolbar as the way back
    // in. Snapshot that toolbar cluster (static — no live counters) so the chip's
    // placement and styling are pinned.
    await page.evaluate(() => (window as any).game.onUpdateAvailable(async () => {}));
    await page.waitForSelector("#modal[open]");
    await page.locator('#modal [data-act="later"]').click();
    await page.waitForFunction(() => document.getElementById("modal")?.open === false);
    await page.waitForSelector("#btn-update:not([hidden])");
    await expect(page.locator("#speed")).toHaveScreenshot("update-chip.png");
  });
});

test.describe("tower scene (region-composition tripwire)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  // Full-canvas shots of a real composed tower, the coverage the gallery (one
  // unit per kind, in isolation) cannot give: cross-room composition, the
  // structure TileMap, entrances, facade, basements. The CAP-2 region story
  // redraws every one of these pixels through region canvases, so these
  // baselines are what "byte-identical" is checked against; without them the
  // constraint was nearly vacuous (a seam or layering bug between rooms is
  // invisible to single-unit shots). Day and night both: the night sparkle is
  // per-room-unique and exercises the lit path the rushes run in.
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as any).game));
    await page.evaluate(() => document.getElementById("splash")?.remove());
    const star = await page.evaluate(buildToStar, 4);
    expect(star).toBe(4);
    await page.evaluate(() => {
      const g = (window as any).game;
      // Freeze every nondeterministic pixel input: buildToStar already holds
      // speed 0; reduced motion pins the decorative clock (walkers, clouds,
      // crane), reset to phase zero so the frozen pose is identical across
      // runs, and the cosmetic weather is forced clear so the baseline does
      // not depend on which day the fixture lands on.
      g.engine.setReducedMotion(true);
      g.engine.resetDecorativeClock();
      g.sim.weather = "clear";
    });
  });

  /** Pin the clock to an hour, wait for the deferred hour reconcile to adopt
   *  it (towerSyncSchedule bookkeeping, no fixed sleeps), then sweep the DOM
   *  chrome that overlays the canvas rect: the star-4 build pops toasts that
   *  self-remove on timers mid-capture, which defeats the screenshot
   *  stability loop (the exact failure the first mint hit). */
  const settleAt = async (page: import("@playwright/test").Page, hour: number) => {
    await page.evaluate((h: number) => {
      const g = (window as any).game;
      g.sim.clock.minutes = g.sim.clock.day * 24 * 60 + h * 60;
    }, hour);
    await page.waitForFunction((h: number) => {
      const e = (window as any).game.engine;
      // Queue-empty is part of the settle contract (region-design I4): the
      // hour flip marks every live region dirty and the drain trickles at
      // budget pace, so capturing before it empties would race the repaints.
      return e.lastSyncHour === h && !e.hourSyncPending && e.regionDirty.size === 0;
    }, hour);
    await page.evaluate(() => {
      document.getElementById("toast-wrap")?.replaceChildren();
      document.getElementById("hint")?.remove();
    });
  };

  test("full tower at minimum zoom, day, matches baseline", async ({ page }) => {
    await settleAt(page, 10);
    await page.evaluate(() => {
      const g = (window as any).game;
      g.engine.setCamera(Math.floor(g.grid.width / 2), 30, 0); // 0 clamps to MIN_ZOOM
    });
    await expect(page.locator("#view")).toHaveScreenshot("scene-min-zoom-day.png", { timeout: 30_000 });
  });

  test("full tower at minimum zoom, night, matches baseline", async ({ page }) => {
    await settleAt(page, 20);
    await page.evaluate(() => {
      const g = (window as any).game;
      g.engine.setCamera(Math.floor(g.grid.width / 2), 30, 0); // 0 clamps to MIN_ZOOM
    });
    await expect(page.locator("#view")).toHaveScreenshot("scene-min-zoom-night.png", { timeout: 30_000 });
  });

  test("office floors close up, day, matches baseline", async ({ page }) => {
    await settleAt(page, 10);
    await page.evaluate(() => (window as any).game.engine.setCamera(60, 8, 1));
    await expect(page.locator("#view")).toHaveScreenshot("scene-detail-day.png", { timeout: 30_000 });
  });

  test("office floors close up, night, matches baseline", async ({ page }) => {
    await settleAt(page, 20);
    await page.evaluate(() => (window as any).game.engine.setCamera(60, 8, 1));
    await expect(page.locator("#view")).toHaveScreenshot("scene-detail-night.png", { timeout: 30_000 });
  });
});
