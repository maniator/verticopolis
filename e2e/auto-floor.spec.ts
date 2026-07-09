import { test, expect } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * End-to-end coverage for the auto-floor bridge (backlog `auto-floor-build` (2)):
 * placing a module through the REAL build controller (`game.build`, the same
 * BuildActions a click routes through) in the BUILT app fills the floor gap to
 * its neighbor, charges for the bridge tiles, and refuses an unaffordable run.
 * This proves the feature survives bundling and the main.ts <-> engine <-> sim
 * wiring, not just the headless vitest fixture. It complements the exhaustive
 * unit coverage in src/tests/simulation.test.ts.
 */
test.describe("auto-floor bridge between modules (e2e)", () => {
  test("bridges the gap between two rooms through the real build path, error-free", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto("/");
    await page.waitForFunction(() => {
      const g = (window as any).game;
      const canvas = document.querySelector<HTMLCanvasElement>("#view");
      return Boolean(g?.sim && g.engine && g.build && canvas && canvas.width > 0 && canvas.height > 0);
    });
    await page.evaluate(() => document.getElementById("splash")?.remove());

    const result = await page.evaluate(() => {
      const g = (window as any).game;
      const s = g.sim;
      const t = s.tower;
      g.speed = 0; // freeze time so the crowd sim can't churn the setup
      s.money = 10_000_000;
      const x0 = Math.floor(g.grid.width / 2) - 20; // over the starter ground lobby
      // Drive the real build controller (what a click calls), quietly to keep the
      // no-error assertion clean, not sim.build directly.
      g.build.tryBuild("office", 2, x0, true); // A: [x0, x0+9)
      const gapBare = t.structureKindAt(2, x0 + 11); // still empty before B
      // Read the quoted cost from the sim itself, not a hard-coded catalog value,
      // so a future balance tweak doesn't rot this test.
      const quotedForB = s.canBuild("office", 2, x0 + 15).cost;
      const moneyBeforeB = s.money;
      g.build.tryBuild("office", 2, x0 + 15, true); // B: [x0+15, x0+24)
      const gap: (string | undefined)[] = [];
      for (let i = 9; i < 15; i++) gap.push(t.structureKindAt(2, x0 + i));
      return {
        gapBare,
        gap,
        bKind: t.unitAt(2, x0 + 15)?.kind,
        chargedForB: moneyBeforeB - s.money,
        quotedForB,
        beyond: t.structureKindAt(2, x0 + 30), // outside the gap, untouched
      };
    });

    expect(result.gapBare).toBeUndefined();
    expect(result.bKind).toBe("office");
    // The whole six-tile gap between A and B is now plain floor.
    expect(result.gap).toEqual(["floor", "floor", "floor", "floor", "floor", "floor"]);
    // The build path charges exactly what the sim quoted (office + own floors + bridge).
    expect(result.chargedForB).toBe(result.quotedForB);
    expect(result.beyond).toBeUndefined();

    // Let the engine render the bridged floors for a few frames; a render throw
    // would surface as a console error here.
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test("refuses a module when it plus its bridge floor is unaffordable", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => {
      const g = (window as any).game;
      return Boolean(g?.sim && g.build);
    });
    await page.evaluate(() => document.getElementById("splash")?.remove());

    const out = await page.evaluate(() => {
      const g = (window as any).game;
      const s = g.sim;
      const t = s.tower;
      g.speed = 0;
      s.money = 10_000_000;
      const x0 = Math.floor(g.grid.width / 2) - 20;
      g.build.tryBuild("office", 2, x0, true); // neighbor A
      const cost = s.canBuild("office", 2, x0 + 15).cost; // office + own floors + bridge
      s.money = cost - 1; // one dollar short of the whole run
      g.build.tryBuild("office", 2, x0 + 15, true);
      return {
        placed: Boolean(t.unitAt(2, x0 + 15)),
        gapFilled: t.structureKindAt(2, x0 + 11) !== undefined,
        money: s.money,
        expectedMoney: cost - 1,
      };
    });

    expect(out.placed).toBe(false); // refused as a whole
    expect(out.gapFilled).toBe(false); // no bridge floor laid
    expect(out.money).toBe(out.expectedMoney); // nothing charged
  });

  test("bridges a detached ground concourse lobby with lobby tiles, not floor", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => {
      const g = (window as any).game;
      return Boolean(g?.sim && g.build);
    });
    await page.evaluate(() => document.getElementById("splash")?.remove());

    const out = await page.evaluate(() => {
      const g = (window as any).game;
      const s = g.sim;
      const t = s.tower;
      g.speed = 0;
      s.money = 10_000_000;
      const x0 = Math.floor(g.grid.width / 2) - 20; // starter concourse [x0, x0+40)
      // Drop a lobby past the concourse edge with a gap; the bridge is what lets a
      // ground tile that would otherwise float land connected.
      g.build.tryBuild("lobby", 1, x0 + 45, true);
      const kinds: (string | undefined)[] = [];
      for (let i = 40; i <= 45; i++) kinds.push(t.structureKindAt(1, x0 + i));
      return { kinds };
    });

    // The gap and the dropped tile are all lobby (matching substrate), no floor.
    expect(out.kinds).toEqual(["lobby", "lobby", "lobby", "lobby", "lobby", "lobby"]);
  });
});

