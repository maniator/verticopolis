/**
 * The row of rooms (Modern, #646): the stills the Help site's controls page
 * shows. The ghost of a row of offices a drag along a floor lays, past the
 * condo in its way, with the row's price and length; the same drag in red
 * with the reason when the money does not cover it; and the row the release
 * placed. Every shot drives the pointer handlers a mouse drives (press, move,
 * release) over the tower `buildRoomRowTower` founds, with the Office button
 * picked from the palette. Desktop only: a touch drag keeps its lifted ghost,
 * which places one room. A static tower at a fixed hour, so the drift
 * check's two legs agree; its own shard, `room-row`, as new features get.
 * Keep ERASABLE.
 */
import { type Page } from "@playwright/test";
import { type Scene } from "../screenshot-env.ts";
import { buildRoomRowTower } from "../screenshot-room-row-builders.ts";

/** Pick the Office tool from its palette button, the way a player does. */
async function armOffice(page: Page): Promise<void> {
  await page.locator('.pal-item[data-kind="office"]').first().click();
  await page.locator('.pal-item[data-kind="office"].active').first().waitFor({ timeout: 4000 });
}

/** Press at the row's start and drag to its end, as a mouse does, leaving
 *  the row's ghost drawn. `money` sets the balance first. */
async function dragRow(page: Page, money: number): Promise<void> {
  await page.evaluate((money) => {
    const w = window as unknown as { game: any; __vcShotRoomRow?: { from: number; to: number; floor: number } };
    const at = w.__vcShotRoomRow;
    if (!at) throw new Error("the room row tower was not built");
    const g = w.game;
    g.enginePort.setMoney(money);
    g.engine.onActionDown(at.from, at.floor, false, null);
    g.engine.onActionMove(at.to, at.floor, null);
    const rooms = g.engine.preview?.rooms;
    if (!rooms || rooms.length < 2) throw new Error("the drag drew no row");
    (w as unknown as { __vcShotRoomRowRooms?: number[] }).__vcShotRoomRowRooms = [...rooms];
  }, money);
}

/** Release the drag, placing the row, and drop the tool. */
async function releaseRow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { game: any; __vcShotRoomRow?: { from: number; to: number; floor: number }; __vcShotRoomRowRooms?: number[] };
    const at = w.__vcShotRoomRow!;
    const g = w.game;
    g.engine.onActionUp(at.to, at.floor, null);
    g.ui.selectTool({ type: "inspect" });
    g.engine.preview = null;
    g.reader.update();
    for (const x of w.__vcShotRoomRowRooms ?? []) {
      if (g.reader.roomAt(at.floor, x) === undefined) throw new Error(`the release placed no room at ${x}`);
    }
  });
}

/** Let go of a refused drag without placing it. */
async function cancelRow(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as unknown as { game: any }).game;
    g.engine.onActionCancel?.();
    g.engine.preview = null;
  });
}

export const ROOM_ROW_SCENES: Scene[] = [
  {
    id: "room-row",
    outDir: "features",
    build: buildRoomRowTower,
    shots: [
      {
        // A row of offices past the condo, with its price and length.
        name: "room-row-ghost",
        clock: 10,
        setup: async (page) => {
          await armOffice(page);
          await dragRow(page, 5_000_000);
        },
        wait: 400,
      },
      {
        // The same drag in red when the money does not cover the row.
        name: "room-row-refused",
        clock: 10,
        setup: async (page) => {
          await cancelRow(page);
          await dragRow(page, 100_000);
        },
        wait: 400,
      },
      {
        // The row the release placed, one undo step.
        name: "room-row-built",
        clock: 10,
        setup: async (page) => {
          await cancelRow(page);
          await armOffice(page);
          await dragRow(page, 5_000_000);
          await releaseRow(page);
        },
        wait: 400,
      },
    ],
  },
];
