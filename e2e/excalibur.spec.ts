import { test, expect } from "@playwright/test";

/**
 * Boot smoke for the standalone Excalibur engine preview page
 * (`src/excalibur.html` + `src/excalibur-main.ts`). That tooling entry is a real
 * build input (vite.config.ts `rollupOptions.input.excalibur`) and is excluded
 * from unit coverage as "integration-covered by the Playwright e2e tier"; this
 * spec is that integration cover. It exercises the BUILD and BOOT path only:
 * building the demo tower and starting a live TowerEngine, which is reliable in
 * the container. It deliberately does NOT compare rendered pixels: the WebGL
 * raster of this page is the flaky part under the container's software GL (the
 * reason the `excalibur-preview` screenshot scene was dropped), and pixel
 * identity for the engine is already the visual-baseline gate's job.
 */
test("excalibur preview page boots the TowerEngine on a demo tower", async ({ page }) => {
  await page.goto("/excalibur.html");

  // excalibur-main.ts flips window.excaliburReady once engine.start() resolves.
  await page.waitForFunction(() => (window as unknown as { excaliburReady?: boolean }).excaliburReady === true, null, {
    timeout: 30_000,
  });

  const booted = await page.evaluate(() => {
    const w = window as unknown as { engine?: { sim?: { tower?: { units?: unknown[] } } } };
    const canvas = document.getElementById("view") as HTMLCanvasElement | null;
    return {
      hasEngine: Boolean(w.engine),
      units: w.engine?.sim?.tower?.units?.length ?? 0,
      canvasTag: canvas?.tagName ?? null,
    };
  });

  // The live engine is exposed on window, the demo tower was actually built
  // (buildDemo places dozens of rooms), and the render surface exists.
  expect(booted.hasEngine).toBe(true);
  expect(booted.units).toBeGreaterThan(0);
  expect(booted.canvasTag).toBe("CANVAS");
});
