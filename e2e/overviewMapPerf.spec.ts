import { test, expect } from "@playwright/test";
import { buildToStar, expectEngineHosted } from "./helpers";

// Every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/**
 * What the overview MAP window (#343) costs on a large tower, measured in the
 * real browser: the real catalog height lookup, the real pattern source and
 * real canvases (the S2 unit budget is synthetic and pins only the algorithm's
 * shape). This covers the map alone; the game's own frame and panel timing
 * have their own gates (`perf.spec.ts`).
 *
 * Three costs, each a median of timed batches:
 * - opening the window, which rebuilds the map and paints both canvases (the
 *   same work a command that changes the tower costs);
 * - a frame with nothing changed, which is what an open map adds to every
 *   frame of play;
 * - a frame after the camera moved, which repaints only the view mark.
 *
 * The ceilings are loose on purpose, ten times or more what a local run
 * measures (about 2 ms to open; an open frame and a closed one cost less than
 * the browser's timer can resolve even over a batch of 200), so they catch a
 * change in kind (a per-frame rebuild, a per-frame scan of the rooms) without
 * tripping on a slow runner. The measured numbers are printed for the PR.
 *
 * The second test does the same for the Hotel view (S6):
 * a steady frame, a frame on which the game hour turns with nothing changed,
 * and an hourly repaint with every hotel room changed. The third does it for
 * the Pricing view (S8): a steady frame, which reads no tiers, a frame on
 * which the game hour turns, which reads them, and a frame that places the
 * rows again and repaints.
 *
 * This is the map's own cost. The paired whole-frame run, map open against
 * map closed on the `large` fixture, goes through the perf harness
 * (`npm run perf:worker -- --aa wasm --map-ab`, SPEC CAP-6).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Ceiling for opening the window on the large tower: rebuild and full paint. */
const OPEN_CEILING_MS = 30;
/** Ceiling for an open frame with nothing changed. */
const STEADY_CEILING_MS = 0.02;
/** Ceiling for a frame after a camera move (the move itself included). */
const CAMERA_CEILING_MS = 0.5;
/** Ceiling for a closed window's frame. */
const CLOSED_CEILING_MS = 0.005;

test.use({ viewport: { width: 1280, height: 800 } });

test("the map's cost on a large tower stays within its ceilings", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).game && (window as any).overviewMap));
  await page.evaluate(() => document.getElementById("splash")?.remove());
  // The 5-star rung: 62 floors of offices across the lot, the deep basement,
  // and the metro, a few thousand rooms.
  const star = await page.evaluate(buildToStar, 5);
  expect(star).toBe(5);

  const result = await page.evaluate(() => {
    const win = (window as any).overviewMap;
    const g = (window as any).game;
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    // Settle: the first open after the build pays for the tower's first read.
    win.setOpen(false, false);
    win.setOpen(true, false);

    const open: number[] = [];
    for (let i = 0; i < 15; i++) {
      win.setOpen(false, false);
      const t0 = performance.now();
      win.setOpen(true, false);
      open.push(performance.now() - t0);
    }

    const BATCH = 200;
    const steady: number[] = [];
    for (let b = 0; b < 15; b++) {
      const t0 = performance.now();
      for (let i = 0; i < BATCH; i++) win.frame();
      steady.push((performance.now() - t0) / BATCH);
    }

    const camera: number[] = [];
    const view = g.engine.viewState();
    for (let b = 0; b < 15; b++) {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) {
        g.engine.applyView({ tile: view.tile, floor: 10 + ((b * 20 + i) % 40) });
        win.frame();
      }
      camera.push((performance.now() - t0) / 20);
    }
    g.engine.applyView(view);

    win.setOpen(false, false);
    const closed: number[] = [];
    for (let b = 0; b < 15; b++) {
      const t0 = performance.now();
      for (let i = 0; i < BATCH; i++) win.frame();
      closed.push((performance.now() - t0) / BATCH);
    }
    win.setOpen(true, false);

    // The tower bitmap must hold the tower, so the timings above are of a
    // real paint. The canvas starts each paint transparent (the sky and the
    // ground are the body's CSS background), so count the painted pixels.
    const bitmap = document.querySelector("#overview-map .overview-map-tower") as HTMLCanvasElement;
    const pixels = bitmap.getContext("2d")!.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let towerPixels = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) towerPixels++;

    return {
      rooms: g.reader.rooms.length,
      towerPixels,
      bitmapPixels: bitmap.width * bitmap.height,
      openMs: median(open),
      steadyMs: median(steady),
      cameraMs: median(camera),
      closedMs: median(closed),
    };
  });

  console.log(`overview map perf: ${JSON.stringify(result)}`);
  expect(result.rooms).toBeGreaterThan(1000);
  // A 5-star tower fills a good share of the map; an empty paint is a few
  // stray pixels at most.
  expect(result.towerPixels).toBeGreaterThan(result.bitmapPixels / 20);
  expect(result.openMs).toBeLessThan(OPEN_CEILING_MS);
  expect(result.steadyMs).toBeLessThan(STEADY_CEILING_MS);
  expect(result.cameraMs).toBeLessThan(CAMERA_CEILING_MS);
  expect(result.closedMs).toBeLessThan(CLOSED_CEILING_MS);
});

