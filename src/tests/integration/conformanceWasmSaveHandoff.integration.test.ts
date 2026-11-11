import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../shared/types";
import { parseSaveJson } from "../../storage/saveCompression";
import { canonicalJson } from "../conformance/canonical";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { loadFixture } from "../conformance/fixtureSim";

/**
 * Save integrity across the engines (gate 1, the 3.0 priorities plan's layer 2):
 * a tower one engine has played and saved opens in the other with nothing
 * lost. The crash flow depends on the first direction: after a second Rust
 * trap the game reloads the Rust engine's last autosave on the TypeScript
 * engine (#1422, 6a). The second is the way back, a TypeScript autosave
 * opened by a player who picks the Rust engine.
 *
 * Each case plays a fixture for a day on one engine, saves it, opens that
 * save text the way the web reads it on the other engine, and saves again.
 * The two saves must match as canonical JSON (keys sorted, numbers read as
 * numbers), the criterion `conformanceWasmSaves.integration.test.ts` uses.
 *
 * Skips without the WASM package, like the rest of `npm run test:wasm`.
 */


const FIXTURES = ["towerone_6.vctower", "split-tower.vctower"];
/** One game day, played a minute at a time. */
const DAY_MINUTES = 24 * 60;

const canonical = (save: string): string => canonicalJson(JSON.parse(save));

/** What the TypeScript engine saves after opening `save`. */
function tsResave(save: string): string {
  return JSON.stringify(Simulation.deserialize(parseSaveJson(save) as SerializedGame).serialize());
}

/** What the Rust engine saves after opening `save`. */
function rustResave(save: string): string {
  const engine = wasm().Engine.fromSave(save);
  try {
    return engine.serialize();
  } finally {
    engine.free();
  }
}

describe.runIf(hasWasmPackage())("save handoff: a played tower one engine saved opens in the other unchanged", () => {
  it.each(FIXTURES)("%s: the Rust engine plays a day, and the TypeScript engine opens its save", (name) => {
    const engine = wasm().Engine.fromSave(JSON.stringify(loadFixture(`conformance/fixtures/${name}`).serialize()));
    let saved: string;
    try {
      for (let m = 0; m < DAY_MINUTES; m++) engine.tick(1);
      saved = engine.serialize();
    } finally {
      engine.free();
    }
    const reopened = tsResave(saved);
    expect(JSON.parse(reopened), name).toEqual(JSON.parse(saved));
    expect(canonical(reopened)).toBe(canonical(saved));
  });

  it.each(FIXTURES)("%s: the TypeScript engine plays a day, and the Rust engine opens its save", (name) => {
    const sim = loadFixture(`conformance/fixtures/${name}`);
    for (let m = 0; m < DAY_MINUTES; m++) sim.tick(1);
    const saved = JSON.stringify(sim.serialize());
    const reopened = rustResave(saved);
    expect(JSON.parse(reopened), name).toEqual(JSON.parse(saved));
    expect(canonical(reopened)).toBe(canonical(saved));
  });
});