test.describe("sky-lobby canon (e2e)", () => {
  test("claims floor 15 with a lobby, then refuses a plain floor tile there", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => {
      const g = (window as any).game;
      return Boolean(g?.sim && g.build);
    });
    await page.evaluate(() => document.getElementById("splash")?.remove());

    const out = await page.evaluate(() => {
      const g = (window as any).game;
      const s = g.sim;
      const t = s.tower;
      g.speed = 0;
      s.money = 1e10;
      const x0 = Math.floor(g.grid.width / 2) - 20;
      // Build a support column up through floor 14 so floor 15 has support below.
      for (let f = 2; f <= 14; f++) for (let i = 0; i < 40; i++) t.place("floor", f, x0 + i);
      // Claim floor 15 by placing a lobby there (goes through the real gesture).
      g.build.tryBuild("lobby", 15, x0 + 20, true);
      const claimed = t.floorHasLobby(15);
      // Now try to drop a plain floor tile elsewhere on floor 15.
      g.build.tryBuild("floor", 15, x0 + 5, true);
      const kindAfterFloorAttempt = t.structureKindAt(15, x0 + 5);
      return { claimed, kindAtLobby: t.structureKindAt(15, x0 + 20), kindAfterFloorAttempt };
    });

    expect(out.claimed).toBe(true);
    expect(out.kindAtLobby).toBe("lobby");
    // The refused tryBuild left the cell empty, which is exactly the rule
    // firing: the floor-15 sky-lobby-claimed check refuses new plain floor
    // tiles anywhere on the story.
    expect(out.kindAfterFloorAttempt).toBeUndefined();
  });

  test("refuses to bulldoze a lobby tile through the real build controller", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => {
      const g = (window as any).game;
      return Boolean(g?.sim && g.build);
    });
    await page.evaluate(() => document.getElementById("splash")?.remove());

    const out = await page.evaluate(() => {
      const g = (window as any).game;
      const s = g.sim;
      const t = s.tower;
      g.speed = 0;
      const x0 = Math.floor(g.grid.width / 2) - 20;
      // The starter ground lobby has a lobby at (1, x0).
      const lobby = t.unitAt(1, x0);
      const kindBefore = lobby?.kind;
      const removed = g.build.tryRemoveUnit(lobby, "bulldoze");
      const kindAfter = t.unitAt(1, x0)?.kind;
      return { kindBefore, removed, kindAfter };
    });

    expect(out.kindBefore).toBe("lobby");
    expect(out.removed).toBe(false);
    expect(out.kindAfter).toBe("lobby");
  });

  test("gates the preview-reason hover surface by mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => {
      const g = (window as any).game;
      return Boolean(g?.sim && g.build);
    });
    await page.evaluate(() => document.getElementById("splash")?.remove());

    // Default new tower is Classic, so showsPreviewReason should be false.
    const classic = await page.evaluate(() => (window as any).game.sim.rules.showsPreviewReason);
    expect(classic).toBe(false);
  });
});
