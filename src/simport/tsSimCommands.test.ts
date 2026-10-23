import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INVALID_REQUEST } from "../engine/request";
import type { Simulation } from "../engine/Simulation";
import { MID, newSeededGame } from "../tests/fixtures/towerFixtures";
import { parityRestarts } from "../tests/parity/typescriptOnly";
import { describeCommandContract } from "./commandContract.fixture";
import type { Command } from "./commands";
import type { SimPort } from "./port";
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

/** A port on `sim`, ticked once so the parity project hosts it from the
 *  instance's save (direct setup writes included) before any command. */
function hosted(sim: Simulation): SimPort {
  const port = createTsSim(() => sim);
  port.tick(1);
  return port;
}

describe("TsSim commands the contract cannot reach through the port", () => {
  // Each case ticks once after its last command too, so the Rust host
  // compares; a restart means the engines disagreed.
  let restartsBefore: number | undefined;
  beforeEach(() => {
    restartsBefore = parityRestarts();
  });
  afterEach(() => {
    expect(parityRestarts(), "the engines disagreed on a command, and the parity setup restarted the engine").toBe(restartsBefore);
  });

  it("refuses a malformed command with the engine's own reason, before the instance sees it", async () => {
    expect(INVALID_COMMAND).toBe(INVALID_REQUEST);
    const sim = newSeededGame(7, "modern");
    const port = hosted(sim);
    const build = vi.spyOn(sim, "build");
    const result = await port.command({ op: "build", kind: "office", floor: Number.NaN, x: MID } as Command);
    expect(result).toEqual({ ok: false, reason: INVALID_COMMAND, delta: 0 });
    // Never called, so the mirror host's relay never forwards it.
    expect(build).not.toHaveBeenCalled();
    port.tick(1);
  });

  it("prices a Classic office off the market, and keeps a Classic tower bridging", async () => {
    const sim = newSeededGame(7, "classic");
    const port = hosted(sim);
    expect(await port.command({ op: "build", kind: "office", floor: 2, x: MID - 4 })).toMatchObject({ ok: true });
    const office = sim.tower.unitAt(2, MID - 4)!;
    expect(await port.command({ op: "setNoRate", id: office.id })).toEqual({ ok: true, delta: 0 });
    expect(sim.tower.getUnit(office.id)?.noRate).toBe(true);
    expect(await port.command({ op: "toggleAutoBridge" })).toEqual({ ok: false, value: true, delta: 0 });
    expect(await port.command({ op: "setAutoBridge", value: false })).toEqual({ ok: false, value: true, delta: 0 });
    expect(await port.command({ op: "setAutoBridge", value: true })).toEqual({ ok: true, value: true, delta: 0 });
    expect(sim.autoBridge).toBe(true);
    port.tick(1);
  });

  it("sets a cinema's film policy, and refuses it on an office", async () => {
    const sim = newSeededGame(7, "modern");
    // A cinema needs 3 stars; the first tick hosts the tower with them.
    sim.star = 3;
    sim.money = 10_000_000;
    const port = hosted(sim);
    expect(await port.command({ op: "build", kind: "cinema", floor: 2, x: MID - 20 })).toMatchObject({ ok: true });
    expect(await port.command({ op: "build", kind: "office", floor: 2, x: MID + 11 })).toMatchObject({ ok: true });
    const cinema = sim.tower.units.find((u) => u.kind === "cinema")!;
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    expect(await port.command({ op: "setFilmPolicy", id: cinema.id, policy: "blockbuster" })).toEqual({ ok: true, policy: "blockbuster", delta: 0 });
    expect(sim.tower.getUnit(cinema.id)?.filmPolicy).toBe("blockbuster");
    expect(await port.command({ op: "setFilmPolicy", id: office.id, policy: "auto" })).toEqual({ ok: false, delta: 0 });
    port.tick(1);
  });

  it("answers a stop the engine keeps (an endpoint, an express non-lobby floor) and changes nothing", async () => {
    const sim = newSeededGame(7, "modern");
    sim.star = 3;
    sim.money = 10_000_000;
    const port = hosted(sim);
    const tiles = [MID + 14, MID + 15, MID + 16, MID + 17];
    for (const floor of [2, 3]) expect(await port.command({ op: "paintBrush", kind: "floor", floor, tiles })).toMatchObject({ placed: 4 });
    expect(await port.command({ op: "buildTransport", kind: "elevatorExpress", x: MID + 14, bottom: 1, top: 3 })).toMatchObject({ ok: true });
    const shaft = sim.tower.transports.find((t) => t.kind === "elevatorExpress")!;
    const save = await port.save();
    // Skipping an endpoint is a no-op the engine answers as done.
    expect(await port.command({ op: "setStop", id: shaft.id, floor: 1, stop: false })).toEqual({ ok: true, delta: 0 });
    expect(await port.save()).toBe(save);
    // An express stops only at lobbies: serving floor 2 is refused.
    expect(await port.command({ op: "setStop", id: shaft.id, floor: 2, stop: true })).toMatchObject({ ok: false, delta: 0 });
    expect(await port.save()).toBe(save);
    port.tick(1);
  });
});
