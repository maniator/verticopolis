import type { Page } from "playwright";
import { clearSelection, dialogOpen, hasSelection, officeCount, officeSpots } from "./pageRecorder";

/**
 * The scripted interactions of the interaction benchmark, one per phase. Each
 * drives the page like a player with a mouse and keyboard for a fixed time
 * while the tower runs, paced against the wall clock (a pointer move about
 * every 16 ms, a wheel notch every 250 ms, a click every 500 ms), so both arms
 * get about the same input. A pace the page cannot keep is not made up with
 * a burst; the step just runs late. Each phase counts what it did and what
 * took effect (dialogs opened, offices placed, rooms selected), so a script
 * that silently did nothing shows in the report. Coordinates scale with the
 * viewport.
 */

export const PHASES = ["idle", "pan", "zoom", "panels", "build", "inspect"] as const;
export type PhaseName = (typeof PHASES)[number];

export interface Viewport {
  width: number;
  height: number;
}

/** What a phase did: inputs sent, and the ones that took effect where that
 *  can be told (offices placed; dialogs opened). */
export interface PhaseActions {
  actions: number;
  effective: number | null;
}

const pause = (page: Page, ms: number): Promise<void> => page.waitForTimeout(ms);

/** A wall-clock pace: each `tick` waits until the next step is due. A step
 *  that comes due while the last one ran late starts at once, and the pace
 *  restarts from there rather than firing the missed steps in a burst. */
function pacer(page: Page, everyMs: number): () => Promise<void> {
  let due = Date.now();
  return async () => {
    due += everyMs;
    const wait = due - Date.now();
    if (wait > 0) await pause(page, wait);
    else due = Date.now();
  };
}

/** Points spread over the middle of the view, the same sequence on every run. */
function spot(vp: Viewport, i: number): { x: number; y: number } {
  return { x: vp.width * (0.25 + ((i * 37) % 50) / 100), y: vp.height * (0.3 + ((i * 53) % 40) / 100) };
}

/** Whether `selector`'s center sits past the right edge of the window: on a
 *  narrow window the side panel slides off screen. */
async function offScreen(page: Page, selector: string): Promise<boolean> {
  const box = await (await page.$(selector))?.boundingBox();
  const vp = page.viewportSize();
  return Boolean(box && vp && box.x + box.width / 2 > vp.width);
}

/** Click the side panel's toggle, when the layout shows one. */
async function togglePanel(page: Page): Promise<void> {
  const toggle = await page.$("#panel-toggle");
  if (toggle && (await toggle.isVisible())) await toggle.click({ timeout: 2000, force: true }).catch(() => {});
  await pause(page, 300);
}

async function clickIfVisible(page: Page, selector: string, timeout = 2000): Promise<boolean> {
  const el = await page.$(selector);
  if (!el || !(await el.isVisible())) return false;
  // The side panel scrolls, so its lower buttons can sit below the fold, as a
  // player would scroll to them. Visibility is checked above; `force` skips
  // Playwright's wait for the element to hold still across frames, which a
  // slow page may not meet in time.
  await el.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
  // A player opens an off-screen side panel first.
  if (await offScreen(page, selector)) await togglePanel(page);
  return el.click({ timeout, force: true }).then(
    () => true,
    () => false,
  );
}

/** Pick a palette tool the way a player does: open its group's tab first
 *  when the palette shows one group at a time (the phone layout). */
async function pickTool(page: Page, selector: string): Promise<void> {
  const group = await page.$eval(selector, (el) => el.getAttribute("data-group") ?? el.closest(".pal-group")?.getAttribute("data-group") ?? null);
  if (group) await clickIfVisible(page, `.pal-tab[data-group="${group}"]`);
  await page.click(selector, { timeout: 5000 });
}

/** Drag the view with the middle button, across and back, a move every 16 ms. */
async function pan(page: Page, vp: Viewport, end: number): Promise<PhaseActions> {
  const cx = vp.width / 2;
  const cy = vp.height * 0.55;
  const dx = vp.width * 0.01;
  const dy = vp.height * 0.008;
  const tick = pacer(page, 16);
  let actions = 0;
  while (Date.now() < end) {
    for (const dir of [1, -1]) {
      const x0 = dir === 1 ? cx : cx + 20 * dx;
      const y0 = dir === 1 ? cy : cy + 20 * dy;
      await page.mouse.move(x0, y0);
      await page.mouse.down({ button: "middle" });
      for (let i = 1; i <= 20 && Date.now() < end; i++) {
        await page.mouse.move(x0 + dir * i * dx, y0 + dir * i * dy);
        actions++;
        await tick();
      }
      await page.mouse.up({ button: "middle" });
    }
  }
  return { actions, effective: null };
}

