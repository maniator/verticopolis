import type { Page } from "playwright";
import { pageInfo, prepareLiveApp } from "./page";
import type { EngineName } from "./types";

/** Throws unless `engine` is the one the page runs, naming `where`. */
export async function expectEngine(page: Page, engine: EngineName, where: string): Promise<void> {
  const info = await page.evaluate(pageInfo);
  if (info.engineActive !== engine) throw new Error(`${where}: requested the ${engine} engine but ${info.engineActive} is active (host: ${JSON.stringify(info.host)})`);
}

/** Reload the page so the next measurement starts from a page no earlier
 *  scenario ran in (issue #1162), wait for the app, check the engine, and
 *  switch the live app to its measuring state. Every call reloads, the first
 *  after a boot included: a page that skipped it would carry the earlier
 *  scenario's state. */
export async function freshPage(page: Page, engine: EngineName, where: string): Promise<void> {
  await page.reload({ waitUntil: "commit" });
  await page.waitForFunction(() => Boolean((window as unknown as { game?: unknown }).game), undefined, { timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 120_000 });
  await expectEngine(page, engine, where);
  await page.evaluate(prepareLiveApp);
}
