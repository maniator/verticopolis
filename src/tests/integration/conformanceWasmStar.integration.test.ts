/**
 * A new game that opens at a star starts the same in the TypeScript engine and
 * the Rust engine through the WASM binding (#1085 slice 2c). The binding has no
 * star setter, so its adapter saves the founded game, raises the star and loads
 * it back; the other two runners take the same route. Every star and mode must
 * agree at the start and an hour of play later, or a seeded replay through
 * WASM would report a divergence that is only the start.
 *
 * Skips without the WASM package, like the rest of `npm run test:wasm`.
 */
import { describe, expect, it } from "vitest";
import { runScenario, type Scenario } from "../conformance/scenario";
import { hasWasmPackage, startWasmEngine, wasmRequired } from "../conformance/wasmEngine";

const run = hasWasmPackage() || wasmRequired();

const scenario = (seed: number, mode: "classic" | "modern", star?: number): Scenario => ({
  id: `star-${star ?? "none"}`,
  description: "A new game opened at a star, then an hour of play.",
  start: { newGame: { seed, mode, ...(star === undefined ? {} : { star }) } },
  commands: [{ op: "tick", dt: 1, times: 60, checkpointEvery: 20 }],
});

describe.runIf(run)("a new game opened at a star, TypeScript against Rust", () => {
  for (const mode of ["classic", "modern"] as const) {
    for (const star of [undefined, 1, 2, 3, 4, 5]) {
      it(`${mode}, star ${star ?? "omitted"}: the start and the hour after it agree`, () => {
        for (const seed of [1, 4242]) {
          const s = scenario(seed, mode, star);
          expect(runScenario(s, startWasmEngine), `seed ${seed}`).toEqual(runScenario(s));
        }
      });
    }
  }
});
