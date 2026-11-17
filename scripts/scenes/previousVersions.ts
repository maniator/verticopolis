/**
 * Previous versions of a My Towers tower (owner, 2026-11-16; save-model party
 * verdict item 3, #2380): every state the help page describes. A tower's
 * right-click menu with Previous versions…, the window listing versions the
 * game kept and the one saved by hand, the empty window of a tower with none
 * yet, and the window on a phone. Closing it goes back to the Open or Save
 * As window it came from, as the player left it (Naftali, 2026-11-17): that
 * window is shot after a Cancel, on a computer and a phone. Its own shard,
 * `previous-versions`.
 *
 * The versions are real: the shots write the tower's file the way the game
 * does (Save As, then autosaves, then File > Save), with the page's pinned
 * clock moved back for each write so the rows are minutes and a day apart,
 * the same on every render.
 */
import type { Page } from "playwright";
import { PHONE, type Scene, type Shot } from "../screenshot-env.ts";

/** Page-context: give the live tower a file, "Sky Hotel", with versions an
 *  autosave kept yesterday and today and one saved by hand. */
async function pgMakeVersions(): Promise<void> {
  const w = window as unknown as { game: any };
  const g = w.game;
  const pinned = Date.now();
  const at = (minutesAgo: number) => Object.defineProperty(Date, "now", { configurable: true, value: () => pinned - minutesAgo * 60_000 });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
  try {
    at(1_500);
    await g.saveFile("Sky Hotel");
    for (const minutesAgo of [1_440, 1_400, 95, 50]) {
      at(minutesAgo);
      await g.saveLoad.autosave();
      await settle();
    }
    // File > Save, as the 💾 button does.
    at(20);
    document.getElementById("btn-save-top")?.click();
    await settle();
    at(5);
    await g.saveLoad.autosave();
    await settle();
  } finally {
    Object.defineProperty(Date, "now", { configurable: true, value: () => pinned });
  }
}

/** Page-context: a second tower file nobody wrote over yet. */
async function pgFileWithNone(): Promise<void> {
  const g = (window as unknown as { game: any }).game;
  await g.saveFile("Harbour Point");
  // Back to Sky Hotel's file, so Harbour Point is not the tower being played.
  await g.saveFile("Sky Hotel");
}

/** File > Open… (`mb-import`) or File > Save As… (`mb-export`). */
type FileItem = "mb-import" | "mb-export";

async function openWindow(page: Page, item: FileItem = "mb-import"): Promise<void> {
  await page.evaluate(() => (window as unknown as { game: any }).game.ui.closeModal?.());
  await page.evaluate((id) => document.getElementById(id)?.click(), item);
  await page.waitForSelector("#modal .fd-row", { timeout: 4000 });
}

async function rowMenu(page: Page, name: string, item: FileItem = "mb-import"): Promise<void> {
  await openWindow(page, item);
  await page.locator("#modal .fd-row", { hasText: name }).first().click({ button: "right" });
  await page.waitForSelector("#modal .fd-menu", { timeout: 2000 });
}

async function versionsOf(page: Page, name: string, item: FileItem = "mb-import"): Promise<void> {
  await rowMenu(page, name, item);
  await page.locator("#modal .fd-menu [role=menuitem]", { hasText: "Previous versions" }).click();
  await page.waitForSelector("#modal .pv-window .pv", { timeout: 4000 });
}

/** Previous versions… of `name`, then Cancel: back in the window it came from. */
async function backFrom(page: Page, name: string, item: FileItem): Promise<void> {
  await versionsOf(page, name, item);
  await page.locator("#modal .pv-buttons .btn", { hasText: "Cancel" }).click();
  await page.waitForSelector("#modal .fd-window .fd-row.selected", { timeout: 4000 });
}

const still = (shot: Shot, crop = true): Shot => ({
  wait: 300,
  keepDialogs: true,
  ...(crop ? { crop: "#modal .modal-box" } : {}),
  ...shot,
});

export const PREVIOUS_VERSIONS_SCENES: Scene[] = [
  {
    id: "previous-versions",
    outDir: "features",
    shots: [
      still({
        // A tower's right-click menu in My Towers ends with Previous versions….
        name: "previous-versions-menu",
        setup: async (page) => {
          await page.evaluate(pgMakeVersions);
          await rowMenu(page, "Sky Hotel");
        },
      }),
      still({
        // The window: newest first, the one saved by hand and the autosaved
        // ones, today and yesterday, with the newest picked.
        name: "previous-versions",
        setup: (page) => versionsOf(page, "Sky Hotel"),
      }),
      still({
        // A tower nobody wrote over yet has none, and the window says when
        // the game makes them.
        name: "previous-versions-empty",
        setup: async (page) => {
          await page.evaluate(pgFileWithNone);
          await versionsOf(page, "Harbour Point");
        },
      }),
      still({
        // Cancel goes back to the Open window, Sky Hotel still picked.
        name: "previous-versions-back",
        setup: (page) => backFrom(page, "Sky Hotel", "mb-import"),
      }),
      still({
        // And to the Save As window, from wherever it was opened.
        name: "previous-versions-back-save-as",
        setup: (page) => backFrom(page, "Harbour Point", "mb-export"),
      }),
    ],
  },
  {
    id: "previous-versions-mobile",
    outDir: "features",
    viewport: PHONE,
    shots: [
      still(
        {
          name: "previous-versions-mobile",
          setup: async (page) => {
            await page.evaluate(pgMakeVersions);
            await versionsOf(page, "Sky Hotel");
          },
        },
        false,
      ),
      still(
        {
          // On a phone too: Cancel puts the Open window back.
          name: "previous-versions-back-mobile",
          setup: (page) => backFrom(page, "Sky Hotel", "mb-import"),
        },
        false,
      ),
    ],
  },
];
