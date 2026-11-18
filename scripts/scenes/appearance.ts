/**
 * The appearance schemes (Options > Appearance…, owner 2026-11-17), written
 * into docs/screenshots/features/ for the Help site and the PR review: the
 * dialog over the Standard desk, then the canon tower's desk in Skyline and
 * in High Contrast (with the Verticopolis menu and the dialog open in
 * Skyline, and the Tower menu's greyed items and the update prompt's notes in High Contrast), a phone in Skyline, and the phone title screen in both schemes. A scheme scene starts the page with the
 * scheme kept (`initScript`), the way a returning player's page opens.
 * Every scene runs on its own page, so a kept scheme never reaches another
 * scene. Part of the SCENES manifest (screenshot-scenes.ts). Keep ERASABLE.
 */
import { type Page } from "playwright";
import { PHONE, type Scene } from "../screenshot-env.ts";
import { buildCanonTower } from "../screenshot-tower-builders.ts";

/** Park the pointer on the desk, off every window. */
const park = (page: Page) => page.mouse.move(1270, 780);

/** Click the center of `selector` with the mouse, as a player would. */
async function press(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`appearance shot: ${selector} is not on screen`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Frame the desk as the README's pair does: the Bulletin closed and the
 *  tower window in front. */
async function deskFrame(page: Page): Promise<void> {
  if (await page.locator("#bulletin-win").isVisible()) await press(page, '[data-close="bulletin-win"]');
  await press(page, "#desk-win-tower > .win-title");
  await park(page);
}

/** Open the Appearance dialog the way the menu does. */
async function openDialog(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById("mb-appearance")!.click());
  await page.locator(".appearance-samples").waitFor();
  await park(page);
}

/** Show the update prompt with five notes (more than the short list's three),
 *  so the notes sit in the scrolling "What's new" well. Fixed version and sha
 *  keep the shot deterministic. */
async function highContrastUpdateNotes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as any).game;
    g.speed = 0;
    g.engine.paused = true;
    (document.getElementById("modal") as HTMLDialogElement | null)?.close();
    g.ui.showUpdatePrompt(
      () => {},
      () => {},
      {
        version: "1.52.0",
        sha: "a1b2c3d",
        notes: [
          "Shops and restaurants draw different crowds on weekdays and weekends.",
          "Tenants get restless when nearby shops cannot keep up.",
          "A new overlay shows housekeeping coverage across the tower.",
          "Elevator cars wait at the lobby during the morning rush.",
          "Saved towers open faster.",
        ],
      },
    );
  });
  await page.waitForSelector("#modal .modal-box .whatsnew-log li", { timeout: 4000 });
  await park(page);
}

/** Keep a scheme before the page's scripts run, as a returning player would.
 *  Playwright sends an init script to the page as source, so each one names
 *  its scheme as a literal (a closure's variable would not reach the page). */
const keptSkyline = () => localStorage.setItem("vc.appearance", "skyline");
const keptHighContrast = () => localStorage.setItem("vc.appearance", "high_contrast");

export const APPEARANCE_SCENES: Scene[] = [
  {
    id: "appearance",
    outDir: "features",
    desk: true,
    build: buildCanonTower,
    assertUnits: 200,
    shots: [{ name: "appearance-dialog", clock: 11, keepDialogs: true, setup: async (page) => { await deskFrame(page); await openDialog(page); } }],
  },
  {
    id: "appearance-skyline",
    outDir: "features",
    desk: true,
    initScript: keptSkyline,
    build: buildCanonTower,
    assertUnits: 200,
    shots: [
      { name: "appearance-skyline-day", clock: 11, setup: deskFrame },
      { name: "appearance-skyline-night", clock: 22, setup: deskFrame },
      { name: "appearance-skyline-start-menu", clock: 11, setup: async (page) => { await press(page, ".desk-start"); await park(page); } },
      { name: "appearance-skyline-dialog", clock: 11, keepDialogs: true, setup: async (page) => { await page.keyboard.press("Escape"); await openDialog(page); } },
    ],
  },
  {
    id: "appearance-high-contrast",
    outDir: "features",
    desk: true,
    initScript: keptHighContrast,
    build: buildCanonTower,
    assertUnits: 200,
    shots: [
      { name: "appearance-high-contrast-day", clock: 11, setup: deskFrame },
      // The Tower menu with no fire: Call Fire Rescue… greyed out.
      { name: "appearance-high-contrast-tower-menu", clock: 11, setup: async (page) => { await press(page, "#mb-tower"); await park(page); } },
      { name: "appearance-high-contrast-dialog", clock: 11, keepDialogs: true, setup: async (page) => { await page.keyboard.press("Escape"); await openDialog(page); } },
      // The update prompt with more than three notes: its "What's new" log is a
      // well, which High Contrast once drew white text on white.
      { name: "appearance-high-contrast-update-notes", clock: 11, crop: "#modal .modal-box", setup: highContrastUpdateNotes },
    ],
  },
  {
    id: "appearance-skyline-phone",
    outDir: "features",
    viewport: PHONE,
    initScript: keptSkyline,
    build: buildCanonTower,
    assertUnits: 200,
    shots: [{ name: "appearance-skyline-phone", clock: 11 }],
  },
  // The title screen's buttons on a phone, which the schemes restyle too.
  {
    id: "appearance-skyline-phone-title",
    outDir: "features",
    viewport: PHONE,
    keepSplash: true,
    initScript: keptSkyline,
    shots: [{ name: "appearance-skyline-phone-title", wait: 400 }],
  },
  {
    id: "appearance-high-contrast-phone-title",
    outDir: "features",
    viewport: PHONE,
    keepSplash: true,
    initScript: keptHighContrast,
    shots: [{ name: "appearance-high-contrast-phone-title", wait: 400 }],
  },
];
