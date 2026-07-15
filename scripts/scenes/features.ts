/**
 * Feature scenes (map overlays, basement, stats, traffic HUD, lobby awnings,
 * responsive layout). Part of the SCENES manifest; concatenated in order by
 * `screenshot-scenes.ts`. Each `build`/`setup` that runs in the page references
 * an injected builder by identity. Keep ERASABLE.
 */
import { type Scene, PHONE } from "../screenshot-env.ts";
import {
  buildBasement,
  buildCanonTower,
  buildHotspotTower,
  buildOverlayTower,
  buildStatsTower,
  buildTabletTower,
  pgSetOverlay,
  pgStep,
  pgStepNoDraw,
} from "../screenshot-builders.ts";

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
  // --- Basement: parking garage, recycling, garbage truck, inspector ----------
  {
    id: "basement",
    outDir: "features",
    build: buildBasement,
    assertUnits: 100,
    shots: [
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
  // --- Metro station: routed commuters on the platform, train in and out ------
  {
    id: "metro",
    outDir: "features",
    build: buildCanonTower,
    assertUnits: 100,
    viewport: { width: 1600, height: 560 },
    shots: [
      {
        name: "metro-platform-waiting",
        setup: async (page) => {
          // Let the morning rush route commuters down first (the crowd moves on
          // stepped frames), then park the train's ambient cycle just BEFORE it
          // enters, so the platform reads with the track honestly empty. These 330
          // frames are only intermediate crowd-routing, discarded before the shot,
          // so step them without drawing (pgStepNoDraw): same final sim state, far
          // faster.
          await page.evaluate(pgStepNoDraw, 330);
          await page.evaluate(() => {
            const g = (window as any).game;
            g.engine.setCamera(Math.floor(g.grid.width / 2), -3, 1.7);
            g.engine.animClock = 252; // cycle start: the train is still off-lot
          });
        },
        // anim lands at exactly 252.5 (settle steps the TestClock in whole
        // frames): entry runs 252..255, so the nose is at world x ~692 while
        // the camera frame starts at ~1586, an off-screen margin of ~900px.
        wait: 500,
      },
      {
        name: "metro-station-train",
        setup: async (page) => {
          // A little more crowd, then re-base the cycle so the settle lands
          // mid-dwell: the consist parked at the platform, doors at the crowd.
          // Intermediate crowd frames, discarded before the shot, so no draw.
          await page.evaluate(pgStepNoDraw, 60);
          await page.evaluate(() => {
            const g = (window as any).game;
            g.engine.setCamera(Math.floor(g.grid.width / 2), -3, 1.7);
            g.engine.animClock = 240; // parked window spans +3s to +9s from here
          });
        },
        wait: 6000, // anim 246: train parked; six more seconds of arrivals
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
      // drawSettle: the per-shot viewport resize is applied through the draw path,
      // so these must draw every settle frame (a no-draw settle drifts them).
      { name: "tablet-portrait", viewport: { width: 834, height: 1112 }, wait: 500, drawSettle: true },
      { name: "tablet-compact", viewport: { width: 1000, height: 720 }, wait: 500, drawSettle: true },
    ],
  },
];