/** Wheel in five notches, then out five, one notch every 250 ms, ending on a
 *  whole cycle so the next phase starts at the zoom this one started at. */
async function zoom(page: Page, vp: Viewport, end: number): Promise<PhaseActions> {
  await page.mouse.move(vp.width / 2, vp.height * 0.55);
  const tick = pacer(page, 250);
  let k = 0;
  for (; Date.now() < end || k % 10 !== 0; k++) {
    await page.mouse.wheel(0, k % 10 < 5 ? -120 : 120);
    await tick();
  }
  return { actions: k, effective: null };
}

/** Open and close the Statistics, Saves and Settings dialogs, one a second.
 *  A dialog counts as opened only when one is open after the click. */
async function panels(page: Page, end: number): Promise<PhaseActions> {
  const dialogs = ["#btn-stats", "#btn-load", "#btn-settings"];
  const tick = pacer(page, 500);
  let opened = 0;
  let i = 0;
  for (; Date.now() < end; i++) {
    await clickIfVisible(page, dialogs[i % dialogs.length]);
    await tick();
    if (await page.evaluate(dialogOpen)) {
      opened++;
      await page.keyboard.press("Escape");
    }
    await tick();
  }
  return { actions: i, effective: opened };
}

/** What a phase needs done before its window opens, so it is not in the
 *  phase's numbers: for the panels phase, the side panel opened on a narrow
 *  window; for the build phase, the screen points where an office places
 *  (none found falls back to points across the view, and the report's placed
 *  count shows it). */
export async function preparePhase(page: Page, name: PhaseName): Promise<{ x: number; y: number }[]> {
  if (name === "panels" && (await offScreen(page, "#btn-stats"))) await togglePanel(page);
  if (name !== "build") return [];
  return page.evaluate(officeSpots, { max: 40 });
}

/** Undo what `preparePhase` changed in the layout once the window closed: a
 *  side panel left open over a narrow window would hide the palette the build
 *  phase needs. The toggle shows only on a narrow window, so a docked panel is
 *  left alone. */
export async function finishPhase(page: Page, name: PhaseName): Promise<void> {
  if (name !== "panels") return;
  const toggle = await page.$("#panel-toggle");
  if (toggle && (await toggle.isVisible()) && !(await offScreen(page, "#btn-stats"))) await togglePanel(page);
}

/** Place an office and undo it, once a second, cycling through `spots`.
 *  A placement counts when the tower gained an office; only those are undone. */
async function build(page: Page, vp: Viewport, end: number, spots: readonly { x: number; y: number }[]): Promise<PhaseActions> {
  await pickTool(page, '.pal-item[data-kind="office"]');
  const tick = pacer(page, 500);
  let placed = 0;
  let i = 0;
  for (; Date.now() < end; i++) {
    const p = spots.length ? spots[i % spots.length] : spot(vp, i);
    for (let s = 5; s >= 0; s--) await page.mouse.move(p.x - s * 8, p.y);
    const before = await page.evaluate(officeCount);
    await page.mouse.click(p.x, p.y);
    await tick();
    if ((await page.evaluate(officeCount)) > before) {
      placed++;
      await page.keyboard.press("Control+z");
    }
    await tick();
  }
  await page.keyboard.press("Escape");
  return { actions: i, effective: placed };
}

/** Click rooms with the inspect tool, one every 500 ms. The selection is
 *  dropped before each click, so a click counts as taking effect only when it
 *  selected a room itself (a click on the last room's editor card does not). */
async function inspect(page: Page, vp: Viewport, end: number): Promise<PhaseActions> {
  await pickTool(page, '.pal-item[data-tool="inspect"]');
  const tick = pacer(page, 500);
  let selected = 0;
  let i = 0;
  for (; Date.now() < end; i++) {
    const p = spot(vp, i);
    await page.evaluate(clearSelection);
    await page.mouse.click(p.x, p.y);
    await tick();
    if (await page.evaluate(hasSelection)) selected++;
  }
  await page.keyboard.press("Escape");
  return { actions: i, effective: selected };
}

/** Run one phase's interaction for `ms` milliseconds. */
export async function runPhase(page: Page, name: PhaseName, vp: Viewport, ms: number, spots: readonly { x: number; y: number }[] = []): Promise<PhaseActions> {
  const end = Date.now() + ms;
  switch (name) {
    case "idle":
      await pause(page, ms);
      return { actions: 0, effective: null };
    case "pan":
      return pan(page, vp, end);
    case "zoom":
      return zoom(page, vp, end);
    case "panels":
      return panels(page, end);
    case "build":
      return build(page, vp, end, spots);
    case "inspect":
      return inspect(page, vp, end);
  }
}
