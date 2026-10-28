import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Tower-swap guard for the gameplay event stream (#873).
 *
 * `GameApp` cannot be built in a unit test (it needs the canvas and the
 * renderer), so the tests of the swap hand-off call
 * `GameplayEventBuffer.inherit` the way `GameApp.adoptSim` does. This guard
 * pins that `adoptSim` really does it, before the swap (after it, the new
 * tower would inherit from itself and the replaced tower's events would be
 * lost), and that the constructor and `adoptSim` stay the only places the
 * app's tower is assigned (through its engine, `enginePort`), so no swap can
 * skip the hand-off.
 */

const src = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const main = readFileSync(resolve(src, "main.ts"), "utf8");

function shellFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...shellFiles(full));
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$|\.d\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("GameApp hands the replaced tower's gameplay events on", () => {
  it("inherits the replaced tower's buffer in adoptSim, before the swap", () => {
    const start = main.indexOf("  adoptSim(sim: Simulation");
    expect(start).toBeGreaterThan(-1);
    const body = main.slice(start, main.indexOf("\n  }\n", start));
    // A plain statement of its own (not commented out, not behind a branch).
    const handOff = body.search(/^ {4}sim\.gameplayEvents\.inherit\(this\.sim\.gameplayEvents\);/m);
    const swap = body.search(/^ {4}this\.enginePort\.take\(sim\);/m);
    expect(handOff).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(handOff);
  });

  it("assigns the app's tower only in the constructor and adoptSim", () => {
    // The app's tower is its engine's (`sim` reads `enginePort.sim`): the
    // constructor builds the engine once, and adoptSim alone hands it a tower.
    expect(main.match(/this\.sim\s*(\?\?|\|\||&&)?=(?!=)/g) ?? []).toEqual([]);
    expect(main.match(/this\.enginePort\s*=(?!=)/g) ?? []).toHaveLength(1);
    // adoptSim, and the setter the tooling scenes use (scripts/), as they
    // assigned the field before. A production build refuses the setter.
    expect(main.match(/\.take\(/g) ?? []).toHaveLength(2);
    expect(main).toMatch(/^ {2}set sim\(sim: Simulation\) \{ if \(!\(import\.meta\.env\.DEV \|\| __TOOLING_BUILD__\)\) throw new Error\([^)]*\); this\.enginePort\.take\(sim\); \}/m);
    // No other module swaps the app's tower behind adoptSim's back.
    const elsewhere = shellFiles(src)
      .filter((file) => file !== resolve(src, "main.ts"))
      .filter((file) => /\bapp\.(sim|enginePort)\s*(\?\?|\|\||&&)?=(?!=)|\benginePort\.take\(/.test(readFileSync(file, "utf8")));
    expect(elsewhere).toEqual([]);
  });
});
