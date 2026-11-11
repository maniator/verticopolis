import { expect, it } from "vitest";
import { inflateSync } from "fflate";

import medium from "../../../conformance/fixtures/sixseven_2.vctower?raw";
import ownersSave from "../../../conformance/fixtures/split-tower-4.vctower?raw";
import starFour from "../../../conformance/fixtures/towerone-star4.vctower?raw";
import { FACILITIES } from "../../engine/facilities";
import { isCommercialKind } from "../../engine/facilityPredicates";
import type { FacilityKind, SerializedGame, Unit } from "../../shared/types";
import { PortCodes } from "../../simport/portCodes";
import { walkedStats } from "../fixtures/walkedStats";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

/** The HUD's room counts follow a running simulation, on both engines. Moved
 *  from roomCounts.integration.test.ts, which drove the TypeScript engine's
 *  `sim.vacate` directly; the engine's tooling-only `vacateUnit` makes the same
 *  departure here. The hosts' merge and frame apply have their own cases
 *  (merge.test.ts, frameApply.test.ts). */

/** Decode a `.vctower` container (magic line + base64 deflate-raw JSON) to save text. */
function decodeVctower(text: string): string {
  const b64 = text.slice(text.indexOf("\n") + 1).trim();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(inflateSync(bytes));
}

const STEPS = 900; // 30 game hours, one tick(2) (two game minutes) a step: an evening, a morning checkout, the hourly passes

type Counts = ReturnType<typeof walkedStats>;

/** The kinds whose census count is their live customer tally, which no save
 *  carries: the walk reads it from the engine's unit card instead. */
const TALLIED_VENUES: ReadonlySet<string> = new Set(
  (Object.keys(FACILITIES) as FacilityKind[]).filter(
    (k) => isCommercialKind(k) && FACILITIES[k].population > 0,
  ),
);

/** The walk over every unit in the engine's save, read as the engine wrote
 *  it (no load in between, which would also cost a tower rebuild per check),
 *  with each tallied venue's live customers read from its unit card. `codes`
 *  is read once per run, since the layout does not change. */
function walkedCounts(sim: PortSim, codes: PortCodes): Counts {
  const units = (JSON.parse(sim.save()) as SerializedGame).units as Unit[];
  for (const u of units) {
    u.state ??= "empty"; // the save leaves an empty room's state out, as a load reads it
    if (!TALLIED_VENUES.has(u.kind)) continue;
    const live = codes.slot(sim.port.unitCard(u.id), "unitCard", "customersIn");
    u.customersIn = Number.isNaN(live) ? undefined : live;
  }
  return walkedStats({ tower: { units } });
}

/** A seeded pick from the engine's units, so the commands land on real rooms. */
function pick(
  sim: PortSim,
  n: number,
  keep: (u: Unit) => boolean,
): Unit | undefined {
  const rooms = sim.state.tower.units.filter(keep);
  return rooms.length === 0 ? undefined : rooms[n % rooms.length];
}

/**
 * Run a fixture with the HUD reading the engine's stats after every step and
 * every command, and hold each read to the walk over every unit in the
 * engine's save. A write to a counted field that leaves the engine's kept
 * counts behind the walk fails here. Fires, departures, rate changes,
 * reprices, sales and builds are issued along the way, and how often each
 * count moved between reads shows the run reached them.
 */
function run(
  leg: Leg,
  name: string,
  save: string,
): { moved: Record<keyof Counts, number>; rebuilds: number } {
  const sim = new PortSim(leg, decodeVctower(save));
  sim.setMoney(1e12);
  const codes = new PortCodes(sim.port);
  const fields = Object.keys(walkedCounts(sim, codes)) as (keyof Counts)[];
  const moved = Object.fromEntries(fields.map((f) => [f, 0])) as Record<
    keyof Counts,
    number
  >;
  let rebuilds = 0;
  let last: Record<string, number> = { ...sim.statsReport().stats };
  const check = (label: string) => {
    const now: Record<string, number> = { ...sim.statsReport().stats };
    const walked = walkedCounts(sim, codes);
    expect(now, `${name}, ${label}`).toMatchObject(walked);
    for (const f of fields) if (now[f] !== last[f]) moved[f]++;
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
      const office = pick(
        sim,
        step,
        (u) => u.kind === "office" && u.state !== "construction",
      );
      if (office) {
        sim.vacateUnit(office.id, "access");
        check(`vacate at ${step}`);
        if (office.noRate) sim.setRent(office.id, 10_000);
        else sim.noRate(office.id);
        check(`rate at ${step}`);
      }
      // The batch takes a kind off the market and, the next time round for
      // that kind, back on at the default rate.
      const k = step / 61;
      sim.rentBatch(
        k % 2 === 0 ? "office" : "condo",
        Math.floor(k / 2) % 2 === 0 ? "noRate" : "default",
      );
      check(`batch at ${step}`);
    }
    if (step % 113 === 0) {
      const room = pick(
        sim,
        step,
        (u) => u.kind === "office" || u.kind === "condo" || u.kind === "shop",
      );
      if (room) {
        const { kind, floor, x } = room;
        const sold = sim.sellAt(floor, x);
        check(`sale at ${step}`);
        if (sold && sim.build(kind, floor, x).ok) rebuilds++;
        check(`build at ${step}`);
      }
    }
  }
  return { moved, rebuilds };
}

describeEngines(
  "the HUD's kept room counts follow a running simulation",
  (leg: Leg) => {
    it("match the walk over every unit after every step and command", () => {
      const totals: Record<string, number> = {};
      let rebuilds = 0;
      for (const [name, save] of [
        ["sixseven_2", medium],
        ["split-tower-4", ownersSave],
        ["towerone-star4", starFour],
      ] as const) {
        const result = run(leg, name, save);
        for (const [f, n] of Object.entries(result.moved))
          totals[f] = (totals[f] ?? 0) + n;
        rebuilds += result.rebuilds;
      }
      // What the three runs reached together: every condition count and the
      // population moved, and a sale and a build went through.
      for (const f of [
        "population",
        "occupiedOffices",
        "vacant",
        "vacantNoRate",
        "soldCondos",
        "occupiedHotel",
        "dirty",
      ] as const) {
        expect(totals[f], f).toBeGreaterThan(0);
      }
      expect(rebuilds, "sales and builds that went through").toBeGreaterThan(0);
    }, 300_000); // about 95 s a leg in the container: a check after every step and command
  },
);
