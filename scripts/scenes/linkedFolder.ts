/**
 * The folder linked on the player's computer, in the Open and Save As windows
 * (owner, 2026-11-15; `docs/architecture/linked-folder.md`). Every state the
 * help page shows: the Look in menu before and after linking, the folder's
 * list in Save As and Open (no Rename or Delete there), a row's menu, the
 * Allow access note, a browser that can't link (From a folder…), and the same
 * on a phone. Its own shard, `linked-folder`.
 *
 * The browser's folder picker is a native window, so it is stood in for by a
 * folder in the page's private file system (OPFS), which hands out the same
 * kind of handle the game keeps. Its files get a fixed size and a modified
 * time from the page's frozen clock, so the rows are the same on every render.
 * The tower behind the window is the default new one; the shots crop to the
 * window on a desktop.
 */
import type { Page } from "playwright";
import { PHONE, type Scene, type Shot } from "../screenshot-env.ts";

/** Page-context: put the stand-in folder and two My Towers files in place,
 *  and point the folder picker at it. `canLink` false takes the picker away,
 *  as Safari and Firefox have none. */
async function pgStageFolder(canLink: boolean): Promise<void> {
  const w = window as unknown as { game: any; showDirectoryPicker?: unknown };
  await w.game.saveFile("Harbour Point");
  await w.game.saveFile("Sky Hotel");
  const root = await navigator.storage.getDirectory();
  await root
    .removeEntry("Verticopolis Towers", { recursive: true })
    .catch(() => {});
  const folder = await root.getDirectoryHandle("Verticopolis Towers", {
    create: true,
  });
  // Name, size in bytes, and minutes before the frozen clock it was modified.
  const files: [string, number, number][] = [
    ["Riverside Plaza.vctower", 41_472, 5],
    ["Penthouse Plan.vctower", 18_944, 90],
    ["Weekend Build.vctower", 7_168, 2_880],
    ["MYTOWER.TDT", 52_224, 525_600],
  ];
  const age = new Map(files.map(([name, , minutes]) => [name, minutes]));
  for (const [name, size] of files) {
    const out = await (
      await folder.getFileHandle(name, { create: true })
    ).createWritable();
    await out.write(new Uint8Array(size));
    await out.close();
  }
  // The file system stamps real times; the rows read the page's clock instead.
  const proto = FileSystemFileHandle.prototype as unknown as {
    getFile(): Promise<File>;
    __vcReal?: () => Promise<File>;
  };
  proto.__vcReal ??= proto.getFile;
  const real = proto.__vcReal;
  proto.getFile = async function (this: FileSystemFileHandle) {
    const file = await real.call(this);
    return new File([file], file.name, {
      lastModified: Date.now() - (age.get(file.name) ?? 1) * 60_000,
    });
  };
  if (canLink) w.showDirectoryPicker = async () => folder;
  else
    Object.defineProperty(window, "showDirectoryPicker", {
      value: undefined,
      configurable: true,
    });
}

/** Page-context: from here on the browser answers "ask again" for the folder,
 *  as it does after the game is closed and opened again. */
function pgNeedOkAgain(): void {
  const proto = FileSystemHandle.prototype as unknown as {
    queryPermission(): Promise<string>;
  };
  proto.queryPermission = async () => "prompt";
}

async function closeWindow(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { game: any }).game.ui.closeModal?.(),
  );
}

/** Open File > Open… (`open`) or File > Save As… (`saveAs`) from the menu. */
async function openWindow(page: Page, which: "open" | "saveAs"): Promise<void> {
  await closeWindow(page);
  await page.evaluate(
    (id) => document.getElementById(id)?.click(),
    which === "open" ? "mb-import" : "mb-export",
  );
  await page.waitForSelector("#modal .fd", { timeout: 4000 });
}

async function lookMenu(page: Page): Promise<void> {
  // The menu may still be open from the shot before.
  if ((await page.locator("#modal .fd-look-pop").count()) === 0)
    await page.locator("#modal .fd-look").click();
  await page.waitForSelector("#modal .fd-look-pop", { timeout: 2000 });
}