/** Ceiling for an hourly Hotel view repaint on the large tower: one read of
 *  every hotel room, a full tower repaint and the red rooms over it. */
const HOTEL_REPAINT_CEILING_MS = 30;
/** Ceiling for a frame on which the game hour turns and no room changed:
 *  one read of every hotel room, no paint. */
const HOTEL_HOUR_CEILING_MS = 0.5;

/**
 * Add hotel singles in the free strip left of the offices on floors 3 to 62
 * of the 5-star rung (six a floor, about 360 rooms), so the Hotel view has
 * rooms to read. Runs in the page.
 */
function addHotelRooms(): number {
  const g = (window as any).game;
  const s = g.sim.constructor.deserialize(JSON.parse(JSON.stringify(g.sim.serialize())));
  s.money = 1e9;
  let placed = 0;
  for (let f = 3; f <= 62; f++) for (let x = 5; x + 4 <= 29; x += 4) if (s.tower.place("hotelSingle", f, x).ok) placed++;
  g.adoptSim(s, true);
  g.speed = 0;
  return placed;
}

test("the Hotel view's hourly repaint on a large tower stays within its ceilings", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).game && (window as any).overviewMap));
  await page.evaluate(() => document.getElementById("splash")?.remove());
  expect(await page.evaluate(buildToStar, 5)).toBe(5);
  expect(await page.evaluate(addHotelRooms)).toBeGreaterThan(300);
  await page.getByRole("tab", { name: "Hotel" }).click();

  const result = await page.evaluate(() => {
    const win = (window as any).overviewMap;
    const g = (window as any).game;
    const views = win.deps.views;
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    // The game is paused: the views read a clock this test turns by hand.
    let minutes = g.reader.header.minutes;
    views.deps.minutes = () => minutes;
    win.frame();
    const hotels = (g.reader.rooms as any[]).filter((r) => r.kind === "hotelSingle");

    const BATCH = 200;
    const steady: number[] = [];
    for (let b = 0; b < 15; b++) {
      const t0 = performance.now();
      for (let i = 0; i < BATCH; i++) win.frame();
      steady.push((performance.now() - t0) / BATCH);
    }

    const hour: number[] = [];
    for (let b = 0; b < 15; b++) {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) {
        minutes += 60;
        win.frame();
      }
      hour.push((performance.now() - t0) / 20);
    }

    // Each sample turns the hour with every hotel room's state flipped, so
    // the frame reads them all and repaints the tower layer.
    const repaint: number[] = [];
    for (let b = 0; b < 15; b++) {
      const state = b % 2 === 0 ? "dirty" : "empty";
      for (const r of hotels) r.state = state;
      minutes += 60;
      const t0 = performance.now();
      win.frame();
      repaint.push(performance.now() - t0);
    }
    // End with the rooms dirty, so the bitmap shows the red rooms.
    for (const r of hotels) r.state = "dirty";
    minutes += 60;
    win.frame();
    const bitmap = document.querySelector("#overview-map .overview-map-tower") as HTMLCanvasElement;
    const px = bitmap.getContext("2d")!.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let red = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0 && px[i] > 150 && px[i + 1] < 70 && px[i + 2] < 70) red++;
    return { hotelRooms: hotels.length, red, steadyMs: median(steady), hourMs: median(hour), repaintMs: median(repaint) };
  });

  console.log(`overview map hotel perf: ${JSON.stringify(result)}`);
  expect(result.hotelRooms).toBeGreaterThan(300);
  expect(result.red).toBeGreaterThan(result.hotelRooms);
  expect(result.steadyMs).toBeLessThan(STEADY_CEILING_MS);
  expect(result.hourMs).toBeLessThan(HOTEL_HOUR_CEILING_MS);
  expect(result.repaintMs).toBeLessThan(HOTEL_REPAINT_CEILING_MS);
});

