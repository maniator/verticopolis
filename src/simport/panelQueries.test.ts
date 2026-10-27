import { describe, expect, it } from "vitest";
import { newSeededGame } from "../tests/fixtures/towerFixtures";
import { parityRestarts } from "../tests/parity/typescriptOnly";
import { describePanelQueries } from "./panelQueries.fixture";
import { createTsSim } from "./tsSim";

// In the `unitWasm` parity project every Simulation is hosted on the Rust
// engine through the mirror, so this file checks TsSim's panel answers on both
// of today's hosts; `parityRestarts` makes a divergence there fail the suite.
describePanelQueries(
  "TsSim",
  () => {
    const sim = newSeededGame(7, "modern");
    return createTsSim(() => sim);
  },
  { restarts: parityRestarts },
);

describe("TsSim's panel answer bounds", () => {
  it("keeps sixteen cards per kind, the least recently used going first", async () => {
    const sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    // Unknown ids answer null, which is an answer too.
    const card = (id: number) => ({ op: "unitDetail", id }) as const;
    for (let id = 1_000_000; id < 1_000_016; id++) await port.query(card(id));
    await port.query({ op: "transportDetail", id: 1_000_000 });
    // A read counts as use: the first card is now the newest.
    expect(port.cached(card(1_000_000))).toBeNull();
    await port.query(card(1_000_016));
    expect(port.cached(card(1_000_000))).toBeNull();
    expect(port.cached(card(1_000_001))).toBeUndefined();
    // The shaft card is counted on its own.
    expect(port.cached({ op: "transportDetail", id: 1_000_000 })).toBeNull();
  });

  it("keeps one heat map per overlay mode", async () => {
    const sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    const modes = ["congestion", "occupancy", "satisfaction", "cleanliness"] as const;
    for (const mode of modes) await port.query({ op: "floorHeatmap", mode });
    for (const mode of modes) expect(port.cached({ op: "floorHeatmap", mode }), mode).toBeDefined();
  });
});
