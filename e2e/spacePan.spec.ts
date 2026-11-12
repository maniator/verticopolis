import { test, expect, type Page } from "@playwright/test";
import { expectEngineHosted, hideMapBeforeLoad } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Space is the world's pan key held through a mouse drag, and also the build
 * key of keyboard play. Held through a drag it must only pan: before the fix
 * a drag with the Lobby tool built lobby pieces either way, from the palette
 * item swallowing Space (the drag painted, no pan) or from the held key's
 * repeats building at the keyboard cursor (focus on the page). Its release
 * also clicked a focused toolbar button.
 */

test.afterEach(async ({ page }) => expectEngineHosted(page));

/** Boot a fresh tower with the title screen gone and the Map out of the way. */
async function boot(page: Page): Promise<void> {
  await hideMapBeforeLoad(page);
  await page.goto("/");
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#view");
    return Boolean((window as any).game?.engine && canvas && canvas.width > 0);
  });
  await page.evaluate(() => document.getElementById("splash")?.remove());
  // Classic builds only while the clock runs (#1936): run it, so a stray
  // build would land and the builds these taps expect do.
  await page.evaluate(() => (window as any).game.setSpeed(1));
}

/** What a stray build would change: the tower's rooms, the keyboard cursor
 *  and the tool; and the camera, which the pan must move. */
async function snapshot(page: Page): Promise<{ units: number; cursor: unknown; tool: unknown; tile: number; floor: number }> {
  return page.evaluate(() => {
    const g = (window as any).game;
    const v = g.engine.viewState();
    return { units: g.sim.tower.units.length, cursor: g.keyboard.cursor(), tool: g.tool, tile: v.tile, floor: v.floor };
  });
}

/** Count the tool picks from here on (a palette item re-picked by Space). */
async function countToolPicks(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const ui = (window as any).game.ui;
    const pick = ui.selectTool.bind(ui);
    (window as any).__toolPicks = 0;
    ui.selectTool = (tool: unknown) => {
      (window as any).__toolPicks++;
      pick(tool);
    };
  });
  return () => page.evaluate(() => (window as any).__toolPicks as number);
}

