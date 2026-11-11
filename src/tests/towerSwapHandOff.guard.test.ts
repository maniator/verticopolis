import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Tower-swap guard for the gameplay event stream (#873).
 *
 * Since PR 5e a tower swap happens inside the engine (a load, a new tower, an
 * undo restore through the port), and the app only follows it. This guard
 * pins that `GameApp` assigns its engine once and that no module takes a
 * tower by hand (the tooling-only `adoptToolingSim` reaches the engine as a
 * load of its save), so no swap can skip the engine's own hand-off.
 */

const src = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const main = readFileSync(resolve(src, "main.ts"), "utf8");
const tooling = readFileSync(resolve(src, "game/toolingSim.ts"), "utf8");

function shellFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...shellFiles(full));
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$|\.d\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("a tower swap hands the replaced tower's gameplay events on", () => {
  it("assigns the app's engine once, and takes a tower by hand only in the tooling-only adoptToolingSim", () => {
    expect(main.match(/this\.enginePort\s*=(?!=)/g) ?? []).toHaveLength(1);
    expect(main.match(/\.take\(/g) ?? []).toHaveLength(0);
    // The harnesses' tower reaches the engine as a load of its save, never a take.
    expect(tooling.match(/\.take\(/g) ?? []).toHaveLength(0);
    expect(tooling).toMatch(/^ {2}if \(!\(import\.meta\.env\.DEV \|\| __TOOLING_BUILD__\)\) throw new Error\("adoptSim is for tooling builds only"\);$/m);
    // No other module swaps the app's tower behind the engine's back.
    const elsewhere = shellFiles(src)
      .filter((file) => ![resolve(src, "main.ts"), resolve(src, "game/toolingSim.ts")].includes(file))
      .filter((file) => /\bapp\.(sim|enginePort)\s*(\?\?|\|\||&&)?=(?!=)|\benginePort\.take\(/.test(readFileSync(file, "utf8")));
    expect(elsewhere).toEqual([]);
  });
});
