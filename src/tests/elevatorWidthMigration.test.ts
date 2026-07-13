import { describe, it, expect } from "vitest";
import { inflateSync } from "fflate";
// A real v4 save (the owner's SixSeven tower): 15 shafts, every standard
// elevator stored at the legacy 3-tile width beside 4-wide service/express.
import towerFile from "./fixtures/sixseven_2.vctower?raw";
import { Simulation } from "../engine/Simulation";
import { SAVE_VERSION, migrateSave, upgradeV4toV5 } from "../engine/saveMigration";
import { FACILITIES, GRID, isElevatorKind } from "../engine/facilities";
import type { SerializedGame, Transport } from "../engine/types";

/** Decode a `.vctower` container (magic line + base64 deflate-raw JSON). */
function decodeVctower(text: string): SerializedGame {
  const b64 = text.slice(text.indexOf("\n") + 1).trim();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(inflateSync(bytes))) as SerializedGame;
}

/** A minimal, valid v4 SerializedGame carrying the given transports. */
function v4Save(transports: Partial<Transport>[]): SerializedGame {
  return {
    version: 4,
    seed: 1,
    money: 1e9,
    star: 3,
    minutes: 0,
    mode: "classic",
    units: [],
    transports: transports.map((t, i) => ({
      id: i + 1,
      kind: "elevatorStandard",
      x: 0,
      width: 3,
      bottom: 1,
      top: 10,
      cars: 1,
      carPositions: [1],
      carDir: [0],
      load: 0,
      ...t,
    })) as Transport[],
    nextId: transports.length + 1,
    towerName: "Legacy",
    builtWeddingHall: false,
    evaluatedTower: false,
  } as SerializedGame;
}

describe("canon elevator widths", () => {
  it("standard and service elevators share the canon 4-tile footprint", () => {
    expect(FACILITIES.elevatorStandard.width).toBe(4);
    expect(FACILITIES.elevatorService.width).toBe(4);
    expect(FACILITIES.elevatorExpress.width).toBe(4);
  });
});

