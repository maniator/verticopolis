import { test, expect } from "@playwright/test";
import { buildToStar } from "./helpers";

/**
 * Region composition wiring (CAP-2 of the mobile render-perf spec): settled
 * rooms live in a few dozen region canvases instead of per-unit actors, a
 * burning room moves to a private animated actor with its region footprint
 * unpainted, extinguishing moves it back the same frame, and a full-tower
 * invalidation drains through the per-frame budget instead of repainting
 * everything at once. Pixel identity itself is the CI visual gate's job
 * (the tower-scene baselines); this spec pins the mechanism.
 */
test("regions compose settled rooms, animate fires privately, and drain on budget", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).game?.sim && (window as any).game?.ui));
  await page.evaluate(buildToStar, 2);
  await page.evaluate(() => {
    const g = (window as any).game;
    document.getElementById("splash")?.remove();
    g.engine.paused = false;
  });
  await page.waitForTimeout(300);

  const before = await page.evaluate(() => {
    const g = (window as any).game;
    const e = g.engine;
    const settled = g.sim.tower.units.filter((u: any) => u.kind !== "floor" && u.kind !== "lobby");
    return {
      settled: settled.length,
      regions: e.regions.size,
      membership: e.regionUnits.size,
      animated: e.animatedRooms.size,
      allMembersSettled: settled.every((u: any) => e.regionUnits.has(u.id)),
    };
  });
  // Structural claim of the story: room-layer textures scale with occupied
  // regions (order dozens), not units.
  expect(before.regions).toBeGreaterThan(0);
  expect(before.regions).toBeLessThan(80);
  expect(before.membership).toBe(before.settled);
  expect(before.allMembersSettled).toBe(true);
  expect(before.animated).toBe(0);

  // Ignite an office: it must leave its region THIS sync and stand up a
  // private animated actor (no baked ghost under the flames).
  const fire = await page.evaluate(() => {
    const g = (window as any).game;
    const office = g.sim.tower.units.find((u: any) => u.kind === "office");
    office.state = "fire";
    g.sim.tower.revision++;
    return office.id;
  });
  await page.waitForTimeout(200);
  const burning = await page.evaluate((id: number) => {
    const e = (window as any).game.engine;
    return { animated: e.animatedRooms.has(id), inRegions: e.regionUnits.has(id) };
  }, fire);
  expect(burning).toEqual({ animated: true, inRegions: false });

  // Extinguish: back into the region layer, private actor retired.
  await page.evaluate((id: number) => {
    const g = (window as any).game;
    const office = g.sim.tower.units.find((u: any) => u.id === id);
    office.state = "empty";
    g.sim.tower.revision++;
  }, fire);
  await page.waitForTimeout(200);
  const doused = await page.evaluate((id: number) => {
    const e = (window as any).game.engine;
    return { animated: e.animatedRooms.has(id), inRegions: e.regionUnits.has(id) };
  }, fire);
  expect(doused).toEqual({ animated: false, inRegions: true });

  // A full-tower invalidation (mark every region dirty) drains at most the
  // budget per frame, never all at once (I2). Precondition: buildToStar left
  // sim speed at 0 and nothing above restores it, so no hour flip can add
  // marks mid-observation; the monotone assertion below depends on that.
  const drain = await page.evaluate(
    () =>
      new Promise<{ start: number; steps: number[] }>((resolve) => {
        const e = (window as any).game.engine;
        for (const k of e.regions.keys()) e.regionDirty.add(k);
        const start = e.regionDirty.size;
        const steps: number[] = [];
        const tick = () => {
          steps.push(e.regionDirty.size);
          if (steps.length >= 4) resolve({ start, steps });
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(drain.start).toBeGreaterThan(2);
  // Each observed frame removes at most the budget (2); monotone decrease.
  for (let i = 0; i < drain.steps.length; i++) {
    const prev = i === 0 ? drain.start : drain.steps[i - 1];
    expect(prev - drain.steps[i]).toBeLessThanOrEqual(2);
    expect(drain.steps[i]).toBeLessThanOrEqual(prev);
  }
});
