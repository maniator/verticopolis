/**
 * The answer to a fire (#1889): Security's guards climbing the emergency
 * stairs to the burning room and working it, and the Fire Rescue helicopter
 * flying in and spraying it. Part of the SCENES manifest; concatenated in
 * order by `screenshot-scenes.ts`. Keep ERASABLE.
 *
 * Both scenes start from `buildSecurityTower` (one Security office on floor
 * 6) and light an office on floor 8 through the engine's own `startFireAt`,
 * the tooling twin of the daily roll's ignition. The rescue offer comes up
 * in the real emergency dialog, and each setup answers it there the way a
 * player does, then runs the engine itself (`enginePort.tick`) and checks
 * what the engine reports (`fireResponse()`) before the capture, failing
 * the scene (and keeping the committed image) when the guards or the
 * helicopter are not where the shot needs them.
 *
 * The response lives in the Rust engine's save alone, so nothing after the
 * fire starts may edit `game.sim`, and none of these setups is in
 * SETTLE_AFTER_SETUP.
 */
import { type Page } from "playwright";
import { type Scene } from "../screenshot-env.ts";
import { buildSecurityTower } from "../screenshot-builders.ts";

/** What the engine reports about the answer to the fire, or null. */
interface FireRead {
  minutes: number;
  fire: {
    guards: { arrive: number; done: number }[];
    helicopter: { arrive: number; sprayEnd: number; leave: number } | null;
    out: boolean;
  } | null;
}

/** In-page: the engine's clock and its read of the fire response. */
function pgReadFire(): FireRead {
  const g = (window as unknown as { game: any }).game;
  const text = g.enginePort.fireResponse?.();
  return { minutes: g.renderSim.clock.minutes, fire: text === undefined ? null : JSON.parse(text) };
}

/** In-page: run the engine `minutes` of game time in one step, then read
 *  the frame again so the overlay draws where the engine is now. */
function pgRunEngine(minutes: number): void {
  const g = (window as unknown as { game: any }).game;
  g.enginePort.tick(minutes);
  g.reader.update();
}

/** In-page: light the floor 8 office nearest the lot's center. */
function pgLightFloor8(): void {
  const g = (window as unknown as { game: any }).game;
  const port = g.enginePort;
  const center = Math.floor(g.grid.width / 2);
  const offices = JSON.parse(port.serialize()).units.filter((u: any) => u.kind === "office" && u.floor === 8);
  if (offices.length === 0) throw new Error("the tower has no office on floor 8 to light");
  const mid = (u: any): number => Math.abs(u.x + u.width / 2 - center);
  const room = offices.reduce((a: any, b: any) => (mid(b) < mid(a) ? b : a));
  if (!port.startFireAt(room.id)) throw new Error(`the engine refused to light office ${room.id}`);
  g.reader.update();
}

/** Light the office, then answer the rescue offer through the emergency
 *  dialog's own button (`accept` pays for the helicopter). */
async function lightAndAnswer(page: Page, act: "accept" | "decline", where: string): Promise<void> {
  await page.evaluate(pgLightFloor8);
  // The frame loop raises the dialog on a UI pass at most every 160 ms of
  // real time (frameLoop.ts): wait that out, then step one frame of the
  // page's stepped clock (speed 0, so the tower holds still).
  await page.evaluate(async () => {
    const clock = (window as unknown as { game: any }).game.engine.engine.clock;
    const open = () => (document.getElementById("modal") as HTMLDialogElement | null)?.open === true;
    for (let i = 0; i < 20 && !open(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      clock.step(1000 / 60);
    }
  });
  const button = page.locator(`dialog#modal[open] [data-act="${act}"]`);
  await button.waitFor({ state: "visible", timeout: 4000 });
  await button.click();
  const read = await page.evaluate(pgReadFire);
  if (!read.fire) throw new Error(`${where}: the fire started no response`);
  if ((read.fire.helicopter !== null) !== (act === "accept")) {
    throw new Error(`${where}: ${act === "accept" ? "paying called no helicopter" : "declining still called the helicopter"}`);
  }
}

/** Floors 4 to 11 around the burning floor 8 and the Security office on 6. */
const GUARDS_FRAME = { floor: 7, zoom: 1.6 } as const;
/** Wide enough for the helicopter's approach above the twelve floors. */
const SKY_FRAME = { floor: 10, zoom: 1.1 } as const;

export const FIRE_RESPONSE_SCENES: Scene[] = [
  {
    id: "fire-guards",
    outDir: "features",
    initScript: () => {
      (window as unknown as { __vcShotSecurity: unknown }).__vcShotSecurity = { mode: "classic", hour: 10 };
    },
    build: buildSecurityTower,
    assertUnits: 40,
    shots: [
      {
        // The rescue declined: six guards out of the floor 6 office, the
        // first ones already working the burning room on floor 8 and the
        // rest still on the emergency stairs.
        name: "fire-guards",
        frame: GUARDS_FRAME,
        setup: async (page) => {
          await lightAndAnswer(page, "decline", "fire-guards");
          await page.evaluate(pgRunEngine, 6);
          const read = await page.evaluate(pgReadFire);
          const guards = read.fire?.guards ?? [];
          const climbing = guards.filter((g) => read.minutes < g.arrive).length;
          const there = guards.length - climbing;
          if (climbing === 0 || there === 0) {
            throw new Error(`fire-guards: wanted guards both climbing and at the fire, got ${climbing} climbing and ${there} there at minute ${read.minutes}`);
          }
        },
        wait: 400,
      },
    ],
  },
  {
    id: "fire-helicopter",
    outDir: "features",
    initScript: () => {
      (window as unknown as { __vcShotSecurity: unknown }).__vcShotSecurity = { mode: "classic", hour: 10 };
    },
    build: buildSecurityTower,
    assertUnits: 40,
    shots: [
      {
        // The rescue paid: the helicopter halfway in from the right, the
        // guards already at the fire below it.
        name: "fire-helicopter-arriving",
        frame: SKY_FRAME,
        setup: async (page) => {
          await lightAndAnswer(page, "accept", "fire-helicopter-arriving");
          await page.evaluate(pgRunEngine, 15);
          const read = await page.evaluate(pgReadFire);
          const h = read.fire?.helicopter;
          if (!h || read.minutes >= h.arrive) throw new Error(`fire-helicopter-arriving: no helicopter in flight at minute ${read.minutes}`);
        },
        wait: 400,
      },
      {
        // Landed over the room: the fire is out, the gutted rooms stay
        // dark, and the helicopter sprays a while before it leaves.
        name: "fire-helicopter-spraying",
        frame: SKY_FRAME,
        setup: async (page) => {
          await page.evaluate(pgRunEngine, 20);
          const read = await page.evaluate(pgReadFire);
          const h = read.fire?.helicopter;
          if (!h || read.minutes < h.arrive || read.minutes >= h.sprayEnd) {
            throw new Error(`fire-helicopter-spraying: the helicopter is not spraying at minute ${read.minutes}`);
          }
          if (!read.fire?.out) throw new Error("fire-helicopter-spraying: the fire still burns after the helicopter landed");
        },
        wait: 400,
      },
    ],
  },
];
