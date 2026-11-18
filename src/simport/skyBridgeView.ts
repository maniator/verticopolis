import type { EnginePort } from "./enginePort";
import type { SkyBridgeView, TowerView } from "./view";

/**
 * The tower view's sky bridges (Modern): the engine's `skyBridgeLooks()`
 * answer, decoded once per tower revision. A restyle moves the revision, so
 * the renderer's structure pass and the Sky Bridge tool's ghost read the
 * current looks without walking the tower per frame or per pointer move.
 */
export function skyBridgeReads(port: Pick<EnginePort, "skyBridgeLooks" | "generation">, revision: () => number): () => readonly SkyBridgeView[] {
  let readAt = NaN;
  let readIn = NaN;
  let bridges: readonly SkyBridgeView[] = [];
  return () => {
    const rev = revision();
    const gen = port.generation();
    // A new engine generation (a load, a new tower) can reuse a revision.
    if (Object.is(rev, readAt) && gen === readIn) return bridges;
    readAt = rev;
    readIn = gen;
    const raw = port.skyBridgeLooks();
    const out: SkyBridgeView[] = [];
    for (let i = 0; i + 3 < raw.length; i += 4) out.push({ floor: raw[i], from: raw[i + 1], to: raw[i + 2], look: raw[i + 3] });
    bridges = out;
    return bridges;
  };
}

/** The bridge holding the tile at (`floor`, `x`), if any. */
export function skyBridgeAt(bridges: readonly SkyBridgeView[], floor: number, x: number): SkyBridgeView | undefined {
  return bridges.find((b) => b.floor === floor && x >= b.from && x < b.to);
}

/** The finished bridge holding the tile at (`floor`, `x`): a sky lobby stands
 *  past each end. A click there changes its look; a click on a half bridge
 *  from an old save finishes it instead. */
export function finishedSkyBridgeAt(tower: Pick<TowerView, "skyBridges" | "structureKindAt">, floor: number, x: number): SkyBridgeView | undefined {
  const b = skyBridgeAt(tower.skyBridges?.() ?? [], floor, x);
  if (!b) return undefined;
  return tower.structureKindAt(floor, b.from - 1) === "lobby" && tower.structureKindAt(floor, b.to) === "lobby" ? b : undefined;
}
