/**
 * Two Modern towers side by side on one lot, each on its own ground lobby
 * (`buildSplitLotTower`): the still the Help site's "How people get around"
 * section shows (help-site/src/content/docs/tower/people.mdx), with the
 * office staff of the left tower out on the street on their way to lunch in
 * the right one (`engine-rs/src/crowd/street.rs`). The setup runs the engine
 * itself a minute at a time from noon until someone is out on the open
 * ground, and fails the scene (keeping the committed image) when nobody is.
 * The engine is deterministic, so every run stops at the same minute. Keep
 * ERASABLE.
 */
import { type Page } from "@playwright/test";
import { type Scene } from "../screenshot-env.ts";
import { buildSplitLotTower } from "../screenshot-builders.ts";

/** The most minutes the setup runs before it gives up on a walker. */
const MAX_MINUTES = 90;

/** In-page: runs the engine a minute at a time until someone stands on the
 *  open ground between the towers, then reads the frame again so the people
 *  draw where the engine has them. Answers the minutes run, or -1. */
function pgUntilSomeoneWalksTheStreet(max: number): number {
  const w = window as unknown as { game: any; __vcShotSplitLot?: [number, number][] };
  const g = w.game;
  const towers = w.__vcShotSplitLot;
  if (!towers) throw new Error("the split lot was not built");
  const [gapFrom, gapTo] = [towers[0][1] + 1, towers[1][0]];
  const onStreet = (): boolean =>
    (g.sim.crowd.people as { x: number; floor: number }[]).some((p) => p.floor === 1 && p.x >= gapFrom + 2 && p.x <= gapTo - 2);
  for (let m = 1; m <= max; m++) {
    g.enginePort.tick(1);
    if (onStreet()) {
      g.reader.update();
      return m;
    }
  }
  return -1;
}

async function walkerOnTheStreet(page: Page): Promise<void> {
  const ran = await page.evaluate(pgUntilSomeoneWalksTheStreet, MAX_MINUTES);
  if (ran < 0) throw new Error(`split-lot-street: nobody walked the street in ${MAX_MINUTES} minutes`);
}

export const SPLIT_LOT_SCENES: Scene[] = [
  {
    id: "split-lot-street",
    outDir: "features",
    build: buildSplitLotTower,
    shots: [
      {
        name: "split-lot-street",
        setup: walkerOnTheStreet,
        wait: 400,
      },
    ],
  },
];
