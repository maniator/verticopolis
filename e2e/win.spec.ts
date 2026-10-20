import { test, expect, type Page } from "@playwright/test";
import { buildToStar, engineSave, expectEngineHosted, onWasm } from "./helpers";

// On chromium-wasm every test must end with its tower still on the engine.
test.afterEach(async ({ page }) => expectEngineHosted(page));

/**
 * Tier-2 end-to-end smoke: prove the TOWER win actually SURFACES to a real
 * player in the browser — the congratulations modal — which the headless
 * playthrough cannot check (it has no DOM). `buildToStar(6)` reproduces a
 * winning state through the app's public sim API and runs the REAL win logic
 * (`sim.checkVip`, inside a relayed tick); we then assert the game's own update
 * loop opens the modal. On `chromium-wasm` the engine runs that inspection, and
 * the test checks the engine's own save carries the win.
 */
test("winning the TOWER shows the congratulations modal", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game));

  // Dismiss the title screen first, the way a real player does before playing:
  // the update loop deliberately holds back auto-surfaced modals (this congrats
  // included) while the splash is up, so nothing pops over the title screen.
  await page.evaluate(() => document.getElementById("splash")?.remove());

  const star = await page.evaluate(buildToStar, 6);
  expect(star).toBe(6); // the real win logic reached TOWER
  await expectEngineHosted(page);
  const engine = await engineSave(page);
  if (onWasm(test.info().project.name)) expect(engine).toMatchObject({ star: 6, evaluatedTower: true });

  const modal = page.locator("#modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("TOWER achieved");
});

/**
 * A TOWER save taken while an emergency choice was open loads with both the
 * win and the choice due (#1120). The congratulations used to replace the
 * choice's dialog in the same pass, leaving the freeze latch set, so the game
 * never moved again on any Continue of that save. The choice comes first, the
 * congratulations follow the answer, and time runs after both.
 */
test("a TOWER save with an open emergency shows the choice, then the congratulations, and keeps running", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { game?: { saveLoad?: unknown } }).game?.saveLoad));
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).game;
    const Sim = g.sim.constructor;
    const s = Sim.deserialize(JSON.parse(JSON.stringify(g.sim.serialize())));
    s.evaluatedTower = true;
    s.events.pending = { kind: "bombThreat", cost: 300_000, message: "TEST bomb threat: pay the ransom or have Security search the tower." };
    // Lend the staged tower to the one synchronous autosave, then put the live one back.
    const live = g.sim;
    g.sim = s;
    try {
      g.saveLoad.save(true);
    } finally {
      g.sim = live;
    }
  });
  await page.reload();
  await page.waitForFunction(() => {
    const g = (window as unknown as { game?: { sim?: { pendingChoice?: unknown; evaluatedTower?: boolean } } }).game;
    return Boolean(g?.sim?.pendingChoice) && g?.sim?.evaluatedTower === true && Boolean(document.getElementById("splash"));
  });
  await expectEngineHosted(page);
  if (onWasm(test.info().project.name)) {
    expect(await engineSave(page)).toMatchObject({ evaluatedTower: true, events: { pending: { kind: "bombThreat" } } });
  }

  // Continue: the player leaves the title screen with both dialogs due.
  await page.evaluate(() => {
    document.getElementById("splash")?.remove();
    (window as unknown as { game: { speed: number } }).game.speed = 3;
  });
  await expectChoiceThenCongratsThenRunning(page);
});

/**
 * The same save loaded mid-session goes through `adoptSim` instead of the boot
 * path, which resets the win latch but not the freeze latches, so it has its
 * own case.
 */
test("a TOWER save with an open emergency adopted mid-session shows the choice, then the congratulations, and keeps running", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { game?: { saveLoad?: unknown } }).game?.saveLoad));
  await page.evaluate(() => document.getElementById("splash")?.remove());
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).game;
    const s = g.sim.constructor.deserialize(JSON.parse(JSON.stringify(g.sim.serialize())));
    s.evaluatedTower = true;
    s.events.pending = { kind: "bombThreat", cost: 300_000, message: "TEST bomb threat: pay the ransom or have Security search the tower." };
    g.adoptSim(s);
    g.speed = 3;
  });
  await expectChoiceThenCongratsThenRunning(page);
});

/** The choice first with time frozen, the congratulations after the answer, then a moving clock. */
async function expectChoiceThenCongratsThenRunning(page: Page): Promise<void> {
  const modal = page.locator("#modal");
  await expect(modal).toBeVisible();
  const decline = modal.locator('[data-act="decline"]');
  await expect(decline).toBeVisible(); // the choice, with its buttons
  await expect(modal).not.toContainText("TOWER achieved");

  // Time is frozen under the choice.
  const minutes = () => page.evaluate(() => (window as unknown as { game: { sim: { clock: { minutes: number } } } }).game.sim.clock.minutes);
  const frozenAt = await minutes();
  await page.waitForTimeout(600);
  expect(await minutes()).toBe(frozenAt);
  await expect(decline).toBeVisible();

  // Answering lets the congratulations through.
  await decline.click();
  await expect(modal).toContainText("TOWER achieved");
  await modal.locator('[data-act="close"]').click();
  await expect(modal).toBeHidden();

  // And the clock moves again, measured from after both dialogs are gone.
  const afterClose = await minutes();
  await expect.poll(minutes, { timeout: 10_000 }).toBeGreaterThan(afterClose);
}
