import { describe, expect, it, vi } from "vitest";
import { INVALID_REQUEST } from "../engine/request";
import { MID, newSeededGame } from "../tests/fixtures/towerFixtures";
import { parityRestarts } from "../tests/parity/typescriptOnly";
import { describeCommandContract } from "./commandContract.fixture";
import type { Command } from "./commands";
import { INVALID_COMMAND } from "./request";
import { createTsSim } from "./tsSim";

// In the `unitWasm` parity project every Simulation is hosted on the Rust
// engine through the mirror, so the contract runs TsSim on both of today's
// hosts; `parityRestarts` makes a divergence there fail it.
describeCommandContract(
  "TsSim",
  () => {
    const sim = newSeededGame(7, "modern");
    return createTsSim(() => sim);
  },
  { restarts: parityRestarts },
);

describe("TsSim commands the contract cannot reach through the port", () => {
  it("refuses a malformed command with the engine's own reason, before the instance sees it", async () => {
    expect(INVALID_COMMAND).toBe(INVALID_REQUEST);
    const sim = newSeededGame(7, "modern");
    const build = vi.spyOn(sim, "build");
    const port = createTsSim(() => sim);
    const result = await port.command({ op: "build", kind: "office", floor: Number.NaN, x: MID } as Command);
    expect(result).toEqual({ ok: false, reason: INVALID_COMMAND, delta: 0 });
    // Never called, so the mirror host's relay never forwards it.
    expect(build).not.toHaveBeenCalled();
  });

  it("prices a Classic office off the market, and keeps a Classic tower bridging", async () => {
    const sim = newSeededGame(7, "classic");
    const port = createTsSim(() => sim);
    expect(await port.command({ op: "build", kind: "office", floor: 2, x: MID - 4 })).toMatchObject({ ok: true });
    const office = sim.tower.unitAt(2, MID - 4)!;
    expect(await port.command({ op: "setNoRate", id: office.id })).toEqual({ ok: true, delta: 0 });
    expect(sim.tower.getUnit(office.id)?.noRate).toBe(true);
    expect(await port.command({ op: "toggleAutoBridge" })).toEqual({ ok: false, value: true, delta: 0 });
    expect(await port.command({ op: "setAutoBridge", value: false })).toEqual({ ok: false, value: true, delta: 0 });
    expect(await port.command({ op: "setAutoBridge", value: true })).toEqual({ ok: true, value: true, delta: 0 });
    expect(sim.autoBridge).toBe(true);
  });

  it("sets a cinema's film policy, and refuses it on any other room", async () => {
    const sim = newSeededGame(7, "modern");
    sim.star = 3;
    sim.money = 10_000_000;
    const port = createTsSim(() => sim);
    expect(await port.command({ op: "build", kind: "cinema", floor: 2, x: MID - 15 })).toMatchObject({ ok: true });
    const cinema = sim.tower.units.find((u) => u.kind === "cinema")!;
    expect(await port.command({ op: "setFilmPolicy", id: cinema.id, policy: "blockbuster" })).toEqual({ ok: true, policy: "blockbuster", delta: 0 });
    expect(sim.tower.getUnit(cinema.id)?.filmPolicy).toBe("blockbuster");
    expect(await port.command({ op: "setFilmPolicy", id: -1, policy: "auto" })).toEqual({ ok: false, delta: 0 });
  });
});
