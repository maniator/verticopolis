/**
 * Every Modern tower's own front door: two towers apart on one lot, each with
 * the grand entrance and doorman at the left end of its ground lobby and the
 * service door at the right end (`buildFrontDoorTowers`), by day and by night,
 * for the Help site's ground lobby section
 * (help-site/src/content/docs/building/floors-and-lobbies.mdx). Keep ERASABLE.
 */
import { type Page } from "@playwright/test";
import { type Scene } from "../screenshot-env.ts";
import { buildFrontDoorTowers } from "../screenshot-builders.ts";

/** Both towers' ground floors, from the left grand entrance to the right service door. */
async function frameBoth(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.game;
    g.engine.setCamera(Math.floor(g.grid.width / 2) + 4, 2, 1.5);
  });
}

export const FRONT_DOOR_SCENES: Scene[] = [
  {
    id: "front-doors",
    outDir: "features",
    build: buildFrontDoorTowers,
    shots: [
      {
        name: "front-doors",
        clock: 10,
        setup: frameBoth,
        wait: 400,
      },
      {
        // The same doors at night, the awnings and gold doors lit.
        name: "front-doors-night",
        clock: 21,
        setup: frameBoth,
        wait: 400,
      },
    ],
  },
];
