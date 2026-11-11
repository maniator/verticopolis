/**
 * Security guards moving through the building, during an event and outside
 * one: the drift checks for the bomb search the 3.0.1 fix added (#1886) and
 * for the guard figures the overlay draws. Part of the SCENES manifest;
 * concatenated in order by `screenshot-scenes.ts`. Keep ERASABLE.
 *
 * Every tower comes from `buildSecurityTower`; each scene's `initScript`
 * leaves its choices on `window.__vcShotSecurity` before the page boots. A
 * ransom scene's builder leaves the ransom call waiting, and its setup
 * declines it through the real dialog, so the search starts the way a
 * player starts it. The setups then run the engine itself (`enginePort.tick`)
 * and check the search the engine reports before the capture, failing the
 * scene (and keeping the committed image) when the guards are not where the
 * shot needs them.
 *
 * The search lives in the Rust engine's save alone (the TypeScript reference
 * was never taught it), so nothing after the decline may edit `game.sim`:
 * handing the copy back would load a tower with no search. None of these
 * setups is in SETTLE_AFTER_SETUP for that reason.
 */
import { type Page } from "playwright";
import { type Scene } from "../screenshot-env.ts";
import { buildSecurityTower } from "../screenshot-builders.ts";

/** What the engine reports about the search (`bombSearch()`), or null. */
interface SearchRead {
  minutes: number;
  search: { deadline: number; sweeping: { floor: number; from: number; start: number; arrive: number; done: number }[]; searched: number[] } | null;
}

/** In-page: the engine's clock and its read of the search. */
function pgReadSearch(): SearchRead {
  const g = (window as unknown as { game: any }).game;
  const text = g.enginePort.bombSearch?.();
  return { minutes: g.renderSim.clock.minutes, search: text === undefined ? null : JSON.parse(text) };
}

/** In-page: run the engine `minutes` of game time in one step, then read
 *  the frame again so the overlay draws where the engine is now. */
function pgRunEngine(minutes: number): void {
  const g = (window as unknown as { game: any }).game;
  g.enginePort.tick(minutes);
  g.reader.update();
}

/** Decline the waiting ransom call through the emergency dialog's own
 *  Decline button, the player's path into the search. */
