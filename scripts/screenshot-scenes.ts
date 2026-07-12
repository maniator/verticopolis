/**
 * The declarative SCENES manifest: every screenshot mapped to the state it needs.
 * A new shot is a new row here, not a new file. Each scene either builds a tower
 * (via a page-context builder from screenshot-builders.ts) or navigates a route,
 * then lists its shots. The runner (screenshots.ts) walks this array.
 *
 * Node-side module: the `build`/`setup` entries reference the injected builders
 * by identity and the runner passes them to `page.evaluate`. Keep ERASABLE.
 */
import { type Page } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "fflate";
import { type Scene, PHONE, ROOT, DIRS, assertReady } from "./screenshot-env.ts";
import {
  buildBasement,
  buildCanonTower,
  buildCrowdTower,
  buildEngineTower,
  buildFireTower,
  buildHotspotTower,
  buildModernCondoTower,
  buildOverlayTower,
  buildStatsTower,
  buildTabletTower,
  pgDismissSplash,
  pgGrowToStar,
  pgPaletteAtStar,
  pgSetOverlay,
  pgStep,
} from "./screenshot-builders.ts";

// ---- The declarative SCENES manifest ----------------------------------------
// Each scene stages its sim/route ONCE, then captures its shots off that state.
// Shots run top-to-bottom, so a later shot's `setup` may advance the state a
// step further (dismiss splash → build → select → …). Widths are read from the
// sim in every builder, never hardcoded, so canon changes can't gap a floor.

