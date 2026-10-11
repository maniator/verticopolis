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
 * app's tower is assigned, so no swap can skip the hand-off.
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
    const swap = body.search(/^ {4}this\.sim = sim;/m);
    expect(handOff).toBeGreaterThan(-1);
    expect(swap).toBeGreaterThan(handOff);
  });

  it("assigns the app's tower only in the constructor and adoptSim", () => {
    const assignments = main.match(/this\.sim\s*(\?\?|\|\||&&)?=(?!=)/g) ?? [];
    expect(assignments).toHaveLength(2);
    // No other module swaps the app's tower behind adoptSim's back.
    const elsewhere = shellFiles(src)
      .filter((file) => file !== resolve(src, "main.ts"))
      .filter((file) => /\bapp\.sim\s*(\?\?|\|\||&&)?=(?!=)/.test(readFileSync(file, "utf8")));
    expect(elsewhere).toEqual([]);
  });
});