/** Let the frame loop catch up with the input just sent. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Hold Space, drag across the tower while the key repeats, then let go. */
async function spaceDrag(page: Page): Promise<void> {
  const box = (await page.locator("#view").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.keyboard.down("Space");
  // A held key repeats: Playwright sends each further down as a repeat.
  for (let i = 0; i < 3; i++) await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(x - 100, y + 60, { steps: 4 });
  for (let i = 0; i < 3; i++) await page.keyboard.down("Space");
  await page.mouse.move(x - 200, y + 120, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await settle(page);
}

for (const focus of ["the palette item", "the page"] as const) {
  test(`Space held through a mouse drag pans and builds nothing, with focus on ${focus}`, async ({ page }) => {
    await boot(page);
    // An empty lot: a lobby fits wherever a stray build would land.
    await page.click('.pal-item[data-kind="lobby"]');
    if (focus === "the page") await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const before = await snapshot(page);
    expect(before.units).toBe(0);
    const toolPicks = await countToolPicks(page);
    await spaceDrag(page);
    const after = await snapshot(page);
    expect(after.units, "the drag built nothing").toBe(0);
    expect(after.cursor, "the keyboard cursor stayed hidden").toBeNull();
    expect(after.tool, "the tool stayed picked").toEqual({ type: "build", kind: "lobby" });
    expect(await toolPicks(), "the palette item was not picked again").toBe(0);
    expect(after.tile, "the drag panned the view").not.toBe(before.tile);
    if (focus === "the palette item") {
      // The count is live: a plain Space tap on the item does pick it.
      await page.keyboard.press("Space");
      expect(await toolPicks(), "a Space tap picks the item").toBe(1);
    }
  });
}

test("Space pressed during a mouse drag keeps the drag's tool and does nothing at the keyboard cursor", async ({ page }) => {
  await boot(page);
  await page.click('.pal-item[data-kind="lobby"]');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ArrowUp"); // reveal the cursor
  await page.keyboard.press("ArrowDown"); // back to the ground floor, where a tap would build
  await page.evaluate(() => {
    const kb = (window as any).game.keyboard;
    const commit = kb.commitCursor.bind(kb);
    (window as any).__commits = 0;
    kb.commitCursor = () => {
      (window as any).__commits++;
      return commit();
    };
  });
  const before = await snapshot(page);
  const box = (await page.locator("#view").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.keyboard.down("Space");
  await page.mouse.move(x - 100, y, { steps: 4 });
  await page.keyboard.up("Space");
  await page.mouse.up();
  await settle(page);
  await page.waitForTimeout(300); // a late build at the cursor would land well within this
  const after = await snapshot(page);
  expect(after.tile, "the drag kept its tool and did not pan").toBe(before.tile);
  expect(after.cursor, "the keyboard cursor stayed where it was").toEqual(before.cursor);
  expect(after.tool, "the tool stayed picked").toEqual({ type: "build", kind: "lobby" });
  expect(await page.evaluate(() => (window as any).__commits), "nothing was built at the keyboard cursor").toBe(0);
});

test("the release of a Space-drag does not click a focused toolbar button", async ({ page }) => {
  await boot(page);
  const speed = () => page.locator("button[data-speed].active").getAttribute("data-speed");
  await page.click('button[data-speed="2"]'); // a mouse click leaves the button focused
  await page.keyboard.press("1");
  expect(await speed()).toBe("1");
  await spaceDrag(page);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-speed"));
  expect(focused, "the button kept the focus, so its release was the one at stake").toBe("2");
  expect(await speed(), "the Medium button was not clicked").toBe("1");
  const pressedLook = await page.locator('button[data-speed="2"]').evaluate((el) => el.matches(":active"));
  expect(pressedLook, "the button does not stay drawn pressed").toBe(false);
});

for (const type of ["checkbox", "radio"] as const) {
  test(`the release of a Space-drag does not toggle a focused ${type}`, async ({ page }) => {
    await boot(page);
    // A build tool, so a drag that did not pan would paint lobby pieces.
    await page.click('.pal-item[data-kind="lobby"]');
    // A control outside any dialog, focused the way a click leaves it.
    await page.evaluate((t) => {
      const box = document.createElement("input");
      box.type = t;
      box.id = "space-pan-box";
      document.body.appendChild(box);
      box.focus();
    }, type);
    const before = await snapshot(page);
    await spaceDrag(page);
    const after = await snapshot(page);
    expect(after.units, "the drag built nothing").toBe(0);
    expect(after.tile, "the drag panned the view").not.toBe(before.tile);
    expect(await page.evaluate(() => document.activeElement?.id), "the box kept the focus").toBe("space-pan-box");
    expect(await page.locator("#space-pan-box").isChecked(), `the ${type} kept its state`).toBe(false);
    const pressedLook = await page.locator("#space-pan-box").evaluate((el) => el.matches(":active"));
    expect(pressedLook, `the ${type} does not stay drawn pressed`).toBe(false);
  });
}

for (const control of ["button", "checkbox"] as const) {
  test(`a ${control} that a script focuses while Space is held is not pressed by its repeats or release`, async ({ page }) => {
    await boot(page);
    await page.click('.pal-item[data-kind="lobby"]');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("ArrowUp"); // reveal the cursor
    await page.keyboard.press("ArrowDown"); // back to the ground floor
    await page.evaluate((kind) => {
      const el = kind === "button" ? document.createElement("button") : Object.assign(document.createElement("input"), { type: "checkbox" });
      el.id = "space-focus-control";
      (window as any).__controlClicks = 0;
      el.addEventListener("click", () => (window as any).__controlClicks++);
      document.body.appendChild(el);
    }, control);
    await page.keyboard.down("Space");
    // Focus moves mid-press with no key or pointer press, as when a narrower
    // window closes the Map and the Map gives its button focus.
    await page.evaluate(() => document.getElementById("space-focus-control")!.focus());
    for (let i = 0; i < 3; i++) await page.keyboard.down("Space");
    await page.keyboard.up("Space");
    await settle(page);
    await page.waitForTimeout(300); // a late build would land well within this
    expect(await page.evaluate(() => (window as any).__controlClicks), `the ${control} was not pressed`).toBe(0);
    if (control === "checkbox") expect(await page.locator("#space-focus-control").isChecked(), "the checkbox kept its state").toBe(false);
    // The focus rule returns before the build, and without it blocksGameKey
    // (its focused-control or typing-target rule) would keep the build out.
    // This check fails only if both break.
    expect((await snapshot(page)).units, "the release built nothing").toBe(0);
  });
}

test("a wheel over the world during a Space hold makes it a pan; one over the palette leaves the tap", async ({ page }) => {
  await boot(page);
  await page.click('.pal-item[data-kind="lobby"]');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ArrowUp"); // reveal the cursor
  await page.keyboard.press("ArrowDown"); // back to the ground floor
  const view = (await page.locator("#view").boundingBox())!;
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
  await page.keyboard.down("Space");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Space");
  await settle(page);
  await page.waitForTimeout(300); // a late build would land well within this
  expect((await snapshot(page)).units, "the hold that zoomed the world built nothing").toBe(0);
  const palette = (await page.locator('.pal-item[data-kind="lobby"]').boundingBox())!;
  await page.mouse.move(palette.x + palette.width / 2, palette.y + palette.height / 2);
  await page.keyboard.down("Space");
  await page.mouse.wheel(0, 120);
  await page.keyboard.up("Space");
  await expect.poll(async () => (await snapshot(page)).units, { message: "the tap built" }).toBeGreaterThan(0);
});

test("a Space tap still builds at the keyboard cursor, on its release", async ({ page }) => {
  await boot(page);
  await page.click('.pal-item[data-kind="lobby"]');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ArrowUp"); // reveal the cursor
  await page.keyboard.press("ArrowDown"); // back to the ground floor
  await page.keyboard.down("Space");
  await settle(page);
  expect((await snapshot(page)).units, "nothing is built on the press").toBe(0);
  await page.keyboard.up("Space");
  await expect.poll(async () => (await snapshot(page)).units).toBeGreaterThan(0);
});
