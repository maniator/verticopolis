/**
 * Node-side drivers for the SCENES manifest: the ones that need a filesystem
 * fixture or a hard assertion, so they cannot live as injected page functions.
 * The scene rows in `scenes/*.ts` reference these by identity in their `setup`
 * closures (they run in Node, not the page). Keep ERASABLE.
 */
import { type Page } from "playwright";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "fflate";
import { ROOT } from "./screenshot-env.ts";
import { pgGrowToStar } from "./screenshot-builders.ts";

// Decode the towerone_6 fixture LAZILY (and cache it) so a subset run that skips
// the migration scene (e.g. ONLY=milestones) never has to read/inflate it.
let migrationSaveCache: unknown;
function migrationSave(): unknown {
  if (migrationSaveCache === undefined) {
    const raw = readFileSync(resolve(ROOT, "src/tests/fixtures/towerone_6.vctower"), "utf8");
    const b64 = raw.slice(raw.indexOf("\n") + 1);
    const compressed = new Uint8Array(Buffer.from(b64, "base64"));
    migrationSaveCache = JSON.parse(new TextDecoder().decode(inflateSync(compressed)));
  }
  return migrationSaveCache;
}

/** Load the towerone_6 save at a given stored version (2 = reflow skipped =
 *  "before"; 1 = reflow runs = "after"), then frame either the full tower or a
 *  tight detail on the parking ramp where the canon width change reads loudest. */
export async function loadMigration(page: Page, version: number, mode: "full" | "detail"): Promise<void> {
  await page.evaluate(
    ({ d, version }) => {
      const g = (window as any).game;
      const Sim = g.sim.constructor;
      const clone = JSON.parse(JSON.stringify(d));
      clone.version = version;
      g.adoptSim(Sim.deserialize(clone));
      document.getElementById("splash")?.remove();
      document.querySelector(".modal-backdrop")?.remove();
    },
    { d: migrationSave(), version },
  );
  await page.evaluate((mode) => {
    const g = (window as any).game;
    if (mode === "detail") {
      const ramp = g.sim.tower.units.filter((u: any) => u.kind === "parkingRamp").sort((a: any, b: any) => a.floor - b.floor)[0];
      g.engine.setCamera(ramp ? ramp.x + 8 : 240, ramp ? ramp.floor : -1, 3.6);
    } else {
      g.engine.setCamera(187, Math.max(6, g.sim.tower.highestFloor) / 2, 0.42);
    }
  }, mode);
}

/** Grow deterministically to `target` stars and HARD-ASSERT the tower reached
 *  it: a milestone shot that silently fell short would misrepresent the ladder. */
export async function growToStar(page: Page, target: number): Promise<void> {
  const reached = await page.evaluate(pgGrowToStar, target);
  if (reached < target) throw new Error(`milestone ${target}★ only reached ${reached}★`);
}