export const SCENES: Scene[] = [
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
    shots: [{ name: "14-crowd-routing", wait: 6000 }],
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
          // Fire the same hook the engine raises when the GPU drops the WebGL
          // context; the recovery flow flushes the autosave and opens the card.
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
            engine.onContextLost();
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

  // ======================= FEATURES =======================
  // --- Map overlays -----------------------------------------------------------
  {
    id: "overlays",
    outDir: "features",
    build: buildOverlayTower,
    assertUnits: 200,
    shots: [
      // Frame the whole height (floor ~15, wide zoom) so the vacant bands and the
      // jammed upper zone are both in the picture.
      { name: "overlay-congestion", overlay: "congestion", frame: { floor: 15, zoom: 0.4 } },
      { name: "overlay-occupancy", overlay: "occupancy", frame: { floor: 15, zoom: 0.4 } },
      { name: "overlay-satisfaction", overlay: "satisfaction", frame: { floor: 15, zoom: 0.4 } },
      { name: "overlay-picker-ui", crop: ".overlay-picker", setup: async (page) => void (await page.evaluate(pgSetOverlay, "congestion")) },
      // Showcase copies of two overlays, off the SAME varied tower (the hero is too
      // uniform to read), written into docs/screenshots/.
      { name: "15-congestion", outDir: "screenshots", overlay: "congestion", frame: { floor: 15, zoom: 0.4 } },
      { name: "23-occupancy", outDir: "screenshots", overlay: "occupancy", frame: { floor: 15, zoom: 0.4 } },
    ],
  },
  // --- Condo rule-sets (New Tower picker + Households stats) -------------------
  {
    id: "condo-modes",
    outDir: "features",
    keepSplash: true,
    viewport: { width: 1280, height: 900 },
    shots: [
      {
        name: "new-tower-modes",
        crop: "#modal .modal-box",
        setup: async (page) => {
          await page.click('#splash [data-splash="new"]');
          await page.waitForSelector("#modal .nt-modes", { timeout: 4000 });
          await page.click('#modal input[value="modern"]');
        },
        wait: 250,
      },
      {
        name: "stats-households-modern",
        crop: "#modal .modal-box",
        setup: async (page) => {
          await page.click('#modal [data-act="found"]');
          await page.waitForTimeout(200);
          await page.evaluate(() => {
            try {
              localStorage.setItem("tt.onboarded", "1");
            } catch {
              /* ignore */
            }
            document.getElementById("onboard")?.remove();
            document.querySelectorAll(".tt-pulse").forEach((n) => n.classList.remove("tt-pulse"));
          });
          await page.evaluate(buildModernCondoTower);
          await page.waitForTimeout(400);
          await page.click("#btn-stats");
          await page.waitForSelector("#modal .stats-grid", { timeout: 4000 });
          await page.evaluate(() => {
            const box = document.querySelector("#modal .modal-box") as HTMLElement;
            const hh = [...box.querySelectorAll(".stats-section")].find((h) => /Households/.test(h.textContent || "")) as HTMLElement | undefined;
            if (hh) box.scrollTop = hh.offsetTop - box.offsetTop - 8;
          });
        },
        wait: 250,
      },
      {
        // A single stacked figure (two adjacent raw-image URLs get mangled in
        // markdown, so ship one composite). Built from the two shots above.
        name: "condo-modes",
        crop: "body",
        setup: async (page) => {
          const dataUri = (f: string) => "data:image/png;base64," + readFileSync(resolve(DIRS.features, f)).toString("base64");
          await page.setContent(
            `<style>
               *{margin:0;box-sizing:border-box}
               body{background:#c9c6be;padding:20px;font:600 14px system-ui,Segoe UI,Arial;color:#20203a;width:640px}
               figure{margin:0 0 20px}figure:last-child{margin-bottom:0}
               figcaption{padding:6px 2px 8px}
               img{display:block;width:600px;border:1px solid #7a7a7a}
             </style>
             <figure><figcaption>New Tower rule-set picker: Classic vs Modern (choice is permanent per tower)</figcaption>
               <img src="${dataUri("new-tower-modes.png")}"></figure>
             <figure><figcaption>Modern-only Households stats: people housed, avg household, size mix</figcaption>
               <img src="${dataUri("stats-households-modern.png")}"></figure>`,
            { waitUntil: "networkidle" },
          );
        },
        viewport: { width: 640, height: 900 },
        wait: 200,
      },
    ],
  },
  // --- Build-palette unlock visibility (palette GROWS as stars are earned) -----
  {
    id: "palette-unlock",
    outDir: "features",
    viewport: { width: 1280, height: 1280 }, // desktop → the docked vertical palette
    shots: [
      { name: "palette-1star", crop: "#palette", setup: async (page) => void (await page.evaluate(pgPaletteAtStar, 1)) },
      { name: "palette-3star", crop: "#palette", setup: async (page) => void (await page.evaluate(pgPaletteAtStar, 3)) },
      { name: "palette-5star", crop: "#palette", setup: async (page) => void (await page.evaluate(pgPaletteAtStar, 5)) },
      {
        // The three stacked into one captioned figure (a single image sidesteps
        // adjacent-URL markdown mangling), built from the shots above.
        name: "palette-unlock",
        crop: "body",
        viewport: { width: 900, height: 640 },
        setup: async (page) => {
          const dataUri = (f: string) => "data:image/png;base64," + readFileSync(resolve(DIRS.features, f)).toString("base64");
          await page.setContent(
            `<style>
               *{margin:0;box-sizing:border-box}
               body{background:#c9c6be;padding:20px;font:600 13px system-ui,Segoe UI,Arial;color:#20203a;width:900px}
               .row{display:flex;gap:18px;align-items:flex-start}
               figure{margin:0;flex:1}
               figcaption{padding:6px 2px 8px;line-height:1.35}
               img{display:block;width:100%;border:1px solid #7a7a7a;background:#fff}
             </style>
             <div class="row">
               <figure><figcaption>1★: only 1★ tools; Leisure/Services/Special headers hidden</figcaption>
                 <img src="${dataUri("palette-1star.png")}"></figure>
               <figure><figcaption>3★: Leisure &amp; Services appear; 2★/3★ rows revealed</figcaption>
                 <img src="${dataUri("palette-3star.png")}"></figure>
               <figure><figcaption>5★: the full palette, every tier unlocked</figcaption>
                 <img src="${dataUri("palette-5star.png")}"></figure>
             </div>`,
            { waitUntil: "networkidle" },
          );
        },
        wait: 200,
      },
    ],
  },
  // --- Basement: parking garage, recycling, garbage truck, inspector ----------
  {
    id: "basement",
    outDir: "features",
    build: buildBasement,
    assertUnits: 100,
    shots: [
      {
        name: "parking-garage-day",
        clock: 12,
        // Tight on the two parking decks (B1/B2) so the ramp + chained cars fill
        // the frame and read as a garage, not a thin strip under the offices.
        setup: async (page) => {
          await page.evaluate(() => {
            const g = (window as any).game;
            const ramp = g.sim.tower.units.find((u: any) => u.kind === "parkingRamp");
            g.engine.setCamera(ramp ? ramp.x + 30 : Math.floor(g.grid.width / 2), 0, 2.1);
          });
        },
        wait: 800,
      },
      {
        name: "parking-garage-predawn",
        clock: 5,
        setup: async (page) => {
          await page.evaluate(() => {
            const g = (window as any).game;
            const ramp = g.sim.tower.units.find((u: any) => u.kind === "parkingRamp");
            g.engine.setCamera(ramp ? ramp.x + 30 : Math.floor(g.grid.width / 2), 0, 2.1);
          });
        },
        wait: 800,
      },
      {
        name: "recycling-filling",
        setup: async (page) => {
          // Advance to mid-afternoon so the recycling center has filled with the
          // day's garbage (emptied only by the morning truck).
          await page.evaluate(() => {
            const g = (window as any).game;
            const c = g.sim.clock;
            let delta = 15 * 60 - c.minuteOfDay;
            if (delta < 0) delta += 1440;
            c.advance(delta);
          });
          await page.evaluate(() => {
            const g = (window as any).game;
            const rec = g.sim.tower.units.find((u: any) => u.kind === "recycling");
            if (rec) g.engine.setCamera(rec.x + rec.width / 2, rec.floor, 2.2);
          });
        },
        wait: 700,
      },
      {
        name: "garbage-truck-collection",
        clock: 5, // GARBAGE_COLLECT_HOUR: the truck is drawn on the road deck now
        setup: async (page) => {
          // Frame the basement road decks (B1/B2) where the collection truck
          // drives, wide enough that it's in view wherever along the deck it sits.
          await page.evaluate(() => {
            const g = (window as any).game;
            const ramp = g.sim.tower.units.find((u: any) => u.kind === "parkingRamp");
            g.engine.setCamera(ramp ? ramp.x + 40 : Math.floor(g.grid.width / 2), 0, 1.5);
          });
        },
        wait: 700,
      },
      {
        name: "inspector-recycling",
        setup: async (page) => {
          await page.evaluate(() => {
            const g = (window as any).game;
            const rec = g.sim.tower.units.find((u: any) => u.kind === "recycling");
            if (rec) {
              g.engine.setCamera(rec.x + rec.width, rec.floor, 2.0);
              g.inspector.inspectPicked({ type: "unit", id: rec.id, kind: "recycling" });
            }
          });
        },
        wait: 500,
      },
    ],
  },
  // --- Stats dialog (demand + income/elevators sections) ----------------------
  {
    id: "stats",
    outDir: "features",
    build: buildStatsTower,
    assertUnits: 100,
    shots: [
      {
        name: "stats-dialog-demand",
        crop: "#modal .modal-box",
        setup: async (page) => {
          await page.evaluate(() => document.getElementById("btn-stats")?.click());
          await page.waitForSelector("#modal .stats-grid", { timeout: 4000 });
          await page.evaluate(() => {
            const box = document.querySelector("#modal .modal-box") as HTMLElement;
            const sec = [...box.querySelectorAll(".stats-section")].find((h) => /Transport/.test(h.textContent || "")) as HTMLElement | undefined;
            if (sec) box.scrollTop = sec.offsetTop - box.offsetTop - 8;
          });
        },
        wait: 300,
      },
      {
        name: "stats-income-elevators",
        crop: "#modal .modal-box",
        setup: async (page) => {
          await page.evaluate(() => {
            if (!document.getElementById("modal")) document.getElementById("btn-stats")?.click();
          });
          await page.waitForSelector("#modal .stats-grid", { timeout: 4000 });
          await page.evaluate(() => {
            const box = document.querySelector("#modal .modal-box") as HTMLElement;
            const sec = [...box.querySelectorAll(".stats-section")].find((h) => /Income/.test(h.textContent || "")) as HTMLElement | undefined;
            if (sec) box.scrollTop = sec.offsetTop - box.offsetTop - 8;
          });
        },
        wait: 300,
      },
    ],
  },
  // --- Traffic HUD chip (desktop + mobile) ------------------------------------
  {
    id: "traffic",
    outDir: "features",
    viewport: { width: 1440, height: 400 },
    build: buildHotspotTower,
    assertUnits: 100,
    shots: [
      {
        name: "traffic-chip-after",
        crop: "#topbar",
        // Capture exactly at the verified state: `wait: 0` is a 0ms settle that
        // steps 0 frames (settle ceils 0/FRAME_MS to 0), so the pre-capture
        // refresh repaints the chip off the precise jammed state the loop below
        // confirmed, not a frame later. The default 500ms would instead advance
        // the sim ~30 more frames past it.
        wait: 0,
        setup: async (page) => {
          // Step the clock in fixed chunks and refresh the chip until it leaves
          // "Smooth". The sim and the step count are both deterministic, so the
          // chip flips on the same chunk (and reads the same) every run; the
          // wall-clock UI throttle is bypassed by refreshing explicitly.
          for (let i = 0; i < 40; i++) {
            const stepped = await page.evaluate(pgStep, 10);
            if (!stepped) throw new Error("traffic chip needs the stepped clock");
            const label = await page.evaluate(() => {
              const g = (window as any).game;
              g?.updateTraffic?.();
              return document.getElementById("traffic-label")?.textContent ?? "";
            });
            if (label && label !== "Smooth") break;
          }
        },
      },
      {
        // Phone-width crop of the same chip. A per-shot viewport resizes only the
        // window; it can't flip isMobile/hasTouch (those are page-creation options,
        // see runScene). That's fine HERE and only here: #topbar reflows purely on
        // width, with no `pointer: coarse` chrome of its own (the mobile drawer /
        // #scrim live in separate DOM), so the touch flags wouldn't change these
        // pixels. A shot that needs real mobile chrome must live in a PHONE-viewport
        // *scene* instead, not just override the viewport here.
        name: "traffic-chip-after-mobile",
        crop: "#topbar",
        viewport: PHONE,
        // Reflow-only shot: the viewport change is pure DOM, so step no frames
        // (wait 0) from the jammed state the desktop shot just verified.
        wait: 0,
      },
    ],
  },
  // --- Ground-floor entrance awnings (zoomed left/right lobby edges) ----------
  // Floor 1 wears a green-and-gold entrance marquee in place of the fire escape
  // that clads the floors above. It sits at the extreme frontage corners, so a
  // full-tower shot buries it; these two tight crops frame each ground-floor
  // edge at max zoom so the canopy (and the wider fire escape just above it)
  // reads clearly.
  {
    id: "lobby-awnings",
    outDir: "features",
    build: buildCanonTower,
    assertUnits: 100,
    shots: [
      {
        name: "lobby-awning-left",
        clock: 12,
        wait: 500,
        // Read the live floor-1 lobby extent and center the camera on its left
        // edge (the awning hangs just outside it), rather than hardcode a tile.
        setup: async (page) => {
          await page.evaluate(() => {
            const g = (window as any).game;
            let min = Infinity;
            for (const u of g.sim.tower.units) {
              if (u.kind === "lobby" && u.floor === 1) min = Math.min(min, u.x);
            }
            g.engine.setCamera(min, 1, 3);
          });
        },
      },
      {
        name: "lobby-awning-right",
        clock: 12,
        wait: 500,
        setup: async (page) => {
          await page.evaluate(() => {
            const g = (window as any).game;
            let max = -Infinity;
            for (const u of g.sim.tower.units) {
              if (u.kind === "lobby" && u.floor === 1) max = Math.max(max, u.x + u.width);
            }
            g.engine.setCamera(max, 1, 3);
          });
        },
      },
    ],
  },
  // --- Responsive layout (tablet after-fix) -----------------------------------
  {
    id: "tablet",
    outDir: "features",
    viewport: { width: 834, height: 1112 },
    build: buildTabletTower,
    assertUnits: 100,
    shots: [
      // Both viewports sit inside the docked-tablet band (min-width:768 /
      // max-width:1023 / min-height:600, styles.css) so they exercise the
      // wrap-topbar + narrowed-dock breakpoint: portrait tall, compact wide.
      { name: "tablet-portrait-after", viewport: { width: 834, height: 1112 }, wait: 500 },
      { name: "tablet-compact-after", viewport: { width: 1000, height: 720 }, wait: 500 },
    ],
  },
  // --- Save-migration before/after (real towerone_6 v1 save) ------------------
  {
    id: "migration",
    outDir: "features",
    viewport: { width: 1680, height: 950 },
    shots: [
      { name: "parity-migration-before", setup: (page) => loadMigration(page, 2, "full"), wait: 1200 },
      { name: "parity-migration-after", setup: (page) => loadMigration(page, 1, "full"), wait: 1200 },
      { name: "parity-migration-parking-before", setup: (page) => loadMigration(page, 2, "detail"), wait: 1200 },
      { name: "parity-migration-parking-after", setup: (page) => loadMigration(page, 1, "detail"), wait: 1200 },
    ],
  },

  // ======================= MILESTONES =======================
  {
    id: "milestones",
    outDir: "milestones",
    shots: [
      { name: "1-star", setup: (page) => growToStar(page, 1), wait: 700 },
      { name: "2-star", setup: (page) => growToStar(page, 2), wait: 700 },
      { name: "3-star", setup: (page) => growToStar(page, 3), wait: 700 },
      { name: "4-star", setup: (page) => growToStar(page, 4), wait: 700 },
      { name: "5-star", setup: (page) => growToStar(page, 5), wait: 700 },
      {
        name: "tower",
        // The TOWER-rank capstone: build the hero tower, then surface the real
        // "🏆 TOWER achieved!" modal and KEEP it (the transient sweep would
        // otherwise close it, leaving a bare tower with no milestone).
        keepDialogs: true,
        setup: async (page) => {
          await page.evaluate(buildCanonTower);
          await assertReady(page, 200);
          await page.evaluate(() => (window as any).game.ui.congratsTower());
          await page.waitForSelector("#modal[open], dialog[open]", { timeout: 4000 });
        },
        clock: 11,
        wait: 1200,
      },
    ],
  },
];