async function linkFolder(page: Page): Promise<void> {
  await lookMenu(page);
  await page.locator("#modal .fd-look-item", { hasText: "Link a" }).click();
  await page.waitForSelector("#modal .fd-row", { timeout: 4000 });
}

/** Shot defaults: a still DOM window, cropped to it on a desktop. */
const still = (shot: Shot, crop = true): Shot => ({
  wait: 300,
  keepDialogs: true,
  ...(crop ? { crop: "#modal .modal-box" } : {}),
  ...shot,
});

export const LINKED_FOLDER_SCENES: Scene[] = [
  {
    id: "linked-folder",
    outDir: "features",
    shots: [
      still({
        // Save As before any folder is linked: the Save in menu offers one.
        name: "linked-folder-save-in-menu",
        setup: async (page) => {
          await page.evaluate(pgStageFolder, true);
          await openWindow(page, "saveAs");
          await lookMenu(page);
        },
      }),
      still({
        // The folder linked: Save As lists its towers and its 1994 file.
        name: "linked-folder-save-as",
        setup: async (page) => {
          await linkFolder(page);
          await page.locator("#modal #fd-name").fill("Riverside Plaza");
        },
      }),
      still({
        // File > Open… starts in the folder last used. A picked row offers
        // Duplicate only: no Rename or Delete on the player's own files.
        name: "linked-folder-open",
        setup: async (page) => {
          await openWindow(page, "open");
          await page
            .locator("#modal .fd-row", { hasText: "Penthouse Plan" })
            .click();
        },
      }),
      still({
        // A row's right-click menu in the folder: Open and Duplicate.
        name: "linked-folder-row-menu",
        setup: async (page) => {
          await openWindow(page, "open");
          await page
            .locator("#modal .fd-row", { hasText: "Riverside Plaza" })
            .click({ button: "right" });
          await page.waitForSelector("#modal .fd-menu", { timeout: 2000 });
        },
      }),
      still({
        // The Look in menu with a folder linked: both places, another
        // folder, and Unlink (its files stay).
        name: "linked-folder-look-in-menu",
        setup: async (page) => {
          await openWindow(page, "open");
          await lookMenu(page);
        },
      }),
      still({
        // After a restart the browser wants the player's OK again first.
        name: "linked-folder-allow",
        setup: async (page) => {
          await page.evaluate(pgNeedOkAgain);
          await openWindow(page, "open");
          await linkFolder(page).catch(() => {});
          await page.waitForSelector("#modal .fd-allow", { timeout: 4000 });
        },
      }),
    ],
  },
  {
    // Safari, Firefox and iOS: no folder can be linked, so the Open window
    // offers From a folder… and the Look in menu says why in gray.
    id: "linked-folder-unsupported",
    outDir: "features",
    shots: [
      still({
        name: "linked-folder-unsupported",
        setup: async (page) => {
          await page.evaluate(pgStageFolder, false);
          await openWindow(page, "open");
          await lookMenu(page);
        },
      }),
    ],
  },
  {
    id: "linked-folder-mobile",
    outDir: "features",
    viewport: PHONE,
    shots: [
      still(
        {
          // On a phone the box says "on this device".
          name: "linked-folder-look-in-mobile",
          setup: async (page) => {
            await page.evaluate(pgStageFolder, true);
            await openWindow(page, "open");
            await lookMenu(page);
          },
        },
        false,
      ),
      still(
        {
          name: "linked-folder-open-mobile",
          setup: async (page) => {
            await linkFolder(page);
            await page
              .locator("#modal .fd-row", { hasText: "Penthouse Plan" })
              .click();
          },
        },
        false,
      ),
      still(
        {
          name: "linked-folder-allow-mobile",
          setup: async (page) => {
            await page.evaluate(pgNeedOkAgain);
            await openWindow(page, "open");
            await linkFolder(page).catch(() => {});
            await page.waitForSelector("#modal .fd-allow", { timeout: 4000 });
          },
        },
        false,
      ),
    ],
  },
];
