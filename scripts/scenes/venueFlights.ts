/**
 * Flights beside a venue (`src/render/venueFlights.ts`): the stills the Help
 * site's "Beside a venue" section shows
 * (help-site/src/content/docs/building/stairs-and-escalators.mdx). In Modern a
 * one-story stairway against a venue's wall is a spiral staircase and an
 * escalator there turns back halfway up; Classic draws both straight. Every
 * tower comes from `buildVenueFlightsTower`, which founds it through New Tower
 * and builds with the same engine calls the build tools make. Static towers at
 * a fixed hour. Keep ERASABLE.
 */
import { type Page } from "@playwright/test";
import { type Scene } from "../screenshot-env.ts";
import { buildVenueFlightsTower } from "../screenshot-builders.ts";

/** Center the camera `dx` tiles right of the venues' left wall, on `floor`,
 *  so the flights against it sit clear of the Map in the lower right. */
async function frame(page: Page, dx: number, floor: number, zoom: number): Promise<void> {
  await page.evaluate(
    ([dx, floor, zoom]) => {
      const w = window as unknown as { game: any; __vcShotVenueFlightsAt?: { wall: number } };
      const at = w.__vcShotVenueFlightsAt;
      if (!at) throw new Error("the venue flights tower was not built");
      w.game.engine.setCamera(at.wall + dx, floor, zoom);
    },
    [dx, floor, zoom] as const,
  );
}

export const VENUE_FLIGHT_SCENES: Scene[] = [
  {
    id: "venue-flights",
    outDir: "features",
    build: buildVenueFlightsTower,
    shots: [
      {
        // A spiral stair against the cinema, and over it a half-turn
        // escalator against the party hall.
        name: "venue-flights-cinema",
        clock: 13,
        setup: (page) => frame(page, 2, 3.5, 2.6),
        wait: 400,
      },
      {
        // An escalator and a spiral stair stacked against the metro's wall.
        name: "venue-flights-metro",
        clock: 13,
        setup: (page) => frame(page, 2, -1.5, 2.6),
        wait: 400,
      },
    ],
  },
];
