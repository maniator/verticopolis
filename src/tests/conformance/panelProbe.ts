import type { HeatmapMode } from "../../shared/engineTypes";
import type { WasmEngine } from "../../engineBinding/binding";
import type { EngineStart, ScenarioEngine, Start } from "./scenario";
import { startWasmHandle, wasm, wasmEngine, wasmFxSlots } from "./wasmEngine";

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
  // The start the scenario runner's own engine takes (`startWasmHandle`), so
  // a new game raised to a star starts at that star here too.
  return (start: Start) => probed(startWasmHandle(start));
}