describe("v4 → v5 shaft widening migration", () => {
  it("widens a lone 3-wide standard shaft in place (x kept, grows right)", () => {
    const out = upgradeV4toV5(v4Save([{ x: 100 }]));
    expect(out.version).toBe(5);
    expect(out.transports[0]).toMatchObject({ x: 100, width: 4 });
  });

  it("grows left when a shaft sits flush on the right", () => {
    const out = upgradeV4toV5(
      v4Save([
        { x: 100, width: 3 },
        { kind: "elevatorService", x: 103, width: 4 },
      ]),
    );
    expect(out.transports[0]).toMatchObject({ x: 99, width: 4 });
    expect(out.transports[1]).toMatchObject({ x: 103, width: 4 });
  });

  it("keeps the legacy width when boxed in on both sides", () => {
    const out = upgradeV4toV5(
      v4Save([
        { kind: "elevatorService", x: 96, width: 4 },
        { x: 100, width: 3 },
        { kind: "elevatorService", x: 103, width: 4 },
      ]),
    );
    expect(out.transports[1]).toMatchObject({ x: 100, width: 3 });
  });

  it("shifts left off the lot edge instead of running off-lot", () => {
    const out = upgradeV4toV5(v4Save([{ x: GRID.width - 3 }]));
    expect(out.transports[0]).toMatchObject({ x: GRID.width - 4, width: 4 });
  });

  it("only shares floors when ranges truly overlap: a shaft whose top is another's bottom blocks the widen", () => {
    // The engine counts a shared boundary floor as an overlap for elevators.
    const out = upgradeV4toV5(
      v4Save([
        { x: 100, width: 3, bottom: 1, top: 10 },
        { kind: "elevatorService", x: 103, width: 4, bottom: 10, top: 20 },
        { x: 200, width: 3, bottom: 1, top: 10 },
        { kind: "elevatorService", x: 203, width: 4, bottom: 11, top: 20 },
      ]),
    );
    expect(out.transports[0]).toMatchObject({ x: 99, width: 4 }); // grew left around it
    expect(out.transports[2]).toMatchObject({ x: 200, width: 4 }); // disjoint floors: grew right
  });

  it("judges collisions on the loader's coerced geometry, not the raw bytes", () => {
    // A garbled sibling with an inverted floor range (bottom=10, top=1) is
    // rewritten by deserialize to the 1-floor band [10, 11]; a NaN-x elevator is
    // resurrected at x=0. The migration must see both at those POST-coercion
    // footprints, or it would widen a healthy shaft into columns the loaded
    // tower actually occupies.
    const save = v4Save([
      { x: 100, width: 3, bottom: 5, top: 20 },
      { kind: "elevatorService", x: 103, width: 4, bottom: 10, top: 1 }, // inverted: loads as floors 10..11
      { x: 1, width: 3, bottom: 1, top: 10 },
    ]);
    (save.transports as unknown as unknown[]).push({
      id: 99,
      kind: "elevatorService",
      x: Number.NaN, // loads at x=0, width 4: columns [0,4)
      width: 4,
      bottom: 1,
      top: 10,
      cars: 1,
      carPositions: [1],
      carDir: [0],
      load: 0,
    });
    const out = upgradeV4toV5(save);
    // Shaft 1 shares floors 10..11 with the coerced inverted neighbor at [103,107):
    // grow-right is blocked, so it grows left.
    expect(out.transports[0]).toMatchObject({ x: 99, width: 4 });
    // Shaft 3 at [1,4) ALREADY overlaps the resurrected NaN-x shaft [0,4), so
    // every widen candidate collides and it keeps legacy width: the migration
    // never widens into (or worsens) a corrupt overlap.
    expect(out.transports[2]).toMatchObject({ x: 1, width: 3 });
    // Round-trip the migrated save through the real loader: the shaft the
    // migration widened must not overlap anything the loader actually produces.
    const loaded = Simulation.deserialize(out).serialize().transports;
    const a = loaded[0];
    expect(a).toMatchObject({ x: 99, width: 4 });
    for (const b of loaded.slice(1)) {
      const xOverlap = a.x < b.x + b.width && b.x < a.x + a.width;
      const floorOverlap = a.bottom <= b.top && b.bottom <= a.top;
      expect(xOverlap && floorOverlap).toBe(false);
    }
  });

  it("leaves walkways, canon-width elevators, and loader-dropped entries untouched", () => {
    // An entry the loader would DROP (unknown kind) passes through by identity;
    // an entry the loader KEEPS but coerces (NaN x resurrected at 0) is widened
    // at its coerced position, exactly where the loaded tower will hold it.
    const dropped = { id: 9, kind: "notAFacility", x: 200, width: 3, bottom: 1, top: 5 };
    const save = v4Save([
      { kind: "stairs", x: 50, width: 4 }, // pre-E1b walkway width: not this migration's business
      { kind: "elevatorExpress", x: 60, width: 4 },
      { x: Number.NaN, width: 3, bottom: 1, top: 5 },
    ]);
    (save.transports as unknown as unknown[]).push(dropped);
    const out = upgradeV4toV5(save);
    expect(out.transports[0]).toMatchObject({ x: 50, width: 4, kind: "stairs" });
    expect(out.transports[1]).toMatchObject({ x: 60, width: 4 });
    expect(out.transports[2]).toMatchObject({ x: 0, width: 4 }); // coerced to x=0, then widened there
    expect(out.transports[3]).toBe(dropped as unknown as Transport);
  });

  it("a widened shaft blocks later widens into its new column", () => {
    // Two 3-wide shafts 4 apart: the first grows right into the gap; the
    // second cannot grow left onto the first's NEW column and grows right.
    const out = upgradeV4toV5(
      v4Save([
        { x: 100, width: 3 },
        { x: 104, width: 3 },
      ]),
    );
    expect(out.transports[0]).toMatchObject({ x: 100, width: 4 });
    expect(out.transports[1]).toMatchObject({ x: 104, width: 4 });
  });

  it("an earlier widen claims a column a later shift-left would land on: the later shaft keeps legacy", () => {
    // Shaft A [100,103) grows right to [100,104), claiming column 103. Shaft B
    // [104,107) is blocked on the right by a service shaft at [107,111), so its
    // only candidate is the shift-left [103,107) - which must be rejected
    // against A's NEW footprint, not its stale pre-widen one. If the migration
    // failed to update A's live footprint, B would take column 103 and the
    // output would hold two overlapping shafts.
    const out = upgradeV4toV5(
      v4Save([
        { x: 100, width: 3 },
        { x: 104, width: 3 },
        { kind: "elevatorService", x: 107, width: 4 },
      ]),
    );
    expect(out.transports[0]).toMatchObject({ x: 100, width: 4 });
    expect(out.transports[1]).toMatchObject({ x: 104, width: 3 }); // boxed by A's new column + the service shaft
    for (const a of out.transports) {
      for (const b of out.transports) {
        if (a === b) continue;
        expect(a.x < b.x + b.width && b.x < a.x + a.width).toBe(false);
      }
    }
  });

  it("tries every shift up to the width delta: a width-2 shaft blocked twice lands two columns left", () => {
    // Candidates for the width-2 shaft at x=100: [100,104) and [99,103) both
    // overlap the service shaft at [102,106); [98,102) fits. An off-by-one in
    // the shift bound (shift < delta instead of <=) would strand it at legacy.
    const out = upgradeV4toV5(
      v4Save([
        { x: 100, width: 2 },
        { kind: "elevatorService", x: 102, width: 4 },
      ]),
    );
    expect(out.transports[0]).toMatchObject({ x: 98, width: 4 });
  });

  it("migrateSave chains a v4 save through the widening to the current version", () => {
    const out = migrateSave(v4Save([{ x: 100 }]));
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.transports[0]).toMatchObject({ x: 100, width: 4 });
  });
});

