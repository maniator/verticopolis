/**
 * Tall lobbies (#308): the stills the Help site's "Tall lobbies" section shows
 * (help-site/src/content/docs/building/floors-and-lobbies.mdx). A Classic
 * 3-story ground hall, a Modern 2-story sky lobby, the Lobby card's height
 * picker, and the phone's Lobby height strip; and for the "Stairs and
 * escalators" page, the spiral stair and switchback escalator out of a tall
 * hall. Every tower comes from
 * `buildTallLobbyTower`, which founds it through New Tower and builds with the
 * same engine calls the build tools make; it fails closed when a lobby does
 * not rise. Static towers at a fixed hour, so the PHONE scene stays
 * deterministic across the drift check's two render legs. Keep ERASABLE.
 */
import { type Page } from "@playwright/test";
import { type Scene, PHONE } from "../screenshot-env.ts";
import { buildTallLobbyTower } from "../screenshot-builders.ts";

/** Arm the Lobby tool from the build palette and pick `stories` on `picker`
 *  (the Lobby card on a desktop, the strip over the tower on a phone), the
 *  way a player does. Fails the shot if the pick does not take. */
async function armLobby(page: Page, picker: string, stories: number): Promise<void> {
  await page.locator('.pal-item[data-kind="lobby"]').first().click();
  const button = page.locator(picker).getByRole("button", { name: `${stories} stories` });
  await button.click();
  await page.locator(picker).locator('[aria-pressed="true"]', { hasText: `${stories} stories` }).waitFor({ timeout: 4000 });
}

/** Center the camera `dx` tiles from the lot's center, on `floor`, so the
 *  hall sits clear of the Map in the stage's lower right. */
async function frameHall(page: Page, dx: number, floor: number, zoom: number): Promise<void> {
  await page.evaluate(
    ([dx, floor, zoom]) => {
      const w = window as unknown as { game: any; __vcShotTallLobbyAt?: { cx: number } };
      const at = w.__vcShotTallLobbyAt;
      if (!at) throw new Error("the tall lobby tower was not built");
      w.game.engine.setCamera(at.cx + dx, floor, zoom);
    },
    [dx, floor, zoom] as const,
  );
}

export const TALL_LOBBY_SCENES: Scene[] = [
  {
    id: "tall-lobby-classic",
    outDir: "features",
    initScript: () => {
      (window as unknown as { __vcShotTallLobby: unknown }).__vcShotTallLobby = { mode: "classic", ground: 3 };
    },
    build: buildTallLobbyTower,
    shots: [
      {
        // The open hall: one cornice, one floor, the columns and the wide
        // arched windows running all three stories, the entrance at its left.
        name: "tall-lobby-ground",
        clock: 10,
        setup: (page) => frameHall(page, -8, 2.5, 1.8),
        wait: 400,
      },
      {
        // The Lobby card with its height picker, set to 3 stories.
        name: "tall-lobby-picker",
        crop: "#tool-info",
        setup: (page) => armLobby(page, "#tool-info", 3),
        wait: 300,
      },
    ],
  },
  {
    id: "tall-lobby-modern-sky",
    outDir: "features",
    initScript: () => {
      (window as unknown as { __vcShotTallLobby: unknown }).__vcShotTallLobby = { mode: "modern", ground: 2, sky: 2 };
    },
    build: buildTallLobbyTower,
    shots: [
      {
        // A Modern sky lobby two stories high: one curtain wall of glass.
        name: "tall-lobby-sky",
        clock: 10,
        setup: (page) => frameHall(page, -6, 16, 1.8),
        wait: 400,
      },
    ],
  },
  {
    id: "tall-lobby-flights",
    outDir: "features",
    initScript: () => {
      (window as unknown as { __vcShotTallLobby: unknown }).__vcShotTallLobby = { mode: "classic", ground: 3, flights: true };
    },
    build: buildTallLobbyTower,
    shots: [
      {
        // The spiral stair and the switchback escalator climbing the hall.
        name: "tall-lobby-flights",
        clock: 10,
        setup: (page) => frameHall(page, 4, 2.5, 2.2),
        wait: 400,
      },
    ],
  },
  {
    id: "tall-lobby-phone",
    outDir: "features",
    viewport: PHONE,
    initScript: () => {
      (window as unknown as { __vcShotTallLobby: unknown }).__vcShotTallLobby = { mode: "classic", ground: 3 };
    },
    build: buildTallLobbyTower,
    shots: [
      {
        // On a phone the Lobby card is in the closed drawer, so arming the
        // Lobby tool shows the Lobby height strip over the tower.
        name: "tall-lobby-phone",
        clock: 10,
        setup: async (page) => {
          await armLobby(page, "#lobby-height-strip", 3);
          await frameHall(page, -14, 3, 1.4);
        },
        wait: 400,
      },
    ],
  },
];
