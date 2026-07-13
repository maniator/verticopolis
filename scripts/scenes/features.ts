/**
 * Feature scenes (map overlays, condo rule-sets, palette unlock, basement,
 * stats, traffic HUD, lobby awnings, responsive layout, save-migration). Part
 * of the SCENES manifest; concatenated in order by `screenshot-scenes.ts`. Each
 * `build`/`setup` that runs in the page references an injected builder by
 * identity; `loadMigration` is a Node-side driver. Keep ERASABLE.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Scene, PHONE, DIRS } from "../screenshot-env.ts";
import {
  buildBasement,
  buildCanonTower,
  buildHotspotTower,
  buildModernCondoTower,
  buildOverlayTower,
  buildStatsTower,
  buildTabletTower,
  pgPaletteAtStar,
  pgSetOverlay,
  pgStep,
} from "../screenshot-builders.ts";
import { loadMigration } from "../screenshot-scenes-drivers.ts";

export const FEATURE_SCENES: Scene[] = [
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
        name: "traffic-chip",
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
        name: "traffic-chip-mobile",
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
  // --- Responsive layout (docked-tablet band) ---------------------------------
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
      { name: "tablet-portrait", viewport: { width: 834, height: 1112 }, wait: 500 },
      { name: "tablet-compact", viewport: { width: 1000, height: 720 }, wait: 500 },
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
];
