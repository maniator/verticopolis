/**
 * Node-side drivers for the SCENES manifest: the ones that need a filesystem
 * fixture or a hard assertion, so they cannot live as injected page functions.
 * The scene rows in `scenes/*.ts` reference these by identity in their `setup`
 * closures (they run in Node, not the page). Keep ERASABLE.
 */
import { type Page } from "playwright";
import { pgGrowToStar } from "./screenshot-builders.ts";

/** Grow deterministically to `target` stars and HARD-ASSERT the tower reached
 *  it: a milestone shot that silently fell short would misrepresent the ladder. */
export async function growToStar(page: Page, target: number): Promise<void> {
  const reached = await page.evaluate(pgGrowToStar, target);
  if (reached < target) throw new Error(`milestone ${target}★ only reached ${reached}★`);
}