/** Ceiling for an Eval or Pricing frame on the large tower that reads the
 *  engine's tiers (one call and one pass over the rooms in the engine), or
 *  places the rows again (one pass over the rooms) and repaints the tower
 *  layer with the tier colors over it. */
const TIER_READ_CEILING_MS = 30;

test("the Pricing view's reads on a large tower stay within their ceilings", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).game && (window as any).overviewMap));
  await page.evaluate(() => document.getElementById("splash")?.remove());
  expect(await page.evaluate(buildToStar, 5)).toBe(5);
  await page.evaluate(() => ((window as any).game.speed = 0));
  await page.getByRole("tab", { name: "Pricing" }).click();

  const result = await page.evaluate(() => {
    const win = (window as any).overviewMap;
    const g = (window as any).game;
    const views = win.deps.views;
    const median = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    // The game is paused: the views read a clock this test turns by hand.
    let minutes = g.reader.header.minutes;
    views.deps.minutes = () => minutes;
    let reads = 0;
    const tiers = views.deps.tiers;
    const read = tiers.read.bind(tiers);
    tiers.read = () => {
      reads++;
      return read();
    };
    win.frame();
    const rows = views.tierMarks.rowCount;

    const BATCH = 200;
    const before = reads;
    const steady: number[] = [];
    for (let b = 0; b < 15; b++) {
      const t0 = performance.now();
      for (let i = 0; i < BATCH; i++) win.frame();
      steady.push((performance.now() - t0) / BATCH);
    }
    const steadyReads = reads - before;

    // Each sample turns the hour, so the frame reads the tiers; the paused
    // tower's tiers do not move, so it repaints nothing.
    const hour: number[] = [];
    const beforeHours = reads;
    for (let b = 0; b < 15; b++) {
      minutes += 60;
      const t0 = performance.now();
      win.frame();
      hour.push(performance.now() - t0);
    }
    const hourReads = reads - beforeHours;
    // A layout change places the rows again and repaints, with no read.
    const repaint: number[] = [];
    for (let b = 0; b < 15; b++) {
      views.tierLayout = null;
      const t0 = performance.now();
      win.frame();
      repaint.push(performance.now() - t0);
    }
    return { rooms: g.reader.rooms.length, rows, steadyReads, hourReads, steadyMs: median(steady), hourMs: median(hour), repaintMs: median(repaint) };
  });

  console.log(`overview map pricing perf: ${JSON.stringify(result)}`);
  expect(result.rows).toBeGreaterThan(1000);
  expect(result.steadyReads).toBe(0);
  expect(result.hourReads).toBe(15);
  expect(result.steadyMs).toBeLessThan(STEADY_CEILING_MS);
  expect(result.hourMs).toBeLessThan(TIER_READ_CEILING_MS);
  expect(result.repaintMs).toBeLessThan(TIER_READ_CEILING_MS);
});
