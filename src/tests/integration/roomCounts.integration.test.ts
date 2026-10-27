import { describe, expect } from "vitest";
import { inflateSync } from "fflate";

import medium from "../../../conformance/fixtures/sixseven_2.vctower?raw";
import ownersSave from "../../../conformance/fixtures/split-tower-4.vctower?raw";
import starFour from "../../../conformance/fixtures/towerone-star4.vctower?raw";
import { Simulation } from "../../engine/Simulation";
import { roomUnits } from "../../engine/tower/rooms";
import type { SerializedGame, Unit } from "../../engine/types";
import { walkedStats } from "../fixtures/walkedStats";
import { itTypeScriptOnly } from "../parity/typescriptOnly";

/** Decode a `.vctower` container (magic line + base64 deflate-raw JSON). */
function decodeVctower(text: string): SerializedGame {
  const b64 = text.slice(text.indexOf("\n") + 1).trim();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(inflateSync(bytes))) as SerializedGame;
}

const STEPS = 900; // 30 game hours, one tick(2) (two game minutes) a step: an evening, a morning checkout, the hourly passes

type Counts = ReturnType<typeof walkedStats>;
const FIELDS = Object.keys(walkedStats(new Simulation(1))) as (keyof Counts)[];

/** A seeded pick from the rooms, so the commands land on real rooms. */
function pick(sim: Simulation, n: number, keep: (u: Unit) => boolean): Unit | undefined {
  const rooms = roomUnits(sim.tower).filter(keep);
  return rooms.length === 0 ? undefined : rooms[n % rooms.length];
}

/**
 * Run a fixture with the HUD reading `stats()` after every step and every
 * command, and hold each read to the walk over every unit. A write to a
 * counted field that does not mark its room leaves the kept counts behind the
 * walk, so this catches any write site the run reaches. Fires, departures,
 * rate changes, reprices, sales and builds are issued along the way. How
 * often each count moved between reads, leaving out the reads after a sale
 * or a build (which rebuild the rooms list and count every room), shows that
 * marked writes moved them. The rarer writes have their own cases in
 * `src/engine/tower/roomCounts.test.ts`.
 */
function run(name: string, save: string): { moved: Record<keyof Counts, number>; rebuilds: number } {
  const sim = Simulation.deserialize(decodeVctower(save));
  sim.money = 1e12;
  const moved = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<keyof Counts, number>;
  let rebuilds = 0;
  let last = sim.stats();
  const check = (label: string, rebuilt = false) => {
    const now = sim.stats();
    expect(now, `${name}, ${label}`).toMatchObject(walkedStats(sim));
    if (!rebuilt) for (const f of FIELDS) if (now[f] !== last[f]) moved[f]++;
    last = now;
  };
  for (let step = 1; step <= STEPS; step++) {
    sim.tick(2);
    check(`step ${step}`);
    if (step % 97 === 0) {
      sim.startFire();
      check(`fire at ${step}`);
    }
    if (step % 61 === 0) {
      // A tenant leaves and the office goes off the market or back on it.
      const office = pick(sim, step, (u) => u.kind === "office" && u.state !== "construction");
      if (office) {
        sim.vacate(office, "access");
        check(`vacate at ${step}`);
        if (office.noRate) sim.priceUnit(office, 10_000);
        else sim.setNoRate(office.id);
        check(`rate at ${step}`);
      }
      // The batch takes a kind off the market and, the next time round for
      // that kind, back on at the default rate.
      const k = step / 61;
      sim.applyRentBatch(k % 2 === 0 ? "office" : "condo", (k >> 1) % 2 === 0 ? "noRate" : "default");
      check(`batch at ${step}`);
    }
    if (step % 113 === 0) {
      const room = pick(sim, step, (u) => u.kind === "office" || u.kind === "condo" || u.kind === "shop");
      if (room) {
        const { kind, floor, x } = room;
        const sold = sim.sellAt(floor, x);
        check(`sale at ${step}`, true);
        if (sold && sim.build(kind, floor, x).ok) rebuilds++;
        check(`build at ${step}`, true);
      }
    }
  }
  return { moved, rebuilds };
}

describe("the HUD's kept room counts follow a running simulation", () => {
  itTypeScriptOnly("vacates offices through sim.vacate mid-run, which no command relays; the hosts' merge and frame apply have their own cases (merge.test.ts, frameApply.test.ts)")("match the walk over every unit after every step and command", () => {
    const totals = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<keyof Counts, number>;
    let rebuilds = 0;
    for (const [name, save] of [["sixseven_2", medium], ["split-tower-4", ownersSave], ["towerone-star4", starFour]] as const) {
      const result = run(name, save);
      for (const f of FIELDS) totals[f] += result.moved[f];
      rebuilds += result.rebuilds;
    }
    // What the runs reached: every condition count and the population moved
    // under marked writes, and a sale and a build went through.
    for (const f of ["population", "occupiedOffices", "vacant", "vacantNoRate", "soldCondos", "occupiedHotel", "dirty"] as const) {
      expect(totals[f], f).toBeGreaterThan(0);
    }
    expect(rebuilds, "sales and builds that went through").toBeGreaterThan(0);
  }, 120_000);
});
