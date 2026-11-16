/**
 * The 1994 desk (src/ui/desk/, owner 2026-11-15) and the sunrise startup
 * screen, written into docs/screenshots/features/ for the Help site and the
 * PR review, plus the README's day and night pair (`desk-hero`), written into
 * docs/screenshots/. Every other scene turns the desk off; these keep it on
 * (`desk`).
 * The shots in a scene share one page, so each setup starts from the last
 * one's state and leaves the next a known one. Part of the SCENES manifest
 * (screenshot-scenes.ts). Keep ERASABLE.
 */
import { type Page } from "playwright";
import { PHONE, type Scene, type Shot } from "../screenshot-env.ts";
import { buildCanonTower } from "../screenshot-tower-builders.ts";

/** Close any open menu, so a shot starts from the plain desk. */
async function closeMenus(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.mouse.click(4, 4);
}

/** Click the center of `selector` with the mouse, as a player would. */
async function press(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`desk shot: ${selector} is not on screen`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Drag from the center of `selector` by (dx, dy). */
async function drag(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`desk shot: ${selector} is not on screen`);
  const x = box.x + Math.min(30, box.width / 2);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

/** Park the pointer on the teal desk, off every window. */
const park = (page: Page) => page.mouse.move(1270, 780);

/**
 * Put the startup screen back over the page at a point of its sunrise:
 * 0 is the night it opens on, 1 the dawn it ends on. The cover's markup comes
 * from the served index.html, and the animation is replaced by its state at
 * that point, so the capture (which fast-forwards CSS animations) is stable.
 * Runs in the page.
 */
async function startupAt(at: number): Promise<void> {
  const html = await (await fetch(location.href)).text();
  const cover = new DOMParser().parseFromString(html, "text/html").getElementById("boot-cover");
  if (!cover) throw new Error("startup shot: no #boot-cover in index.html");
  document.getElementById("boot-cover")?.remove();
  document.body.appendChild(document.importNode(cover, true));
  const live = document.getElementById("boot-cover")!;
  const ease = at * at * (3 - 2 * at);
  const set = (sel: string, css: Record<string, string>) => Object.assign(live.querySelector<HTMLElement>(sel)!.style, { animation: "none", ...css });
  set(".boot-night", { opacity: String(0.78 * (1 - ease)) });
  set(".boot-stars", { opacity: String(1 - 0.45 * ease) });
  set(".boot-sun", { transform: `translate(-50%, calc(-50% + ${(34 * (1 - ease)).toFixed(2)}vh))` });
  set(".boot-bar i", { transform: `scaleX(${(0.04 + 0.66 * Math.min(1, at * 1.2)).toFixed(3)})` });
}

/**
 * Frame the README's pair: close the Bulletin (the canon tower is built in its
 * first game minute, so it still holds the founding "Lay a lobby" line), hide
 * the pan and zoom hint, focus the tower window and park the pointer (owner,
 * 2026-11-16).
 */
async function heroFrame(page: Page): Promise<void> {
  if (await page.locator("#bulletin-win").isVisible()) await press(page, '[data-close="bulletin-win"]');
  // Closing a window hands focus to the Map; give it back to the tower.
  await press(page, "#desk-win-tower > .win-title");
  await page.evaluate(() => {
    const hint = document.getElementById("hint");
    if (hint) hint.style.visibility = "hidden";
  });
  await park(page);
}

const startupShots = (suffix: string): Shot[] =>
  ([["night", 0], ["sunrise", 0.5], ["dawn", 1]] as const).map(([name, at]) => ({
    name: `startup-${name}${suffix}`,
    wait: 200,
    setup: (page: Page) => page.evaluate(startupAt, at),
  }));

export const DESK_SCENES: Scene[] = [
  {
    id: "desk",
    outDir: "features",
    desk: true,
    build: buildCanonTower,
    assertUnits: 50,
    shots: [
      // The default layout: Tools, the tower, Info, the Map and the Bulletin.
      { name: "desk-windows", clock: 11, setup: park },
      // The Verticopolis button's menu.
      { name: "desk-start-menu", clock: 11, setup: async (page) => { await closeMenus(page); await press(page, ".desk-start"); } },
      // The desk's Window menu in the tower's menu bar.
      { name: "desk-window-menu", clock: 11, setup: async (page) => { await closeMenus(page); await press(page, "#mb-window"); } },
      // A window's menu, from a right-click on the Map's taskbar button.
      {
        name: "desk-context-menu",
        clock: 11,
        setup: async (page) => {
          await closeMenus(page);
          const b = await page.locator('.desk-task[data-win="map"]').boundingBox();
          if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" });
        },
      },
      // The Control Panel, from the tray's monitor icon.
      { name: "desk-control-panel", clock: 11, setup: async (page) => { await closeMenus(page); await press(page, ".desk-tray-display"); await park(page); } },
      // The Map and the Bulletin minimized to the taskbar.
      {
        name: "desk-minimized",
        clock: 11,
        setup: async (page) => {
          await press(page, "#desk-win-control .desk-btn-close");
          await press(page, "#overview-map .desk-btn-min");
          await press(page, "#bulletin-win .desk-btn-min");
          await park(page);
        },
      },
      // The tower maximized: the small windows float over it, below its menus.
      { name: "desk-maximized", clock: 11, drawSettle: true, setup: async (page) => { await press(page, "#desk-win-tower .desk-btn-max"); await park(page); } },
      // Restored, then moved and made smaller from its size grip, with the
      // Map and the Bulletin back from the taskbar.
      {
        name: "desk-moved-resized",
        clock: 11,
        drawSettle: true,
        setup: async (page) => {
          await press(page, "#desk-win-tower .desk-btn-max");
          await press(page, '.desk-task[data-win="map"]');
          await press(page, '.desk-task[data-win="bulletin"]');
          await drag(page, "#desk-win-tower > .desk-grip", -260, -180);
          await drag(page, "#bulletin-win > .win-title", -560, 60);
          await park(page);
        },
      },
    ],
  },
  {
    // The README's day and night pair: the canon tower on the desk a computer
    // opens to, at the same size and hours as 03-tower-day and 04-tower-night.
    // Its own scene so the desk shots above keep their clock and state.
    id: "desk-hero",
    outDir: "screenshots",
    desk: true,
    build: buildCanonTower,
    assertUnits: 200,
    shots: [
      { name: "03b-desk-day", clock: 11, wait: 1200, setup: heroFrame },
      { name: "04b-desk-night", clock: 22, setup: heroFrame },
    ],
  },
  {
    // The title screen in its Verticopolis window, and the start menu over it.
    id: "desk-title",
    outDir: "features",
    desk: true,
    keepSplash: true,
    shots: [
      { name: "desk-title", wait: 400, setup: park },
      { name: "desk-title-start-menu", wait: 400, setup: (page) => press(page, ".desk-start") },
    ],
  },
  {
    // The startup screen's sunrise on a computer and on a phone.
    id: "startup-sunrise",
    outDir: "features",
    keepSplash: true,
    shots: startupShots(""),
  },
  {
    id: "startup-sunrise-phone",
    outDir: "features",
    viewport: PHONE,
    keepSplash: true,
    shots: startupShots("-phone"),
  },
];
