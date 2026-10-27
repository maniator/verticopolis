import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { repoRel, sourceFiles } from "./guardFiles";

/**
 * The HUD's kept room counts (`roomCounts` in `src/engine/tower/rooms.ts`) are
 * right only while every write of a field they read marks its room. A room's
 * `state` goes through `setRoomState`, which marks it; the other fields
 * (`noRate`, `everOccupied`, `residents`, `customersIn`) are written raw in
 * the few places below, each of which marks the room or is covered by a
 * `setRoomState` in the same function. This guard holds the raw writes outside
 * the tests to that table, so a new one fails here until its room is marked
 * and the table names it. The seeded run
 * (`src/tests/integration/roomCounts.integration.test.ts`) and the cases in
 * `src/engine/tower/roomCounts.test.ts` check the marks against the walk over
 * every unit.
 *
 * People carry a `state` too: a write through `p` or `person` is a person's,
 * and a class's own `this.state` is not a room's, so neither counts.
 */

const WRITE = /(?:\b([A-Za-z_$][\w$]*)|[\])!])\s*\.(state|noRate|everOccupied|residents|customersIn)\s*(?:=(?!=)|\+=|-=|\+\+|--)/g;
const NOT_A_ROOM: ReadonlySet<string> = new Set(["p", "person", "this"]);

/** Raw writes per file and field, and what marks each file's rooms. */
const RAW_WRITES: Record<string, Record<string, number>> = {
  // gut(): covered by its setRoomState.
  "src/engine/EventSystem.ts": { everOccupied: 1, residents: 1 },
  // finish(): markRoom after the decrement.
  "src/engine/crowd/motion.ts": { customersIn: 1 },
  // beginDwell(): markRoom after each increment.
  "src/engine/crowd/visits.ts": { customersIn: 2 },
  // vacate(), attemptMoveIns(), moveIn(): covered by their setRoomState.
  "src/engine/sim/churn.ts": { everOccupied: 7, residents: 3 },
  // The load's coercion builds new unit records, before any tower holds them.
  "src/engine/sim/coerce.ts": { state: 1, everOccupied: 1, residents: 1, noRate: 1 },
  // priceUnit(), setNoRate(), computeBatch(): markRoom after each write.
  "src/engine/sim/rent.ts": { noRate: 4 },
  // setRoomState itself.
  "src/engine/tower/rooms.ts": { state: 1 },
  // The hosts' unit records: markRoom when either field moves.
  "src/wasmhost/frameApply.ts": { state: 1, customersIn: 1 },
  "src/wasmhost/frameSync.ts": { state: 1, customersIn: 1 },
};

function rawWrites(): Record<string, Record<string, number>> {
  const found: Record<string, Record<string, number>> = {};
  for (const abs of sourceFiles("src", [".ts", ".tsx"])) {
    const rel = repoRel(abs);
    if (rel.startsWith("src/tests/") || rel.endsWith(".test.ts") || rel.endsWith(".d.ts")) continue;
    for (const m of readFileSync(abs, "utf8").matchAll(WRITE)) {
      if (m[1] !== undefined && NOT_A_ROOM.has(m[1])) continue;
      const fields = (found[rel] ??= {});
      fields[m[2]] = (fields[m[2]] ?? 0) + 1;
    }
  }
  return found;
}

describe("writes of the fields the HUD's room counts read", () => {
  it("are the marked ones the table lists", () => {
    expect(
      rawWrites(),
      "A write of a room's state goes through setRoomState; any other counted field needs markRoom (src/engine/tower/rooms.ts) and a row here.",
    ).toEqual(RAW_WRITES);
  });

  it("finds a raw write and passes over a person's", () => {
    const hits = (text: string) => [...text.matchAll(WRITE)].filter((m) => m[1] === undefined || !NOT_A_ROOM.has(m[1])).map((m) => m[2]);
    expect(hits("u.state = 'empty'; room.noRate = true; units[i].customersIn++; get(id)!.residents -= 1;")).toEqual(["state", "noRate", "customersIn", "residents"]);
    expect(hits("p.state = 'riding'; this.state = 1; if (u.state === 'empty') {}")).toEqual([]);
  });
});
