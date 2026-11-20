/**
 * Tap the overview Map where its tower canvas shows one of `fills` (a view's
 * swatch colors, `#rrggbb`), the way a player taps a red room: a mouse click on
 * a computer, a finger tap on a phone. The pixel is the middle one of all the
 * matches in reading order, so the same tower taps the same room every run.
 */
import type { Page } from "playwright";
import { pgStep } from "../screenshot-builders.ts";

/** Frames stepped first, so the Map has painted the view just chosen. */
const PAINT_FRAMES = 3;

export async function tapMapColor(page: Page, fills: readonly string[], touch = false): Promise<void> {
  await page.evaluate(pgStep, PAINT_FRAMES);
  const at = await page.evaluate((wanted: readonly string[]) => {
    const canvas = document.querySelector<HTMLCanvasElement>("#overview-map .overview-map-tower");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    for (const fill of wanted) {
      const r = parseInt(fill.slice(1, 3), 16);
      const g = parseInt(fill.slice(3, 5), 16);
      const b = parseInt(fill.slice(5, 7), 16);
      const hits: number[] = [];
      for (let i = 0; i < width * height; i++) {
        if (data[i * 4] === r && data[i * 4 + 1] === g && data[i * 4 + 2] === b) hits.push(i);
      }
      if (hits.length === 0) continue;
      const pick = hits[Math.floor(hits.length / 2)];
      const box = canvas.getBoundingClientRect();
      return {
        x: box.left + ((pick % width) + 0.5) * (box.width / width),
        y: box.top + (Math.floor(pick / width) + 0.5) * (box.height / height),
      };
    }
    return null;
  }, fills);
  if (!at) throw new Error(`the Map shows none of ${fills.join(", ")}`);
  if (touch) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
}
