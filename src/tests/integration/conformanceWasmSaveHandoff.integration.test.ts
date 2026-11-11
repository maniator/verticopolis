import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../conformance/canonical";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";

/**
 * Save integrity after play (gate 1, the 3.0 priorities plan's layer 2): a
 * tower the engine has played and saved opens again with nothing lost. The
 * crash flow depends on it: after a trap the game reloads the engine's last
 * autosave.
 *
 * Each case plays a fixture for a day, saves it, opens that save text the
 * way the web reads it in a new engine, and saves again. The two saves must
 * match as canonical JSON (keys sorted, numbers read as numbers), the
 * criterion `conformanceWasmSaves.integration.test.ts` uses. When the
 * TypeScript engine was a second engine, this suite handed the save across
 * to it and back; with one engine the check is that its own save reopens
 * unchanged.
 *
 * Skips without the WASM package, like the rest of `npm run test:wasm`.
 */

const FIXTURES = ["towerone_6.vctower", "split-tower.vctower"];
/** One game day, played a minute at a time. */
const DAY_MINUTES = 24 * 60;

const canonical = (save: string): string => canonicalJson(JSON.parse(save));

/** What a new engine saves after opening `save`. */
function resave(save: string): string {
  const engine = wasm().Engine.fromSave(save);
  try {
    return engine.serialize();
  } finally {
    engine.free();
  }
}

describe.runIf(hasWasmPackage())("save handoff: a played tower's save opens again unchanged", () => {
  it.each(FIXTURES)("%s: the engine plays a day, and a new engine opens its save", (name) => {
    const engine = wasm().Engine.fromVctower(readFileSync(resolve(__dirname, "../../../conformance/fixtures", name), "utf8"));
    let saved: string;
    try {
      for (let m = 0; m < DAY_MINUTES; m++) engine.tick(1);
      saved = engine.serialize();
    } finally {
      engine.free();
    }
    const reopened = resave(saved);
    expect(JSON.parse(reopened), name).toEqual(JSON.parse(saved));
    expect(canonical(reopened)).toBe(canonical(saved));
  });
});
