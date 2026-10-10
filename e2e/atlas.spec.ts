import { test, expect } from "@playwright/test";
import { bundleBake } from "../scripts/atlas-bundle.ts";

/**
 * The sprite atlas (issue #909, `scripts/export-atlas.ts`) must reproduce the
 * web game's own bake. For a sample of live room signatures this composes the
 * atlas frame plus its runtime layers the way a frontend reads the manifest
 * (`src/render/atlas/lookup.ts`), paints the same room through the game's own
 * paint functions, and requires the two to match pixel for pixel
 * (`src/render/atlas/verify.ts`, samples in `samples.ts`). Settled rooms are
 * painted at two region offsets; burning, unbuilt and origin-seeded rooms at
 * the per-unit origin. The non-room families are checked the same way
 * (`verifyExtras.ts`), and a control case must report a mismatch. The export
 * runs the same check before it writes an archive.
 */

test.describe("sprite atlas matches the web bake", () => {
  test("composed frames equal the region compositor's paint", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "the comparison is engine-independent, so it runs on one project");
    test.setTimeout(180_000);
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ content: await bundleBake() });
    const results: { mismatches: number; control?: boolean }[] = await page.evaluate(() => (globalThis as any).__vcAtlas.verify());
    // A control compares two different pictures and must report a mismatch.
    const controls = results.filter((r) => r.control);
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((r) => r.mismatches > 0), "the comparison cannot see a difference").toBe(true);
    const bad = results.filter((r) => !r.control && r.mismatches > 0);
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
    expect(results.length).toBeGreaterThan(50);
  });
});
