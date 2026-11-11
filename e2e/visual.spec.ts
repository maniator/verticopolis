import { test, expect } from "@playwright/test";
import { buildToStar, hideMapBeforeLoad, expectEngineHosted } from "./helpers";

// Every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

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
 * Determinism: the dialog shots capture opaque DOM windows (no canvas
 * bleed-through) over a paused game (buildToStar sets speed 0) with the clock
 * pinned, and the tower-scene shots step the sim to a fixed state. (The sprite
 * gallery is no longer shot here: the drift-gate already pins gallery.html as
 * docs/screenshots/06-sprite-gallery.png, so a second baseline was redundant.)
 *
 * One set of baselines, the Rust engine's (#1353): the suite runs on the
 * `chromium-serial` project, which mints and compares them.
 */

// The sprite gallery (gallery.html) is a pure canvas of every facility, and the
// drift-gate already renders and pins it as docs/screenshots/06-sprite-gallery.png
// (a hard required check). A second pixel baseline here was redundant with that,
// so it was dropped; the DOM-chrome and tower-scene shots below stay, since they
// catch selector/media-query/composition regressions the canvas drift shots can't.

test.describe("dialog chrome", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  test.beforeEach(async ({ page }) => {
    // These shots are of the dialogs. The Map (#343) opens by default on desktop, so hide it first.
    await hideMapBeforeLoad(page);
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as any).game));
    // Same setup as the milestones progression: drop the splash overlay
    // without resetting the sim, then grow a real 1★ tower. buildToStar
    // freezes time (speed 0) and fixes funds, so the only nondeterministic
    // value left is the clock — pin it back to the founding minute.
    await page.evaluate(() => document.getElementById("splash")?.remove());
    const star = await page.evaluate(buildToStar, 1);
    expect(star).toBe(1);
    await expectEngineHosted(page);
    // The clock pin is a presentation input on the paused read model: at
    // speed 0 no frame ticks, so no frame syncs the read model from the
    // engine and the pin holds on both engines until a test merges
    // explicitly. (A running scene is different: every tick syncs the clock
    // from the engine, which is why the gallery's pgSetClock moves the
    // engine's clock too, with the binding's advanceClock.)
    await page.evaluate(() => {
      ((window as any).game.sim.clock as { minutes: number }).minutes = 7 * 60;
    });
  });

  test("stats dialog matches baseline", async ({ page }) => {
    await page.click("#btn-stats");
    await expect(page.locator("#modal .modal-box")).toHaveScreenshot("stats-dialog.png");
  });

  test("pinned dialog footer covers the bands around it, at phone width", async ({ page }) => {
    // The one gate that can see this fix. Everything else guarding the pinned
    // footer reads geometry or the stylesheet, and both covers around the strip
    // are box-shadows: delete either one and not a single rect moves, so every
    // other assertion stays green while scrolled text shows through, sliced.
    // Both leaks that shipped were found by a human on a phone, not by CI.
    //
    // Narrow on purpose. The bands are `--pad-y` below the strip and its 12px
    // margin above, so what fills them is body text mid-scroll, and the phone
    // is where the schedule dialog's readout wraps far enough to reach them.
    // 700 tall, not the nominal 844: a phone showing browser chrome, which is
    // the state the leak was reported from. At the full 844 this dialog clears
    // its 82vh cap by only 18px, and a baseline taken there would be thin
    // evidence for a pin. Here it overflows by ~136px.
    await page.setViewportSize({ width: 390, height: 700 });
    // The 1-star fixture builds no transports and stops at floor 3, so the
    // schedule dialog would neither open nor be long enough to scroll. Raise
    // the structure and give it one tall shaft: the dialog's height comes from
    // its per-floor grid, and a 30-floor span is what makes it overflow.
    await page.evaluate(() => {
      const g = (window as any).game;
      const W = g.grid.width;
      // On the WASM engine the ten thousand builds go on a scratch copy of the
      // engine's tower, which the engine then loads in one step, as buildToStar
      // hands its tower over: built one at a time through the engine, each
      // build would read the engine's whole state back, far past the test's
      // budget.
      const port = (window as any).__vcEngine?.port;
      const hosted = Boolean(port) && g.enginePort === port;
      const s = hosted ? g.sim.constructor.deserialize(JSON.parse(JSON.stringify(g.sim.serialize()))) : g.sim;
      for (let f = 4; f <= 30; f++) {
        for (let x = 4; x < W - 4; x++) {
          const fl = s.build("floor", f, x);
          if (!fl.ok) throw new Error(`floor ${f} at x=${x}: ${fl.reason ?? "refused"}`);
        }
      }
      const r = s.buildTransport("elevatorStandard", 10, 1, 30);
      if (!r.ok) throw new Error(`could not place the shaft this shot needs: ${JSON.stringify(r)}`);
      if (hosted) {
        g.adoptSim(s, true);
        g.speed = 0; // a load can resume play; the shot is of a paused game
      }
      // The merge also copies the engine's clock over the beforeEach pin, so
      // pin it again (the dialog shot is of a paused game at 07:00).
      (window as any).game.syncSim();
      g.sim.clock.minutes = 7 * 60;
      const t = g.sim.tower;
      const shaft = t.transports.find((x: { kind: string }) => x.kind === "elevatorStandard");
      g.selected = { type: "transport", id: shaft.id };
      g.engine.selectedId = shaft.id;
      g.refreshEditor();
    });
    await page.click('#editor [data-edit="schedule"]');
    await page.waitForSelector("#modal .es-body");
    // Park mid-scroll with real content in BOTH bands, so the baseline holds
    // evidence about each cover rather than just the one below.
    const staged = await page.evaluate(() => {
      const box = document.querySelector("#modal .modal-box") as HTMLElement;
      const strip = document.querySelector("#modal .modal-box > .modal-actions") as HTMLElement;
      const leaves = [...box.querySelectorAll<HTMLElement>("*")].filter(
        (el) => !el.closest(".modal-actions") && el.children.length === 0 && (el.textContent || "").trim(),
      );
      const max = box.scrollHeight - box.clientHeight;
      // The pin only does work when more remains below the fold than the strip
      // is tall; without this the shot could be of a dialog barely overflowing.
      if (max <= strip.offsetHeight * 2) return false;
      const fills = (top: number, bottom: number): boolean =>
        leaves.some((el) => {
          const r = el.getBoundingClientRect();
          return r.height > 0 && Math.min(r.bottom, bottom) - Math.max(r.top, top) >= 4;
        });
      for (let t = Math.floor(max / 2); t >= 0; t -= 2) {
        box.scrollTop = t;
        const s = strip.getBoundingClientRect();
        const b = box.getBoundingClientRect().bottom;
        if (fills(s.bottom, b) && fills(s.top - 12, s.top)) return true;
      }
      return false;
    });
    expect(staged, "no offset put content in both bands; the baseline would prove nothing").toBe(true);
    await expect(page.locator("#modal .modal-box")).toHaveScreenshot("dialog-footer-pinned-phone.png");
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

  test("update prompt with several skipped versions matches baseline", async ({ page }) => {
    // A player who skipped versions sees each unseen version's notes, newest
    // first, in a log that scrolls in place once it is taller than its cap
    // (#1897). Four versions overflow the cap, so the baseline pins both the
    // per-version headings and the scroll well. Deterministic stub info.
    await page.evaluate(() =>
      (window as any).game.onUpdateAvailable(async () => {}, {
        version: "1.4.0",
        sha: "abc1234",
        notes: ["Offices pay rent on time more often."],
        since: "1.0.0",
        releases: [
          { version: "1.4.0", notes: ["Offices pay rent on time more often."] },
          { version: "1.3.0", notes: ["Elevators pick up waiting riders more reliably.", "Condos sell for more as your tower's rating climbs."] },
          { version: "1.2.0", notes: ["Modern towers now draw families of two to five."] },
          { version: "1.1.0", notes: ["The Map opens on the view you used last."] },
        ],
      }),
    );
    await page.waitForSelector("#modal[open]");
    await expect(page.locator("#modal .whatsnew-ver")).toHaveCount(4);
    await page.evaluate(() => ((window as any).game.setSpeed(0)));
    await expect(page.locator("#modal .modal-box")).toHaveScreenshot("update-prompt-skipped-versions.png");
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
    // The Map (#343) opens by default on desktop and would cover the scene's corner.
    await hideMapBeforeLoad(page);
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as any).game));
    await page.evaluate(() => document.getElementById("splash")?.remove());
    const star = await page.evaluate(buildToStar, 4);
    expect(star).toBe(4);
    await expectEngineHosted(page);
    await page.evaluate(() => {
      const g = (window as any).game;
      // Freeze every nondeterministic pixel input: buildToStar already holds
      // speed 0; reduced motion pins the decorative clock (walkers, clouds,
      // crane), reset to phase zero so the frozen pose is identical across
      // runs, and the cosmetic weather is forced clear so the baseline does
      // not depend on which day the fixture lands on. The weather (and the
      // clock settleAt pins below) are presentation inputs on the paused read
      // model: no command sets either on the engine, and at speed 0 no frame
      // syncs them back, so the pins hold on both engines.
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

// The overview MAP window (#343). The shots are of the window alone: its two canvases redraw only when the tower
// or the camera changes, so a paused tower at a pinned camera is still.
test.describe("overview map", () => {
  /** Boot with the map, grow the 3-star Classic tower and pin the camera. */
  async function classicMap(page: import("@playwright/test").Page): Promise<void> {
    await page.goto("/");
    await page.waitForFunction(() => Boolean((window as any).game));
    await page.evaluate(() => document.getElementById("splash")?.remove());
    expect(await page.evaluate(buildToStar, 3)).toBe(3);
    await page.evaluate(() => (window as any).game.engine.setCamera(Math.floor((window as any).game.grid.width / 2), 6, 1));
    await hideTransientChrome(page);
  }

  /** Hide the toasts and the hint bar, which can sit over the map card (a
   *  build's toast lands on the phone card), so a late toast never moves a
   *  shot. Then quiet the world behind the card the way the scene shots do:
   *  reduced motion, and the region repaint queue drained, so a busy main
   *  thread on a CI runner does not stall the screenshot's own checks. */
  async function hideTransientChrome(page: import("@playwright/test").Page): Promise<void> {
    await page.addStyleTag({ content: "#toast-wrap, #hint { visibility: hidden !important; }" });
    await page.evaluate(() => {
      const e = (window as any).game.engine;
      e.setReducedMotion(true);
      e.resetDecorativeClock();
    });
    await page.waitForFunction(() => {
      const e = (window as any).game.engine;
      return !e.hourSyncPending && e.regionDirty.size === 0;
    });
  }

  test.describe("on the desktop", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("Classic map matches baseline", async ({ page }) => {
      await classicMap(page);
      await expect(page.locator("#overview-map")).toHaveScreenshot("overview-map-classic.png", { timeout: 30_000 });
    });

    test("Modern map matches baseline", async ({ page }) => {
      await page.goto("/");
      await page.waitForFunction(() => Boolean((window as any).game));
      await page.evaluate(() => document.getElementById("splash")?.remove());
      await page.evaluate(() => {
        const g = (window as any).game;
        // A small Modern tower: offices, condos and a shaft, so the map shows
        // each group's color. Self-contained for page.evaluate.
        const s = g.sim.constructor.newGame(4400, "modern");
        s.money = 1e9;
        const cx = Math.floor(g.grid.width / 2);
        const left = cx - 30;
        const right = cx + 30;
        for (let x = cx; x <= right; x++) s.tower.place("lobby", 1, x);
        for (let x = cx - 1; x >= left; x--) s.tower.place("lobby", 1, x);
        for (let f = 2; f <= 8; f++) for (let x = left; x <= right; x++) s.tower.place("floor", f, x);
        const shaft = s.tower.placeTransport("elevatorStandard", left + 4, 1, 8);
        if (!shaft.ok) throw new Error(`elevator refused: ${shaft.reason ?? "unknown"}`);
        for (let f = 2; f <= 8; f++) {
          const kind = f <= 5 ? "office" : "condo";
          for (let x = left + 8; x + 1 <= right; ) {
            const r = s.tower.place(kind, f, x);
            x += r.ok ? s.tower.getUnit(r.unitId).width : 1;
          }
        }
        // A refused build would mint a near-empty map: check every group landed.
        const count = (kind: string) => s.tower.units.filter((u: { kind: string }) => u.kind === kind).length;
        for (const kind of ["lobby", "office", "condo"]) if (count(kind) === 0) throw new Error(`no ${kind} placed`);
        g.adoptSim(s, true);
        g.speed = 0;
        g.engine.setCamera(cx, 4, 1);
      });
      await hideTransientChrome(page);
      await expect(page.locator("#overview-map")).toHaveScreenshot("overview-map-modern.png", { timeout: 30_000 });
    });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test("open phone map matches baseline", async ({ page }) => {
      await classicMap(page);
      await page.locator("#btn-map").tap();
      await expect(page.locator("#overview-map")).toHaveScreenshot("overview-map-phone.png", { timeout: 30_000 });
    });
  });
});
