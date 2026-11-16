/**
 * File > Open Recent (owner, 2026-11-16): every state the help page shows.
 * The submenu with no recent towers yet, the five numbered lines (towers in
 * My Towers and a file in the linked folder), the title screen's menu, and
 * the submenu opening in place on a phone. Its own shard, `open-recent`.
 * The note shown when a picked tower is gone is a toast, which the runner
 * clears before each shot, so `e2e/openRecent.spec.ts` covers it instead.
 *
 * The My Towers lines are real files the shots save (`game.saveFile`, the
 * Save As path, which puts each on the list). The linked folder's line is
 * seeded the way the game keeps it: the folder's name and link id in
 * localStorage beside the recent list, so the line shows without the
 * browser's folder picker, which is a native window.
 */
import type { Page } from "playwright";
import { PHONE, type Scene, type Shot } from "../screenshot-env.ts";

const RECENT_KEY = "vc.recentTowers";
const FOLDER_MARK = "verticopolis-linked-folder";
const FOLDER_LINK = "verticopolis-linked-folder-link";
const SHOT_LINK = "screenshot-link";

/** Init script: a folder linked on an earlier visit, and the recent list.
 *  `files` are linked folder file names on disk, newest first. */
function seedFolder(files: string[]): () => void {
  const list = JSON.stringify(files.map((id) => ({ place: "folder", id, name: id, kind: "tower", link: SHOT_LINK })));
  // Page-context: no closure, so the values travel inside the source.
  return new Function(
    `try {
      localStorage.setItem(${JSON.stringify(FOLDER_MARK)}, "Verticopolis Towers");
      localStorage.setItem(${JSON.stringify(FOLDER_LINK)}, ${JSON.stringify(SHOT_LINK)});
      if (!localStorage.getItem(${JSON.stringify(RECENT_KEY)})) localStorage.setItem(${JSON.stringify(RECENT_KEY)}, ${JSON.stringify(list)});
    } catch {}`,
  ) as () => void;
}

/** Page-context: save the live tower into My Towers under each name, oldest
 *  first, so the last one tops the list. */
async function pgSaveAll(names: string[]): Promise<void> {
  const g = (window as unknown as { game: { saveFile(name: string): Promise<string> } }).game;
  for (const name of names) await g.saveFile(name);
}

/** Open the File menu and its Open Recent submenu: by pointing on a
 *  computer, by a press on its title on a phone. */
async function openRecentMenu(page: Page, tap = false): Promise<void> {
  await page.keyboard.press("Escape");
  await page.locator("#mb-file").click();
  await page.waitForSelector("#mb-file-menu:not([hidden])", { timeout: 2000 });
  if (tap) await page.locator("#mb-recent").click();
  else await page.locator("#mb-recent").hover();
  await page.waitForSelector("#mb-recent-menu:not([hidden])", { timeout: 2000 });
}

const still = (shot: Shot): Shot => ({ wait: 300, ...shot });

export const OPEN_RECENT_SCENES: Scene[] = [
  {
    id: "open-recent",
    outDir: "features",
    shots: [
      still({
        // Nothing opened or saved yet: one grayed line.
        name: "open-recent-empty",
        setup: (page) => openRecentMenu(page),
      }),
      still({
        // Five towers, newest first, each number underlined as its key: four
        // in My Towers and one in the linked folder, by its name on disk.
        name: "open-recent",
        setup: async (page) => {
          await page.evaluate(() => {
            localStorage.setItem("verticopolis-linked-folder", "Verticopolis Towers");
            localStorage.setItem("verticopolis-linked-folder-link", "screenshot-link");
            localStorage.setItem(
              "vc.recentTowers",
              JSON.stringify([{ place: "folder", id: "Riverside Plaza.vctower", name: "Riverside Plaza.vctower", kind: "tower", link: "screenshot-link" }]),
            );
          });
          await page.evaluate(pgSaveAll, ["Weekend Build", "Harbour Point", "Penthouse Plan", "Sky Hotel"]);
          await openRecentMenu(page);
          await page.locator("#mb-recent-1").hover();
        },
      }),
    ],
  },
  {
    // The opening screen keeps File, so a recent tower opens from there too.
    id: "open-recent-title",
    outDir: "features",
    keepSplash: true,
    initScript: seedFolder(["Riverside Plaza.vctower", "Harbour Point.vctower", "Weekend Build.vctower"]),
    shots: [still({ name: "open-recent-title", setup: (page) => openRecentMenu(page) })],
  },
  {
    // On a phone the submenu opens in place under its title, set in.
    id: "open-recent-mobile",
    outDir: "features",
    viewport: PHONE,
    shots: [
      still({
        name: "open-recent-mobile",
        setup: async (page) => {
          await page.evaluate(pgSaveAll, ["Harbour Point", "Sky Hotel"]);
          await openRecentMenu(page, true);
        },
      }),
    ],
  },
];
