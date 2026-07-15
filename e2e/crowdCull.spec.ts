import { test, expect } from "@playwright/test";
import { buildToStar } from "./helpers";

/**
 * CAP-1 wiring (mobile render-perf spec): zooming out past the sub-legible
 * threshold hides the moving layer (people, walkers, elevator cars, vehicles)
 * and skips its per-frame work; zooming back in restores it, and a structural
 * rebuild while culled never flashes fresh actors.
 */
test("zoom cull hides the moving layer, restores it, and survives a rebuild", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).game?.sim && (window as any).game?.ui));
  await page.evaluate(buildToStar, 2); // a tower with floors, walkers, crowd
  await page.evaluate(() => {
    const g = (window as any).game;
    document.getElementById("splash")?.remove();
    // The star-2 fixture carries no transports; add one shaft so the cull has
    // real elevator-car actors to hide and restore.
    if (!g.sim.tower.placeTransport("elevatorStandard", 186, 1, 3).ok) throw new Error("shaft placement failed");
    // The fixture freezes game speed, so no routed people ever spawn; seed a
    // few walkers directly (the render reads only these fields) so the
    // crowd-actor half of the cull is exercised for real, not over an empty
    // map. Speed stays 0, so the sim never touches them.
    for (let i = 0; i < 3; i++) {
      g.sim.crowd.people.push({ id: 9000 + i, seed: i, staff: false, state: "walking", x: 180 + i * 4, fy: 2, wait: 0 });
    }
    g.engine.paused = false;
  });
  // Let one frame pass at a normal zoom so the moving layer exists and shows.
  await page.evaluate(() => (window as any).game.engine.setCamera(190, 2, 1));
  await page.waitForTimeout(300);
  const visibleBefore = await page.evaluate(() => {
    const e = (window as any).game.engine;
    return {
      culled: e.crowdCulled,
      carsShown: e.carActors.filter((c: any) => c.actor.graphics.visible).length,
      walkers: e.walkers.length,
      crowdShown: [...e.crowdActors.values()].filter((r: any) => r.actor.graphics.visible).length,
    };
  });
  expect(visibleBefore.culled).toBe(false);
  expect(visibleBefore.carsShown).toBeGreaterThan(0);
  // Guard the fixture: the hide assertions below are vacuous over empty lists,
  // so prove the walker and routed-people populations are real before culling.
  expect(visibleBefore.walkers).toBeGreaterThan(0);
  expect(visibleBefore.crowdShown).toBeGreaterThan(0);

  // Zoom out past the threshold: the whole moving layer hides within a frame.
  await page.evaluate(() => (window as any).game.engine.setCamera(190, 20, 0.06));
  await page.waitForTimeout(300);
  const culled = await page.evaluate(() => {
    const e = (window as any).game.engine;
    const hidden = (arr: any[]) => arr.every((x: any) => !x.actor.graphics.visible);
    return {
      culled: e.crowdCulled,
      cars: hidden(e.carActors),
      walkers: hidden(e.walkers),
      crowd: [...e.crowdActors.values()].every((r: any) => !r.actor.graphics.visible),
    };
  });
  expect(culled).toEqual({ culled: true, cars: true, walkers: true, crowd: true });

  // A structural change while culled rebuilds the layer hidden (no flash).
  // Tag the current car actors first so the assertion can prove a rebuild
  // actually happened (fresh, untagged actors) and was born hidden; without
  // that the leg would pass vacuously if syncMotion never fired.
  await page.evaluate(() => {
    const g = (window as any).game;
    for (const c of g.engine.carActors) c.preRebuild = true;
    // One floor above the star-2 fixture's roof (its structure tops out at
    // floor 6, so floor 7 is empty and supported); place() bumps
    // tower.revision itself, which is what trips the structural rebuild.
    if (!g.sim.tower.place("floor", 7, 190).ok) throw new Error("floor placement failed");
  });
  await page.waitForTimeout(300);
  const afterRebuild = await page.evaluate(() => {
    const e = (window as any).game.engine;
    return {
      culled: e.crowdCulled,
      rebuilt: e.carActors.length > 0 && e.carActors.every((c: any) => !c.preRebuild),
      anyCarShown: e.carActors.some((c: any) => c.actor.graphics.visible),
      anyWalkerShown: e.walkers.some((w: any) => w.actor.graphics.visible),
    };
  });
  expect(afterRebuild.culled).toBe(true);
  expect(afterRebuild.rebuilt).toBe(true); // syncMotion really recreated the layer
  expect(afterRebuild.anyCarShown).toBe(false);
  expect(afterRebuild.anyWalkerShown).toBe(false);

  // Zoom back in past the re-show threshold: cars return.
  await page.evaluate(() => (window as any).game.engine.setCamera(190, 2, 1));
  await page.waitForTimeout(300);
  const restored = await page.evaluate(() => {
    const e = (window as any).game.engine;
    return {
      culled: e.crowdCulled,
      carsShown: e.carActors.filter((c: any) => c.actor.graphics.visible).length,
      // Re-show leaves the people map to reconcileCrowd (stale-corpse guard),
      // so this proves the live walkers really came back through that path.
      crowdShown: [...e.crowdActors.values()].filter((r: any) => r.actor.graphics.visible).length,
    };
  });
  expect(restored.culled).toBe(false);
  expect(restored.carsShown).toBeGreaterThan(0);
  expect(restored.crowdShown).toBeGreaterThan(0);
});
