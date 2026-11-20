/**
 * The traffic chip's level, read the way a player sees it, for the scenes
 * that shoot the meter (`scenes/features.ts`) and the jump it opens
 * (`scenes/trafficJump.ts`). Keep ERASABLE.
 */
import type { Page } from "playwright";
import { pgStepNoDraw } from "../screenshot-builders.ts";

/** The traffic chip's tier word as drawn after a fresh refresh. */
export async function trafficLabel(page: Page): Promise<string> {
  return page.evaluate(async () => {
    // The chip draws once the port answers.
    await window.game?.refreshTraffic();
    return document.getElementById("traffic-label")?.textContent ?? "";
  });
}

export async function expectTrafficLevel(page: Page, level: string): Promise<void> {
  const label = await trafficLabel(page);
  if (label !== level) throw new Error(`traffic chip reads "${label}", expected "${level}"`);
}

/**
 * Step the clock in chunks of 10 frames, refreshing the chip after each, until
 * it reads `level`; throws after `chunks` chunks. The sim and the step count
 * are deterministic, so the chip reaches the level on the same chunk every
 * run; the wall-clock UI throttle is bypassed by refreshing explicitly. The
 * chunks skip their intermediate draws (pgStepNoDraw): the shots crop the DOM
 * top bar, which the update phase alone drives.
 */
export async function stepTrafficUntil(page: Page, level: string, chunks: number): Promise<void> {
  const seen: string[] = [];
  for (let i = 0; i < chunks; i++) {
    if (!(await page.evaluate(pgStepNoDraw, 10))) throw new Error("traffic chip needs the stepped clock");
    const label = await trafficLabel(page);
    if (seen[seen.length - 1] !== label) seen.push(label);
    if (label === level) return;
  }
  throw new Error(`traffic chip never read "${level}" in ${chunks} chunks (read: ${seen.join(", ")})`);
}