describe("golden fixture: the SixSeven tower (real v4 save)", () => {
  const data = decodeVctower(towerFile);

  it("is the expected v4 shape: 9 legacy 3-wide standard shafts among 15 transports", () => {
    expect(data.version).toBe(4);
    expect(data.transports).toHaveLength(15);
    const legacy = data.transports.filter((t) => t.kind === "elevatorStandard" && t.width === 3);
    expect(legacy).toHaveLength(9);
  });

  it("every standard shaft widens to 4 in place, and no two shafts overlap afterward", () => {
    const out = migrateSave(data);
    expect(out.version).toBe(SAVE_VERSION);
    const elevators = out.transports.filter((t) => isElevatorKind(t.kind));
    for (const t of elevators) expect(t.width).toBe(4);
    // In this save every widen fits by growing right, so x never moves.
    for (let i = 0; i < out.transports.length; i++) {
      expect(out.transports[i].x).toBe(data.transports[i].x);
    }
    for (const a of out.transports) {
      for (const b of out.transports) {
        if (a === b) continue;
        const xOverlap = a.x < b.x + b.width && b.x < a.x + a.width;
        const floorOverlap = a.bottom <= b.top && b.bottom <= a.top;
        expect(xOverlap && floorOverlap).toBe(false);
      }
    }
  });

  it("round-trips through the full Simulation load: widened shafts survive deserialize and re-serialize", () => {
    const sim = Simulation.deserialize(data);
    const reloaded = sim.serialize();
    expect(reloaded.version).toBe(SAVE_VERSION);
    const standards = reloaded.transports.filter((t) => t.kind === "elevatorStandard");
    expect(standards.length).toBeGreaterThan(0);
    for (const t of standards) expect(t.width).toBe(4);
    // The tower still runs: tick a full in-game hour without throwing.
    for (let i = 0; i < 60; i++) sim.tick(1);
  });

  it("a v5 save's kept-legacy shaft stays at width 3 while boxed in, and heals to 4 once the space frees", () => {
    // The widening re-runs on every load (idempotent), so keep-legacy is not a
    // life sentence: while the boxing neighbors stand, the shaft loads at its
    // exact stored footprint; the first load after they are gone widens it.
    const boxed = v4Save([
      { kind: "elevatorService", x: 96, width: 4 },
      { x: 100, width: 3 },
      { kind: "elevatorService", x: 103, width: 4 },
    ]);
    boxed.version = 5;
    const boxedOut = Simulation.deserialize(boxed).serialize().transports;
    expect(boxedOut[1]).toMatchObject({ x: 100, width: 3 });

    const freed = v4Save([{ x: 100, width: 3 }]); // neighbors demolished since
    freed.version = 5;
    const healed = Simulation.deserialize(freed).serialize().transports;
    expect(healed[0]).toMatchObject({ x: 100, width: 4 });
  });

  it("a forged over-wide shaft clamps to the catalog width instead of shadow-dropping everything under it", () => {
    // No canon transport width ever shrank, so a stored width above the
    // catalog is always forged. Left untrusted-but-kept, one such entry at
    // x=0 width=300 would blanket the lot and the overlap filter would
    // silently drop every healthy transport behind it. The clamp bounds the
    // blast radius to the catalog footprint.
    const forged = v4Save([
      { kind: "elevatorService", x: 0, width: 300, bottom: 1, top: 10 },
      { kind: "elevatorService", x: 100, width: 4, bottom: 1, top: 10 },
      { kind: "elevatorService", x: 200, width: 4, bottom: 1, top: 10 },
      { kind: "stairs", x: 250, width: 8, bottom: 1, top: 2 },
    ]);
    forged.version = 5;
    const out = Simulation.deserialize(forged).serialize().transports;
    expect(out).toHaveLength(4); // nothing shadow-dropped
    expect(out[0]).toMatchObject({ x: 0, width: 4 }); // clamped to catalog
    expect(out[1]).toMatchObject({ x: 100, width: 4 });
    expect(out[3]).toMatchObject({ x: 250, width: 8 });
  });

  it("the loader drops a forged shaft that overlaps a kept one, but keeps stacked walkway flights", () => {
    // validateTransport can never produce overlapping shafts, and everything
    // downstream assumes the invariant, so a forged/hand-edited save must not
    // smuggle one through deserialize.
    const forged = v4Save([
      { kind: "elevatorService", x: 100, width: 4, bottom: 1, top: 10 },
      { kind: "elevatorService", x: 102, width: 4, bottom: 5, top: 15 }, // overlaps the first
      { kind: "stairs", x: 200, width: 8, bottom: 1, top: 2 },
      { kind: "stairs", x: 200, width: 8, bottom: 2, top: 3 }, // legal: stacked flight sharing the landing
    ]);
    forged.version = 5;
    const out = Simulation.deserialize(forged).serialize().transports;
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ x: 100, width: 4 });
    expect(out.filter((t) => t.kind === "stairs")).toHaveLength(2);
  });

  it("a kept-legacy 3-wide shaft at the right lot edge loads at its exact saved x", () => {
    // The loader's on-lot x-clamp must use the TRUSTED stored width, not the
    // catalog width: a legacy shaft at x = lot-3 is fully on-lot at width 3,
    // and clamping by the catalog's 4 would shove it one tile left - into the
    // very neighbor that boxed it in during migration.
    const save = v4Save([
      { kind: "elevatorService", x: GRID.width - 7, width: 4, bottom: 1, top: 10 },
      { x: GRID.width - 3, width: 3, bottom: 1, top: 10 },
    ]);
    save.version = 5; // already migrated: the widths above are final
    const sim = Simulation.deserialize(save);
    const out = sim.serialize().transports;
    expect(out[1]).toMatchObject({ x: GRID.width - 3, width: 3 });
    expect(out[0]).toMatchObject({ x: GRID.width - 7, width: 4 });
    // And a forged over-wide shaft still cannot push its origin past the
    // catalog-width bound (the old hardening this clamp change must keep).
    const forged = v4Save([{ x: GRID.width - 3, width: 400 }]);
    forged.version = 5;
    const hardened = Simulation.deserialize(forged).serialize().transports[0];
    expect(hardened.x).toBeLessThanOrEqual(GRID.width - 4);
  });
});
