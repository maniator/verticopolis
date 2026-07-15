/**
 * Showcase + engine-proof scenes (the docs/screenshots set plus the phone-only
 * crash-screen card). Part of the SCENES manifest; concatenated in order by
 * `screenshot-scenes.ts`. Each `build`/`setup` that runs in the page references
 * an injected builder by identity. Keep ERASABLE.
 */
import { type Scene, PHONE } from "../screenshot-env.ts";
import {
  buildCanonTower,
  buildCrowdTower,
  buildEngineTower,
  buildFireTower,
  pgDismissSplash,
} from "../screenshot-builders.ts";

export const SHOWCASE_SCENES: Scene[] = [
  // --- Showcase: first-run splash / onboarding (fresh, splash kept) ----------
  {
    id: "first-run",
    outDir: "screenshots",
    keepSplash: true,
    shots: [
      { name: "00-splash", wait: 400 },
      {
        name: "00b-onboarding",
        // The onboarding subject is the rule-set picker ("Found a New Tower").
        // Open it directly and KEEP it: the per-shot transient sweep would
        // otherwise close the modal and leave only the splash behind.
        keepDialogs: true,
        setup: async (page) => {
          await page.evaluate(() => (window as any).game.ui.newTowerModal({ hasSave: false, onFound: () => {} }));
          // Fail the shot (keep the committed image) if the picker never mounts.
          await page.waitForSelector("#modal[open], dialog[open]", { timeout: 4000 });
        },
        frame: { floor: 4, zoom: 1.0 },
      },
      {
        name: "01-start",
        setup: async (page) => {
          await page.evaluate(pgDismissSplash);
        },
        frame: { floor: 3, zoom: 1.2 },
      },
      {
        name: "02-help",
        keepDialogs: true,
        setup: async (page) => {
          await page.evaluate(() => document.getElementById("btn-help")?.click());
          // Fail loudly if the Help modal never opens rather than commit a wrong shot.
          await page.waitForSelector("#modal", { timeout: 4000 });
        },
        wait: 300,
      },
      {
        name: "02b-settings",
        keepDialogs: true,
        setup: async (page) => {
          await page.evaluate(() => document.getElementById("btn-settings")?.click());
          // Guard on a Settings-only element: a bare #modal wait would be
          // satisfied by the Help dialog the previous shot leaves open.
          await page.waitForSelector("#modal #vol-music", { timeout: 4000 });
        },
        wait: 300,
      },
      {
        name: "02c-saves",
        keepDialogs: true,
        setup: async (page) => {
          // Quick-save first so the dialog shows a populated slot, then open
          // it; this is the only home of Export/Import, so the gallery must
          // show that footer.
          await page.evaluate(() => {
            document.getElementById("btn-save")?.click();
            document.getElementById("btn-load")?.click();
          });
          await page.waitForSelector("#modal .slots", { timeout: 4000 });
        },
        wait: 300,
      },
    ],
  },
  // --- Showcase mobile splash -------------------------------------------------
  {
    id: "first-run-mobile",
    outDir: "screenshots",
    viewport: PHONE,
    keepSplash: true,
    shots: [{ name: "00-splash-mobile", wait: 400 }],
  },
  // --- The hero tower: the fully-built showcase --------------------------------
  {
    id: "showcase",
    outDir: "screenshots",
    build: buildCanonTower,
    assertUnits: 200,
    shots: [
      { name: "03-tower-day", clock: 11, wait: 1200 },
      { name: "24-morning", clock: 7 },
      { name: "04-tower-night", clock: 22 },
      { name: "25-night", clock: 23 },
      { name: "26-night-rooms", clock: 23, frame: { floor: 20, zoom: 1.0 } },
      // Sun shots frame the tower TOP + open sky so the sun near the horizon is
      // actually in the picture (an interior zoom hides the very subject).
      { name: "21-sun-horizon", clock: 6, frame: { floor: 34, zoom: 0.42 } },
      { name: "18-sun-clip", clock: 17, frame: { floor: 34, zoom: 0.42 } },
      { name: "22-moon", clock: 2, frame: { floor: 30, zoom: 0.5 } },
      { name: "16-sky", clock: 12, frame: { floor: 30, zoom: 0.9 } },
      { name: "05-detail", clock: 12, frame: { floor: 10, zoom: 1.8 } },
      {
        name: "17-select",
        clock: 12,
        frame: { floor: 10, zoom: 1.4 },
        setup: async (page) => {
          await page.evaluate(() => {
            const g = (window as any).game;
            const office = g.sim.tower.units.find((u: any) => u.kind === "office");
            if (office) {
              g.selected = { type: "unit", id: office.id };
              g.engine.selectedId = office.id;
              g.refreshEditor();
            }
          });
        },
        wait: 300,
      },
      {
        name: "10-batch-pricing",
        keepDialogs: true,
        setup: async (page) => {
          await page.evaluate(() => {
            const g = (window as any).game;
            const office = g.sim.tower.units.find((u: any) => u.kind === "office");
            g.selected = { type: "unit", id: office.id };
            g.refreshEditor();
          });
          await page.waitForTimeout(150);
          await page.evaluate(() => (document.querySelector('#editor [data-edit="batchKind"]') as HTMLElement | null)?.click());
          await page.waitForTimeout(200);
          await page.evaluate(() => {
            const el = document.querySelector("#bp-price") as HTMLInputElement | null;
            if (el) {
              el.value = "12000";
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }
          });
        },
        wait: 250,
      },
      {
        name: "07-people-rush",
        setup: async (page) => {
          await page.evaluate(() => {
            const g = (window as any).game;
            // Clear the office selection carried over from 17-select / 10-batch-pricing
            // so the inspector editor panel isn't floating over the crowd shot.
            // Mirror Game.clearSelection: null the selection AND hide the editor
            // panel. refreshEditor() alone no-ops when selected is null (it early-
            // returns), so the panel would keep floating; ui.hideEditor() removes it.
            g.selected = null;
            if (g.engine) g.engine.selectedId = null;
            g.ui?.hideEditor?.();
            g.speed = 0;
            const c = g.sim.clock;
            let delta = 8 * 60 + 30 - c.minuteOfDay;
            if (delta < 0) delta += 1440;
            c.advance(delta);
            g.engine.setCamera(Math.floor(g.grid.width / 2), 2, 1.7);
          });
        },
        wait: 1200,
      },
    ],
  },
  // --- Construction in progress (its own small tower) --------------------------
  {
    id: "construction",
    outDir: "screenshots",
    build: () => {
      const g = (window as unknown as { game: any }).game;
      const Sim = g.sim.constructor;
      g.sim = Sim.newGame(99);
      const s = g.sim;
      s.money = 50_000_000;
      s.star = 4;
      const cx = Math.floor(g.grid.width / 2);
      const left = cx - 22;
      // Ground lobby grows OUTWARD from the seeded center strip: a ground tile only
      // connects by touching the tower, so laying from a far edge would strand the
      // whole left side until the loop reached the seed. The floors above rest on
      // the story below, so their left-to-right order is fine.
      for (let x = cx; x < left + 50; x++) s.tower.place("lobby", 1, x);
      for (let x = cx - 1; x >= left - 6; x--) s.tower.place("lobby", 1, x);
      for (let f = 2; f <= 8; f++) for (let x = left; x < left + 44; x++) s.tower.place("floor", f, x);
      s.buildTransport("elevatorStandard", left, 1, 8);
      for (let f = 2; f <= 8; f++)
        for (let x = left + 6; x + 1 <= left + 44; ) {
          const before = s.tower.units.length;
          s.build("office", f, x); // s.build keeps the construction state this shot wants
          if (s.tower.units.length > before) x += s.tower.units[s.tower.units.length - 1].width;
          else x += 1;
        }
      g.engine.setSim(s);
      g.engine.setCamera(left + 18, 4, 1.4);
      g.speed = 0;
      g.engine.paused = false;
    },
    assertUnits: 40,
    shots: [{ name: "08-construction", wait: 700 }],
  },
  // --- Engine pipeline proof (raw window.game / Excalibur) --------------------
  {
    id: "engine",
    outDir: "screenshots",
    shots: [
      {
        name: "10-game-boot",
        // Wait for the Excalibur scene to be live before capturing; a slow boot
        // would otherwise yield a blank/half-drawn frame (the old shot-game.mjs
        // waited on the same currentScene guard).
        setup: async (page) => {
          await page.waitForFunction(() => !!(window as any).game?.engine?.engine?.currentScene, null, { timeout: 8000 });
        },
        wait: 900,
      },
      { name: "11-game-tower", setup: async (page) => void (await page.evaluate(buildEngineTower)), wait: 1200 },
      {
        name: "12-game-zoom",
        setup: async (page) => void (await page.evaluate(() => (window as any).game.engine.zoomAt(1.6, 640, 400))),
        wait: 600,
      },
      {
        name: "13-game-night",
        setup: async (page) =>
          void (await page.evaluate(() => {
            const c = (window as any).game.sim.clock;
            c.minutes = c.minutes - c.minuteOfDay + 23 * 60;
            (window as any).game.engine.zoomAt(1 / 1.6, 640, 400);
          })),
        wait: 800,
      },
    ],
  },
  // --- Crowd routing (Monday morning rush) ------------------------------------
  {
    id: "crowd",
    outDir: "screenshots",
    // Pin steadyClock so the fixed 6s wait still lands in the morning rush. The
    // breathing clock would otherwise race toward noon and change the shot.
    initScript: () => {
      localStorage.setItem("vc.prefs", JSON.stringify({ steadyClock: true }));
    },
    build: buildCrowdTower,
    assertUnits: 40,
    // The 6s live rush is ~360 software-rastered frames of discarded intermediate
    // crowd motion; skip their draws (only the final frame is captured). One of the
    // two capture poles, alongside metro. Byte-identical (validated in the container).
    shots: [{ name: "14-crowd-routing", wait: 6000, noDrawSettle: true }],
  },
  // --- Fire emergency ---------------------------------------------------------
  {
    id: "fire",
    outDir: "screenshots",
    build: buildFireTower,
    assertUnits: 40,
    shots: [{ name: "14-fire", clock: 14, frame: { floor: 5, zoom: 1.2 }, wait: 700 }],
  },
  // --- Crash screen: the context-loss card (crash report + bug report) --------
  {
    id: "crash-screen",
    outDir: "features",
    viewport: PHONE,
    build: buildCanonTower,
    assertUnits: 200,
    shots: [
      {
        name: "crash-screen",
        // The card IS the subject: without this, pgClearTransients would close
        // it before the capture (the sweep clicks close/decline buttons and
        // calls HTMLDialogElement.close() on whatever dialog is open).
        keepDialogs: true,
        clock: 12,
        setup: async (page) => {
          // Trip the recovery flow the engine runs when the GPU drops the WebGL
          // context. A FIRST loss now recovers in place (no card); the card only
          // appears on a repeat, so fire the hook twice. The second loss lands
          // inside the 90s window and escalates to the crash card, the same
          // two-strikes path e2e/contextRecovery.spec.ts exercises with real losses.
          // Both links are asserted with messages that name the real problem
          // (the hook is nullable on TowerEngine, and a silently skipped clock
          // stop would leave the backdrop advancing between runs).
          await page.evaluate(() => {
            const engine = (window as any).game?.engine;
            if (typeof engine?.onContextLost !== "function") {
              throw new Error("game.engine.onContextLost is not wired; the crash-screen scene needs the recovery hook");
            }
            // Match the real context-loss path: TowerEngine.handleContextLost
            // stops the Excalibur clock BEFORE raising the hook, so the frame
            // under the card is frozen exactly as in a real crash.
            const clock = engine.engine?.clock;
            if (typeof clock?.stop !== "function") {
              throw new Error("game.engine.engine.clock is unavailable; the crash-screen scene needs to freeze the frame");
            }
            clock.stop();
            engine.onContextLost(); // first loss: recovers in place, no card
            engine.onContextLost(); // repeat within 90s: escalates to the card
          });
          // Fail the shot (keep the committed image) if the card never mounts.
          await page.waitForSelector("dialog#crash-screen[open]", { timeout: 4000 });
        },
        // Capture exactly at the verified state: a 0ms settle steps zero
        // frames, so nothing advances behind the frozen card (after a real
        // context loss no further frames run either).
        wait: 0,
      },
    ],
  },
  // --- Mobile: built tower, stats drawer, palette -----------------------------
  {
    id: "mobile",
    outDir: "screenshots",
    viewport: PHONE,
    build: buildCanonTower,
    assertUnits: 200,
    shots: [
      {
        name: "09-mobile",
        setup: async (page) => void (await page.evaluate(() => (window as any).game.engine.setCamera(Math.floor((window as any).game.grid.width / 2), 18, 0.32))),
        clock: 12,
        wait: 1000,
      },
      {
        name: "09b-mobile-stats",
        keepDialogs: true,
        setup: async (page) => {
          await page.evaluate(() => document.body.classList.add("panels-open"));
          await page.waitForTimeout(200);
          await page.evaluate(() => document.getElementById("btn-stats")?.click());
        },
        wait: 500,
      },
      {
        name: "19-mobile-drawer",
        setup: async (page) => {
          await page.evaluate(() => document.querySelector('#modal [data-act="close"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
          await page.evaluate(() => document.body.classList.add("panels-open"));
        },
        wait: 400,
      },
      {
        name: "20-mobile-palette",
        setup: async (page) => {
          await page.evaluate(() => document.body.classList.remove("panels-open"));
          await page.evaluate(() => {
            // Arm the build palette: pick a build tool so the palette scroller is shown.
            const first = document.querySelector(".pal-item[data-kind]") as HTMLElement | null;
            first?.click();
          });
        },
        wait: 400,
      },
    ],
  },
  // --- Sprite gallery / engine preview / room preview (route pages) -----------
  {
    id: "sprite-gallery",
    outDir: "screenshots",
    route: "gallery.html",
    viewport: { width: 960, height: 1200 },
    shots: [{ name: "06-sprite-gallery", fullPage: true }],
  },
  {
    id: "excalibur-preview",
    outDir: "screenshots",
    route: "excalibur.html",
    shots: [{ name: "excalibur-preview", wait: 1500 }],
  },
  {
    id: "preview-rooms",
    outDir: "screenshots",
    route: "preview.html",
    viewport: { width: 960, height: 760 },
    shots: [{ name: "preview-rooms", fullPage: true, wait: 700 }],
  },
];
