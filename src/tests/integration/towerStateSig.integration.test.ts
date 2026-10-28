import { describe, it, expect } from "vitest";
import { newSeededGame } from "../fixtures/towerFixtures";
import { towerStateSig } from "../../engine/UndoHistory";
import { GRID } from "../../engine/facilities";

// What the undo history fingerprints: a gesture that changes only one of
// these must still leave an undo step (split out of
// undoHistory.integration.test.ts for the file-size ceiling).
describe("towerStateSig", () => {
  it("includes money but not the clock", () => {
    const sim = newSeededGame(1);
    const FIXED = 500_000; // hold money constant so we isolate the clock's effect
    const sig0 = towerStateSig(sim.tower, FIXED);
    const units0 = sim.tower.units.length;

    sim.tick(30); // advance only the clock
    expect(sim.tower.units.length).toBe(units0); // structure unchanged
    expect(towerStateSig(sim.tower, FIXED)).toBe(sig0); // clock is not in the sig

    expect(towerStateSig(sim.tower, FIXED + 1)).not.toBe(sig0); // money is
  });

  it("changes when structure is added", () => {
    const sim = newSeededGame(1);
    const cx = Math.floor(GRID.width / 2);
    const sig0 = towerStateSig(sim.tower, sim.money);
    expect(sim.tower.place("floor", 2, cx).ok).toBe(true); // supported by the starter lobby
    expect(towerStateSig(sim.tower, sim.money)).not.toBe(sig0);
  });

  it("changes when a unit is renamed", () => {
    const sim = newSeededGame(1);
    const cx = Math.floor(GRID.width / 2);
    for (let x = cx - 10; x <= cx + 10; x++) sim.tower.place("floor", 2, x);
    expect(sim.build("office", 2, cx).ok).toBe(true);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    const sig0 = towerStateSig(sim.tower, sim.money);
    office.label = "Penthouse";
    expect(towerStateSig(sim.tower, sim.money)).not.toBe(sig0);
  });

  it("changes when a unit's No Rate flag flips (taking it off the market is undoable)", () => {
    // An Average unit keeps rent undefined, so the No Rate toggle can be the
    // ONLY mutation of a gesture; without noRate in the signature, commitUndo
    // would drop that edit as a no-op and Ctrl+Z could not restore the market
    // state. Pin it, like the subtype reroll below.
    const sim = newSeededGame(1, "classic");
    const cx = Math.floor(GRID.width / 2);
    for (let x = cx - 10; x <= cx + 10; x++) sim.tower.place("floor", 2, x);
    expect(sim.build("office", 2, cx).ok).toBe(true);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    expect(office.rent).toBeUndefined(); // precondition: Average, no stored override
    const sig0 = towerStateSig(sim.tower, sim.money);
    office.noRate = true;
    expect(towerStateSig(sim.tower, sim.money)).not.toBe(sig0);
  });

  it("changes when a shaft's schedule is set (the Schedule dialog's OK is undoable)", () => {
    // Setting the schedule can be the ONLY mutation of a gesture (the dialog's
    // apply writes nothing else), so a signature blind to it would drop the
    // "Set elevator schedule" undo step as a no-op. Pin it, like noRate above.
    const sim = newSeededGame(1);
    sim.money = 1e12;
    const cx = Math.floor(GRID.width / 2);
    for (let x = cx - 10; x <= cx + 10; x++) sim.tower.place("floor", 2, x);
    expect(sim.buildTransport("elevatorStandard", cx, 1, 2).ok).toBe(true);
    const shaft = sim.tower.transports.find((t) => t.kind === "elevatorStandard")!;
    const sig0 = towerStateSig(sim.tower, sim.money);
    expect(sim.tower.setSchedule(shaft.id, { waitingCarResponse: 5 })).toBe(true);
    expect(towerStateSig(sim.tower, sim.money)).not.toBe(sig0);
  });

  it("changes when a retail unit's canon subtype rerolls (Change variety is undoable)", () => {
    // Without subtype in the signature, commitUndo would drop the reroll step
    // (see towerStateSig) so the player couldn't undo a Change variety. Pin it.
    const sim = newSeededGame(1);
    sim.money = 1e12;
    sim.star = 5;
    const cx = Math.floor(GRID.width / 2);
    for (let x = cx - 20; x <= cx + 20; x++) sim.tower.place("floor", 2, x);
    sim.buildTransport("elevatorStandard", cx, 1, 2);
    expect(sim.build("shop", 2, cx).ok).toBe(true);
    const shop = sim.tower.units.find((u) => u.kind === "shop")!;
    const sig0 = towerStateSig(sim.tower, sim.money);
    expect(sim.rerollSubtype(shop.id)).toBeDefined();
    expect(towerStateSig(sim.tower, sim.money)).not.toBe(sig0);
  });
});
