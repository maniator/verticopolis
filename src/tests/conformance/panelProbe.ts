import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HeatmapMode } from "../../shared/engineTypes";
import type { WasmEngine } from "../../engineBinding/binding";
import { REPO_ROOT, type EngineStart, type ScenarioEngine, type Start } from "./scenario";
import { wasm, wasmEngine, wasmFxSlots } from "./wasmEngine";

/**
 * The hook behind the panel-getter checks (facade slice 6b, #1214): a
 * scenario runs on the Rust engine through its binding, and at every
 * checkpoint a probe reads the panel getters off the live handle.
 */

export const HEATMAP_MODES: readonly HeatmapMode[] = ["congestion", "occupancy", "satisfaction", "cleanliness"];

/** The Rust engine with a probe run at every checkpoint. The scenario runner
 *  asks an engine for its `detail` exactly once per checkpoint, which is the
 *  hook. The probe never reads the checkpoint detail, so this answers an
 *  empty record after the probe rather than paying for a full save at every
 *  checkpoint. The fx slots come from the frame header, which is cheap, so
 *  the record keeps its whole shape. */
export function probedWasmStart(onCheckpoint: (h: WasmEngine) => void): EngineStart {
  const probed = (h: WasmEngine): ScenarioEngine => {
    const e = wasmEngine(h);
    return {
      ...e,
      detail: () => {
        onCheckpoint(h);
        return { money: h.money(), log: { seq: 0, count: 0, digest: "" }, save: {}, fx: wasmFxSlots(h) };
      },
      reload: () => {
        const loaded = wasm().Engine.fromSave(h.serialize());
        e.free!();
        return probed(loaded);
      },
    };
  };
  return (start: Start) => {
    const { Engine } = wasm();
    if ("newGame" in start) return probed(Engine.newGame(start.newGame.seed, start.newGame.mode));
    return probed(Engine.fromVctower(readFileSync(resolve(REPO_ROOT, start.fixture), "utf8"), start.mode ?? null));
  };
}