// ---- Migration + milestone drivers (need Node-side fixture / assertions) -----

// Decode the towerone_6 fixture LAZILY (and cache it) so a subset run that skips
// the migration scene (e.g. ONLY=milestones) never has to read/inflate it.
let migrationSaveCache: unknown;
function migrationSave(): unknown {
  if (migrationSaveCache === undefined) {
    const raw = readFileSync(resolve(ROOT, "src/tests/fixtures/towerone_6.vctower"), "utf8");
    const b64 = raw.slice(raw.indexOf("\n") + 1);
    const compressed = new Uint8Array(Buffer.from(b64, "base64"));
    migrationSaveCache = JSON.parse(new TextDecoder().decode(inflateSync(compressed)));
  }
  return migrationSaveCache;
}

/** Load the towerone_6 save at a given stored version (2 = reflow skipped =
 *  "before"; 1 = reflow runs = "after"), then frame either the full tower or a
 *  tight detail on the parking ramp where the canon width change reads loudest. */
async function loadMigration(page: Page, version: number, mode: "full" | "detail"): Promise<void> {
  await page.evaluate(
    ({ d, version }) => {
      const g = (window as any).game;
      const Sim = g.sim.constructor;
      const clone = JSON.parse(JSON.stringify(d));
      clone.version = version;
      g.adoptSim(Sim.deserialize(clone));
      document.getElementById("splash")?.remove();
      document.querySelector(".modal-backdrop")?.remove();
    },
    { d: migrationSave(), version },
  );
  await page.evaluate((mode) => {
    const g = (window as any).game;
    if (mode === "detail") {
      const ramp = g.sim.tower.units.filter((u: any) => u.kind === "parkingRamp").sort((a: any, b: any) => a.floor - b.floor)[0];
      g.engine.setCamera(ramp ? ramp.x + 8 : 240, ramp ? ramp.floor : -1, 3.6);
    } else {
      g.engine.setCamera(187, Math.max(6, g.sim.tower.highestFloor) / 2, 0.42);
    }
  }, mode);
}

/** Grow deterministically to `target` stars and HARD-ASSERT the tower reached
 *  it: a milestone shot that silently fell short would misrepresent the ladder. */
async function growToStar(page: Page, target: number): Promise<void> {
  const reached = await page.evaluate(pgGrowToStar, target);
  if (reached < target) throw new Error(`milestone ${target}★ only reached ${reached}★`);
}
