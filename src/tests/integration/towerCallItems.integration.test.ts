import { expect, it } from "vitest";
import { towerCalls } from "../../game/towerCallItems";
import { PortCodes, outcome } from "@verticopolis/components/port/portCodes";
import type { PendingChoiceView } from "@verticopolis/components/port/view";
import type { GameMode } from "@verticopolis/components/shared/types";
import { LOT_WIDTH, newSeededDraft, placeUnit } from "../portKit/draftFixtures";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

/**
 * The Tower menu's two calls for help (`game/towerCallItems.ts`) on the real
 * engine: the menu lights Call Fire Rescue… exactly when the engine takes the
 * call, and Call Exterminator… exactly when it takes a booking, so a lit
 * item never meets a refusal and a grayed one never hides a call the engine
 * would take. The unit test (`towerCallItems.test.ts`) pins which port reads
 * it makes; this pins that those reads mean what the engine means.
 */

/** A floor-2 tower served by an elevator, with an occupied office (the only
 *  room that can catch fire) and a hotel room. */
function tower(leg: Leg, mode: GameMode) {
  const draft = newSeededDraft(21, mode);
  const x0 = Math.floor(LOT_WIDTH / 2) - 20;
  for (let i = 0; i < 70; i++) draft.tower.place("floor", 2, x0 + i);
  const sim = new PortSim(leg, draft);
  sim.mustBuildTransport("elevatorStandard", x0, 1, 2);
  sim.mustBuild("office", 2, x0 + 4);
  const { office, hotel } = sim.setup((d) => {
    const room = d.tower.units.find((u) => u.kind === "office")!;
    room.state = "occupied";
    room.everOccupied = true;
    return { office: room.id, hotel: placeUnit(d, "hotelSingle", 2, x0 + 30).id };
  });
  sim.setMoney(10_000_000);
  return { sim, office, hotel };
}

/** The slice of the app `towerCalls` reads, on the engine: the reader's
 *  header says whether a choice waits, as the frame's flag would. */
function appOf(sim: PortSim, mode: GameMode): Parameters<typeof towerCalls>[0] {
  const header = {
    mode,
    get pendingChoice(): PendingChoiceView | null {
      const text = sim.port.pendingChoice();
      return text === undefined ? null : (JSON.parse(text) as PendingChoiceView);
    },
  };
  return { enginePort: sim.port, portCodes: new PortCodes(sim.port), reader: { header } } as unknown as Parameters<typeof towerCalls>[0];
}

describeEngines("Tower menu calls for help", (leg) => {
  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: Call Fire Rescue… is lit exactly while the engine takes the call`, () => {
      const { sim, office } = tower(leg, mode);
      const app = appOf(sim, mode);
      const takes = () => outcome(sim.port, sim.port.callFireRescue()).ok;
      expect(towerCalls(app).fireRescue).toBe(false);
      expect(takes()).toBe(false);
      sim.startFireAt(office);
      // The outbreak puts the offer up: a choice waits, so the call is grayed.
      expect(towerCalls(app).fireRescue).toBe(false);
      expect(takes()).toBe(false);
      expect(sim.answerChoice(false)).toBe(true);
      // Declined, the fire still burns: the menu lights and the engine agrees.
      expect(towerCalls(app).fireRescue).toBe(true);
      expect(takes()).toBe(true);
    });
  }

  it("classic: leaves the exterminator out", () => {
    const { sim, hotel } = tower(leg, "classic");
    sim.setUnitState(hotel, "infested");
    expect(towerCalls(appOf(sim, "classic")).exterminator).toBeNull();
  });

  it("modern: Call Exterminator… is lit exactly while the engine takes a booking", () => {
    const { sim, hotel } = tower(leg, "modern");
    const app = appOf(sim, "modern");
    expect(towerCalls(app).exterminator).toBe(false);
    sim.setUnitState(hotel, "infested");
    expect(towerCalls(app).exterminator).toBe(true);
    expect(outcome(sim.port, sim.port.bookExterminator()).ok).toBe(true);
    // Booked: the room stays infested until the crew comes, and the menu grays.
    expect(sim.state.tower.units.find((u) => u.id === hotel)!.state).toBe("infested");
    expect(towerCalls(app).exterminator).toBe(false);
    expect(outcome(sim.port, sim.port.bookExterminator()).ok).toBe(false);
  });
});