async function declineRansom(page: Page): Promise<void> {
  // The frame loop raises the dialog on its next UI pass, and it runs that
  // pass only when 160 ms of real time have passed since the last one
  // (frameLoop.ts). So wait out that throttle in real time, then step one
  // frame of the page's stepped clock (speed 0, so the tower holds still).
  // One step is the usual case, which keeps the animation frame the same on
  // every run; a busy machine may need another.
  await page.evaluate(async () => {
    const clock = (window as unknown as { game: any }).game.engine.engine.clock;
    const open = () => (document.getElementById("modal") as HTMLDialogElement | null)?.open === true;
    for (let i = 0; i < 20 && !open(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      clock.step(1000 / 60);
    }
  });
  const decline = page.locator('dialog#modal[open] [data-act="decline"]');
  await decline.waitFor({ state: "visible", timeout: 4000 });
  await decline.click();
  const read = await page.evaluate(pgReadSearch);
  if (!read.search) throw new Error("declining the ransom started no bomb search");
}

/** Fail the shot unless the search is running with at least one guard on
 *  the emergency stairs and at least one walking a floor's rooms. */
function expectClimbingAndWalking(read: SearchRead, where: string): void {
  const s = read.search;
  if (!s) throw new Error(`${where}: no bomb search is running`);
  const climbing = s.sweeping.filter((g) => read.minutes < g.arrive).length;
  const walking = s.sweeping.filter((g) => read.minutes >= g.arrive && read.minutes < g.done).length;
  if (climbing === 0 || walking === 0) {
    throw new Error(`${where}: wanted guards both climbing and walking, got ${climbing} climbing and ${walking} walking at minute ${read.minutes}`);
  }
}

/** The search three game minutes after the refusal: the guards headed one
 *  floor away are already walking the rooms, the ones headed further are
 *  still on the stairs. */
async function searchUnderWay(page: Page, where: string): Promise<void> {
  await declineRansom(page);
  await page.evaluate(pgRunEngine, 3);
  expectClimbingAndWalking(await page.evaluate(pgReadSearch), where);
}

/** The shared framing: floors 3 to 10 around the Security office's floor
 *  6, close enough that a guard reads at a glance. */
const FRAME = { floor: 6, zoom: 1.6 } as const;
/** The thief's floor, closer still. */
const THIEF_FRAME = { floor: 4, zoom: 2.2 } as const;

export const SECURITY_SCENES: Scene[] = [
  {
    id: "security-search-classic",
    outDir: "features",
    initScript: () => {
      (window as unknown as { __vcShotSecurity: unknown }).__vcShotSecurity = { mode: "classic", hour: 10, ransom: true };
    },
    build: buildSecurityTower,
    assertUnits: 40,
    shots: [
      {
        // Six guards out of the floor 6 office: up and down the emergency
        // stairs at the rooms' left edge and along the nearest floors, the
        // countdown to 1:00 PM and the red edge glow.
        name: "security-search-classic",
        frame: FRAME,
        setup: (page) => searchUnderWay(page, "security-search-classic"),
        wait: 400,
      },
      {
        // The same search played out a minute at a time until the guards
        // find the bomb: the guards, the countdown and the glow are gone.
        name: "security-search-over",
        frame: FRAME,
        setup: async (page) => {
          for (let i = 0; i < 240; i++) {
            const read = await page.evaluate(pgReadSearch);
            if (!read.search) break;
            await page.evaluate(pgRunEngine, 1);
          }
          const end = await page.evaluate(() => {
            const g = (window as unknown as { game: any }).game;
            // The engine's own log says how the search ended.
            const log = JSON.stringify(JSON.parse(g.enginePort.serialize()).log ?? []);
            return { running: g.enginePort.bombSearch?.() !== undefined, found: log.includes("Security found the bomb"), blew: log.includes("the bomb went off on") };
          });
          if (end.running) throw new Error("security-search-over: the search was still running four hours after the refusal");
          if (!end.found || end.blew) throw new Error("security-search-over: the guards did not find the bomb; this shot wants the search that finds it");
        },
        wait: 400,
      },
    ],
  },
  {
    id: "security-search-modern",
    outDir: "features",
    initScript: () => {
      (window as unknown as { __vcShotSecurity: unknown }).__vcShotSecurity = { mode: "modern", hour: 10, ransom: true };
    },
    build: buildSecurityTower,
    assertUnits: 40,
    shots: [
      {
        // Modern answers a refused ransom with the same search.
        name: "security-search-modern",
        frame: FRAME,
        setup: (page) => searchUnderWay(page, "security-search-modern"),
        wait: 400,
      },
    ],
  },
  {
    id: "security-search-joins",
    outDir: "features",
    initScript: () => {
      (window as unknown as { __vcShotSecurity: unknown }).__vcShotSecurity = { mode: "modern", hour: 8, ransom: true, gap: true };
    },
    build: buildSecurityTower,
    assertUnits: 40,
    shots: [
      {
        // A second Security office, started on floor 11 at 8:00, opens in
        // the middle of one long engine step during the search. Its guards
        // join at the minute it opened, after the first office's guards
        // have moved on from the floors they finished (#1886 review), so
        // the long step draws what minute steps would.
        name: "security-search-joins",
        frame: FRAME,
        setup: async (page) => {
          const opens = await page.evaluate(() => {
            const g = (window as unknown as { game: any }).game;
            const port = g.enginePort;
            const before = port.bombSearch?.();
            if (before !== undefined) throw new Error("a search is already running before the ransom was answered");
            const at = (window as unknown as { __vcShotSecurityGapAt?: number }).__vcShotSecurityGapAt;
            if (at === undefined) throw new Error("the builder left no gap on floor 11");
            const r = port.buildAt(g.portCodes.kind("security"), 11, at);
            if (r[0] !== 1) throw new Error(`the second Security office did not place on floor 11: ${port.lastReason() ?? "no reason given"}`);
            const office = JSON.parse(port.serialize()).units.find((u: any) => u.kind === "security" && u.floor === 11);
            const done = office?.completeAt;
            if (typeof done !== "number") throw new Error("the second Security office is not under construction");
            return done as number;
          });
          // Ten minutes before it opens, refuse the ransom.
          const now = (await page.evaluate(pgReadSearch)).minutes;
          if (opens - 10 <= now) throw new Error(`security-search-joins: the second office opens at minute ${opens}, too soon after minute ${now} to refuse the ransom ten minutes before it`);
          await page.evaluate(pgRunEngine, opens - 10 - now);
          await declineRansom(page);
          // One step across the opening.
          await page.evaluate(pgRunEngine, 13);
          const read = await page.evaluate(pgReadSearch);
          const late = read.search?.sweeping.filter((g) => g.from === 11 && Math.abs(g.start - opens) < 1e-6) ?? [];
          if (late.length === 0) throw new Error(`security-search-joins: no guard set out from floor 11 at minute ${opens}`);
          expectClimbingAndWalking(read, "security-search-joins");
        },
        wait: 400,
      },
    ],
  },
  {
    id: "security-quiet-day",
    outDir: "features",
    initScript: () => {
      // Pin steadyClock so the fixed wait lands at the same lunchtime moment.
      localStorage.setItem("vc.prefs", JSON.stringify({ steadyClock: true }));
      (window as unknown as { __vcShotSecurity: unknown }).__vcShotSecurity = { mode: "classic", hour: 11, speed: 1 };
    },
    build: buildSecurityTower,
    assertUnits: 40,
    shots: [
      {
        // No event: the office staff and the Security office's guards head
        // out for lunch in the crowd, and the overlay draws no search.
        name: "security-quiet-day",
        frame: FRAME,
        setup: async (page) => {
          const read = await page.evaluate(pgReadSearch);
          if (read.search) throw new Error("security-quiet-day: a bomb search is running on a quiet day");
        },
        wait: 5000,
      },
      {
        // Security catching a thief: the guard trails him along floor 4's
        // rooms, from the emergency stairs at their left edge. The daily
        // roll's thief is random, so the overlay's own run is staged at its
        // start, with the span of the floor's rooms worked out the way the
        // overlay does (floorRoomSpan), and the pair is mid-floor at the
        // capture.
        name: "security-thief-caught",
        frame: THIEF_FRAME,
        setup: async (page) => {
          await page.evaluate(() => {
            const e = (window as unknown as { game: any }).game.engine;
            // Fail loudly if the overlay renamed its thief fields, rather
            // than capture a frame with no thief in it.
            for (const field of ["thiefStart", "thiefCaught", "thiefFloor", "thiefSpan"]) {
              if (!(field in e)) throw new Error(`security-thief-caught: the tower overlay has no ${field} field any more`);
            }
            const rooms = e.sim.tower.units.filter((u: any) => u.floor === 4 && u.kind !== "floor" && u.kind !== "lobby");
            if (rooms.length === 0) throw new Error("security-thief-caught: floor 4 has no rooms to run");
            e.thiefSpan = { left: Math.min(...rooms.map((u: any) => u.x)), right: Math.max(...rooms.map((u: any) => u.x + u.width)) };
            e.thiefStart = e.d.anim;
            e.thiefCaught = true;
            e.thiefFloor = 4;
          });
        },
        wait: 1800,
      },
    ],
  },
];
