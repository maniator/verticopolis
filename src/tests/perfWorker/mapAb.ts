import type { BrowserContext, Page } from "playwright";
import { MAP_OPEN_STORAGE_KEY, MAP_OPEN_VALUE } from "../../ui/overviewMapPrefs";
import type { AaMode } from "./aa";
import type { ModeName } from "./pageWorker";

/**
 * `perf:worker --aa wasm --map-ab` (#343, SPEC CAP-6): the paired run of the
 * overview MAP window, open against closed, on one build and one engine. It
 * rides the A/A pass so both slots run the same host; the only difference
 * between them is the stored Map choice, written into the page's storage
 * before any page script runs. Slot "ts" runs with the Map closed and slot
 * "wasm" with it open, so every ratio reads "map open over map closed".
 */
export const MAP_AB_OPEN_SLOT: ModeName = "wasm";

/** The viewport a `--map-ab` pass renders at without `--viewport`: a desktop
 *  size, where the Map opens by default as the desktop window. */
export const MAP_AB_VIEWPORT = { width: 1280, height: 800 } as const;

/** `--map-ab` needs `--aa wasm`: the pass compares two Map states on the
 *  shipped host, and both slots run the same engine. */
export function checkMapAb(mapAb: boolean, aa: AaMode | null): void {
  if (mapAb && aa !== "wasm") throw new Error("--map-ab runs on the A/A pass of the shipped host; pass --aa wasm with it");
}

/** Whether a slot runs with the Map open. */
export const mapOpenInSlot = (slot: ModeName): boolean => slot === MAP_AB_OPEN_SLOT;

/** Store the slot's Map choice in both layout classes, so the Map starts the
 *  same way at any viewport. Does nothing outside a `--map-ab` pass. */
export async function storeMapSlot(ctx: BrowserContext, mapAb: boolean | undefined, slot: ModeName): Promise<void> {
  if (!mapAb) return;
  const value = mapOpenInSlot(slot) ? MAP_OPEN_VALUE.open : MAP_OPEN_VALUE.closed;
  const keys = Object.values(MAP_OPEN_STORAGE_KEY);
  await ctx.addInitScript(
    ({ keys, value }) => {
      try {
        for (const key of keys) localStorage.setItem(key, value);
      } catch {
        // A page without storage keeps the layout default; checkMapSlot fails the repetition.
      }
    },
    { keys, value },
  );
}

/** Fail the repetition unless the page shows the Map the way its slot asks,
 *  so a pass can never compare two closed (or two open) Maps. */
export async function checkMapSlot(page: Page, mapAb: boolean | undefined, slot: ModeName): Promise<void> {
  if (!mapAb) return;
  const want = mapOpenInSlot(slot);
  await page.waitForFunction(() => document.getElementById("overview-map") !== null, undefined, { timeout: 30_000 });
  // Give the stored choice a moment to apply before reading it once.
  await page.waitForFunction((open) => document.getElementById("overview-map")?.hidden === !open, want, { timeout: 5_000 }).catch(() => undefined);
  const open = await page.evaluate(() => {
    const map = document.getElementById("overview-map");
    return map !== null && !map.hidden;
  });
  if (open !== want) throw new Error(`slot ${slot} should run with the Map ${want ? "open" : "closed"}, but the page shows it ${open ? "open" : "closed"}`);
}

/** The report banner that leads a `--map-ab` folder, in place of the A/A one. */
export const mapAbBanner =
  '> **Map A/B pass.** Slot "ts" ran with the overview Map closed and slot "wasm" with it open, both on the WASM main-thread host, so every ratio is map open over map closed (or the reverse where a column says so). It is not an A/A input for the M4 long-task tolerance.';

/** The limitation a `--map-ab` folder lists after the A/A one. */
export const MAP_AB_LIMITATION =
  'A Map A/B pass: the two slots differ only in the stored overview Map choice (closed in slot "ts", open in slot "wasm"), which the run checks after the cold start and after the throttled cold start. The pass renders at 1280x800 unless `--viewport` says otherwise, so the open Map is the desktop window players get by default; a phone-sized viewport measures the phone card instead. The frame window\'s commands rename the tower, so the rooms do not change on a command and the Map repaints only for the simulation\'s own changes; the cost of a Map rebuild and repaint is measured by e2e/overviewMapPerf.spec.ts.';

/** An explicit `--out` folder for a `--map-ab` pass names it (`map-ab`), and
 *  any other pass's folder must not, so a Map A/B folder is never read as an
 *  A/A input or a comparison. */
export function checkMapAbFolder(name: string, mapAb: boolean): void {
  const named = /(^|[-_.])map-ab([-_.]|$)/i.test(name);
  if (mapAb && !named) throw new Error(`--map-ab needs an --out folder name containing map-ab, so the folder cannot be mistaken for an A/A pass`);
  if (!mapAb && named) throw new Error(`--out ${name} names a Map A/B folder, but this run is not one; pass --map-ab or pick another name`);
}
