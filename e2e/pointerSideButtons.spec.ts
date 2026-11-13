import { test, expect, type CDPSession, type Page } from "@playwright/test";
import { expectEngineHosted, hideMapBeforeLoad } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The mouse's side buttons on the tower canvas, with trusted input from the
 * browser itself (CDP `Input.dispatchMouseEvent`), so the events reach the
 * canvas exactly as a real mouse's would. Excalibur 0.32 throws on a pointer
 * button it cannot map (forward is button 4), and a chord that ended on the
 * forward button used to leave its pointer held, so a plain mouse move went
 * on panning the camera. The guard (src/render/excalibur/pointerButtonGuard.ts,
 * #2071) swallows those events and releases the pointer. Its unit tests run in
 * happy-dom; this spec puts it in front of the real engine in Chromium.
 *
 * The back button (button 3) is one Excalibur can map, and it still acts as a
 * left click (#2073, deferred). This spec presses it only to check that it
 * throws nothing, and asserts nothing about what it does.
 */

test.afterEach(async ({ page }) => expectEngineHosted(page));

/** The `buttons` bit of each mouse button, as Pointer Events number them. */
const BUTTONS_BIT = { none: 0, left: 1, back: 8, forward: 16 } as const;
type MouseButton = "left" | "back" | "forward";

/** Boot a fresh tower with the title screen gone and the Map out of the way,
 *  and collect every uncaught page error from here on. */
async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await hideMapBeforeLoad(page);
  await page.goto("/");
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#view");
    return Boolean((window as any).game?.engine && canvas && canvas.width > 0);
  });
  await page.evaluate(() => document.getElementById("splash")?.remove());
  return errors;
}

/** Trusted mouse input at one canvas point, sent through the DevTools protocol. */
class Mouse {
  private constructor(
    private readonly cdp: CDPSession,
    readonly x: number,
    readonly y: number,
  ) {}

  static async onCanvas(page: Page): Promise<Mouse> {
    const box = (await page.locator("#view").boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const mouse = new Mouse(cdp, Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
    await mouse.move(mouse.x, mouse.y, BUTTONS_BIT.none);
    return mouse;
  }

  /** Press `button` while the buttons in `held` (a `buttons` mask) are down. */
  press(button: MouseButton, held: number): Promise<unknown> {
    return this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: this.x, y: this.y, button, buttons: held, clickCount: 1 });
  }

  /** Release `button`, leaving the buttons in `held` down. */
  release(button: MouseButton, held: number): Promise<unknown> {
    return this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: this.x, y: this.y, button, buttons: held, clickCount: 1 });
  }

  /** Move to (x, y) in a few steps with the buttons in `held` down. */
  async move(x: number, y: number, held: number): Promise<void> {
    const button = held & BUTTONS_BIT.left ? "left" : "none";
    for (let i = 1; i <= 4; i++) {
      await this.cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: this.x + ((x - this.x) * i) / 4,
        y: this.y + ((y - this.y) * i) / 4,
        button,
        buttons: held,
      });
    }
  }
}

/** Let the frame loop catch up with the input just sent. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function cameraAt(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const pos = (window as any).game.engine.cam.pos;
    return { x: pos.x, y: pos.y };
  });
}

/** Move the mouse with no button held and report whether the camera moved. */
async function hoverPans(page: Page, mouse: Mouse): Promise<boolean> {
  const before = await cameraAt(page);
  await mouse.move(mouse.x - 200, mouse.y + 120, BUTTONS_BIT.none);
  await settle(page);
  const after = await cameraAt(page);
  return before.x !== after.x || before.y !== after.y;
}

test("a plain left drag still pans the camera", async ({ page }) => {
  const errors = await boot(page);
  const mouse = await Mouse.onCanvas(page);
  const before = await cameraAt(page);
  await mouse.press("left", BUTTONS_BIT.left);
  await mouse.move(mouse.x - 200, mouse.y + 120, BUTTONS_BIT.left);
  await mouse.release("left", BUTTONS_BIT.none);
  await settle(page);
  expect(await cameraAt(page)).not.toEqual(before);
  // Released, so the next plain move is a hover.
  expect(await hoverPans(page, mouse)).toBe(false);
  expect(errors).toEqual([]);
});

test("the forward button pressed and released alone throws nothing and holds nothing", async ({ page }) => {
  const errors = await boot(page);
  const mouse = await Mouse.onCanvas(page);
  await mouse.press("forward", BUTTONS_BIT.forward);
  await mouse.release("forward", BUTTONS_BIT.none);
  await settle(page);
  expect(errors).toEqual([]);
  expect(await hoverPans(page, mouse)).toBe(false);
});

test("the back button pressed and released throws nothing", async ({ page }) => {
  // What the back button does is #2073's to fix; this only checks it is safe.
  const errors = await boot(page);
  const mouse = await Mouse.onCanvas(page);
  await mouse.press("back", BUTTONS_BIT.back);
  await mouse.release("back", BUTTONS_BIT.none);
  await settle(page);
  expect(errors).toEqual([]);
});

test("left down, forward down, left up, forward up leaves no press held", async ({ page }) => {
  const errors = await boot(page);
  const mouse = await Mouse.onCanvas(page);
  await mouse.press("left", BUTTONS_BIT.left);
  await mouse.press("forward", BUTTONS_BIT.left | BUTTONS_BIT.forward);
  await mouse.release("left", BUTTONS_BIT.forward);
  // The forward release is the pointer's only pointerup: the one the guard re-sends as a release.
  await mouse.release("forward", BUTTONS_BIT.none);
  await settle(page);
  expect(errors).toEqual([]);
  // A stuck press would turn this plain move into a pan.
  expect(await hoverPans(page, mouse)).toBe(false);
  expect(await page.evaluate(() => (window as any).game.engine.gesture)).toBeNull();
});
