import { describe, expect, it } from "vitest";
import { decodeHeader } from "../../wasmhost/frameView";
import { hasWasmPackage, startWasmHandle, wasmRequired } from "../conformance/wasmEngine";

/**
 * A refused bomb ransom through the shipped engine build, the way the game
 * reads it (#349): `bombSearch()` has to answer straight away, in both
 * modes, with nothing exploded. Until 3.0.1 a refusal settled
 * at once ("found nothing", or an instant blast) and the screen showed
 * nothing; this fails if that comes back.
 */
const run = hasWasmPackage() || wasmRequired();

describe.runIf(run)("a refused bomb ransom through the WASM binding", () => {
  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: starts a search the game can draw, with no outcome yet`, () => {
      const w = startWasmHandle({ fixture: "conformance/fixtures/towerone-star4.vctower", mode });
      try {
        let hours = 0;
        while (!(w.pendingChoice() ?? "").includes("bombThreat")) {
          w.tick(60);
          if (++hours > 2500) throw new Error("no ransom call in 2500 hours");
        }
        const before = decodeHeader(w.frameView());
        expect(w.bombSearch()).toBeUndefined();
        w.resolveChoice(false);
        const after = decodeHeader(w.frameView());
        expect(after.counts.bombs).toBe(before.counts.bombs);
        const view = JSON.parse(w.bombSearch() ?? "null") as { deadline: number; sweeping: { floor: number; left: number; right: number }[] };
        expect(view.deadline).toBeGreaterThan(after.minutes);
        expect(view.sweeping.length).toBeGreaterThan(0);
        expect(view.sweeping.every((g) => g.left < g.right)).toBe(true);
        expect(view).not.toHaveProperty("floor");
      } finally {
        w.free();
      }
    });
  }
});
