import { describe, expect, it } from "vitest";
import { TsEngine } from "../../engine/port/tsEngine";
import type { EnginePort } from "../../simport/enginePort";
import { VIEW_LAYOUT } from "../../engine/port/layout";
import { telemetryDocument } from "../../wasmhost/telemetry";
import { tower } from "../fixtures/scheduleTower";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * The card verdicts live in the engine (#1420): whether a shaft's average
 * load is near capacity, and whether recycling meets demand. The real WASM
 * binding answers the same as the TypeScript reference, so the frontend only
 * words what it is handed.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but the engine's WASM package was not built");

type RustPort = EnginePort & { free(): void; seedElevatorTelemetry(json: string): void; serialize(): string };

const LOADS = [undefined, 0, 0.5, 0.85, 0.8501, 0.97, 1] as const;
const slot = (name: (typeof VIEW_LAYOUT.records.shaftCard)[number]): number => VIEW_LAYOUT.records.shaftCard.indexOf(name);

describe.skipIf(!hasWasmPackage())("the Rust card verdicts match the TypeScript reference", () => {
  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: a shaft is near capacity only above the cutoff`, () => {
      const f = tower(mode);
      const kinds = [f.standard, f.service, f.express] as const;
      for (const load of LOADS) {
        for (const id of kinds) {
          if (load === undefined) f.sim.elevatorUtil.delete(id);
          else f.sim.elevatorUtil.set(id, load);
        }
        const rust = wasm().Engine.fromSave(JSON.stringify(f.sim.serialize())) as unknown as RustPort;
        try {
          rust.seedElevatorTelemetry(JSON.stringify(telemetryDocument(f.sim)));
          const reference = new TsEngine(f.sim);
          for (const id of kinds) {
            const want = reference.shaftCard(id)[slot("nearCapacity")];
            const got = rust.shaftCard(id)[slot("nearCapacity")];
            expect(got, `${mode} load ${String(load)} / shaft ${id}`).toBe(want);
          }
        } finally {
          rust.free();
        }
      }
    });

    it(`${mode}: recycling demand met agrees`, () => {
      const f = tower(mode);
      const rust = wasm().Engine.fromSave(JSON.stringify(f.sim.serialize())) as unknown as RustPort;
      try {
        expect(rust.recyclingDemandMet()).toBe(new TsEngine(f.sim).recyclingDemandMet());
      } finally {
        rust.free();
      }
    });
  }
});
