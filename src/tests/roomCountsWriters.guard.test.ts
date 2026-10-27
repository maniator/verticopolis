import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { repoRel, sourceFiles } from "./guardFiles";
import { COUNTED_FIELDS } from "../engine/tower/rooms";

/**
 * The HUD's kept room counts (`roomCounts` in `src/engine/tower/rooms.ts`) are
 * right only while every write of a field they read (`COUNTED_FIELDS`) marks
 * its room. A room's `state` goes through `setRoomState`, which marks it; the
 * other fields are written raw in the few places below, each of which marks
 * the room or is covered by a `setRoomState` in the same function.
 *
 * What this guard enforces is the count of raw writes per file and field
 * outside the tests: a new raw write, in any assignment form, a prefix or
 * postfix step, a `delete` or a quoted key, changes a count and fails here,
 * so its author has to mark the room and update the table. It does not prove
 * that the mark is there or that it follows the write; the table's notes say
 * where each file marks, and the behavior is checked by the seeded run
 * (`src/tests/integration/roomCounts.integration.test.ts`) and the cases in
 * `src/engine/tower/roomCounts.test.ts`, against the walk over every unit.
 * Comment lines are left out of the scan, so prose cannot stand in for a
 * write.
 *
 * Writes through `p`, `person` or `this` are people's and a class's own
 * fields; they are pinned per file in their own table, so a room bound to one
 * of those names still shows up as a change there. Writes the field patterns
 * cannot see are pinned per file in a third table: anywhere in `src/`,
 * `Object.assign`, `Object.defineProperty` and `defineProperties`,
 * `Reflect.set` and `deleteProperty`, a `delete` through a cast or a computed
 * key, and an assignment through a cast and a computed key; in the host code
 * that copies the engine's records (`src/wasmhost/`, `src/dualrun/`,
 * `src/simport/`), any assignment through a computed key. The engine writes
 * rooms by field name, so its plain computed-key writes (array and map
 * slots) are not pinned, and a destructuring assignment into a counted field
 * (`({ state: u.state } = r)`) is seen by no table; there is none today.
 *
 * Tooling outside `src/` (the screenshot scenes and tower builders under
 * `scripts/`, the e2e helpers) stages towers with raw writes and is not
 * scanned. A write before a placement or a load is counted by the rebuild
 * that follows; a scene that writes a counted field after the HUD has read,
 * with no placement after it, bumps `tower.revision` so the next read counts
 * the rooms again (the stats-tenancy-classic scene in
 * `scripts/scenes/features.ts`, as `e2e/regions.spec.ts` does for its fire).
 */

const FIELD = COUNTED_FIELDS.join("|");
const MEMBER = String.raw`(?:\.(${FIELD})\b|\[\s*(["'\`])(${FIELD})\3\s*\])`;
const OPERATOR = String.raw`(?:\*\*=|<<=|>>>?=|\?\?=|\|\|=|&&=|[-+*/%&|^]?=(?![=>])|\+\+|--)`;
/** `x.f op` and `x["f"] op`, for every assignment operator and a postfix step. */
const ASSIGNED = new RegExp(String.raw`(?:\b([A-Za-z_$][\w$]*)|[\])!])\s*${MEMBER}\s*${OPERATOR}`, "g");
/** A prefix step or a `delete` on a chain ending in a counted field. The
 *  chain is one character class, so a long name cannot make it backtrack;
 *  the quote is group 3 here as in `ASSIGNED`. */
const PREFIXED = new RegExp(String.raw`(?:\+\+|--|\bdelete\b)\s*([\w$.[\]()!?]*?)${MEMBER}`, "g");
const NOT_A_ROOM: ReadonlySet<string> = new Set(["p", "person", "this"]);

/** `text` without its comment lines (`//`, `/*` and the ` *` lines of a block). */
function code(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

/** Each counted-field write in `text`: its field, and whether its receiver
 *  is one of the {@link NOT_A_ROOM} names. */
function writesIn(text: string): { field: string; named: boolean }[] {
  const out: { field: string; named: boolean }[] = [];
  for (const m of text.matchAll(ASSIGNED)) out.push({ field: m[2] ?? m[4], named: m[1] !== undefined && NOT_A_ROOM.has(m[1]) });
  for (const m of text.matchAll(PREFIXED)) {
    const receiver = /([A-Za-z_$][\w$]*)\s*$/.exec(m[1])?.[1];
    out.push({ field: m[2] ?? m[4], named: receiver !== undefined && NOT_A_ROOM.has(receiver) });
  }
  return out;
}

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
  // The save writer, serializeUnit(): its writes go only into the new record
  // it builds from a unit.
  "src/engine/sim/coerce.ts": { state: 1, everOccupied: 1, residents: 1, noRate: 1 },
  // priceUnit(), setNoRate(), computeBatch(): markRoom after each write.
  "src/engine/sim/rent.ts": { noRate: 4 },
  // setRoomState itself.
  "src/engine/tower/rooms.ts": { state: 1 },
  // The hosts' unit records: markRoom when either field moves.
  "src/wasmhost/frameApply.ts": { state: 1, customersIn: 1 },
  "src/wasmhost/frameSync.ts": { state: 1, customersIn: 1 },
};

/** Writes through a person's or a class's own name, per file: the crowd's
 *  people (`motion.ts`, `visits.ts`, the hosts' crowd apply) and the
 *  generator's own `this.state` (`rng.ts`). */
const NAMED_WRITES: Record<string, Record<string, number>> = {
  "src/engine/crowd/motion.ts": { state: 9 },
  "src/engine/crowd/visits.ts": { state: 1 },
  "src/engine/rng.ts": { state: 3 },
  "src/wasmhost/frameApply.ts": { state: 1 },
  "src/wasmhost/frameSync.ts": { state: 1 },
};

/** Writes the field patterns cannot see, anywhere in `src/`. */
const BULK = new RegExp(
  [
    String.raw`\bObject\.(?:assign|defineProperty|defineProperties)\(`,
    String.raw`\bReflect\.(?:set|deleteProperty)\(`,
    String.raw`(?<![.\w$])delete\s*\(`,
    String.raw`(?<![.\w$])delete\s+[\w$.!]+\[`,
    String.raw`\)\[\s*[A-Za-z_$][\w$.]*\s*\]\s*${OPERATOR}`,
  ].join("|"),
  "g",
);
/** An assignment through a computed key (not a quoted or numeric one), pinned
 *  in {@link HOST_CODE} only. */
const KEYED = new RegExp(String.raw`[\w$\])!]\[\s*(?!["'\`\d])[^\]\n]+\]\s*${OPERATOR}`, "g");
/** The host code that copies the engine's records into the read model. */
const HOST_CODE = ["src/wasmhost/", "src/dualrun/", "src/simport/"];

/** Per file: how many writes {@link BULK} and {@link KEYED} find, and for a
 *  file that writes units this way, how many `markRoom(` calls keep the
 *  counts. A new write of either kind changes a count here, so its author
 *  checks whether it reaches a room. */
interface OpaqueWrites {
  bulk?: number;
  keyed?: number;
  marks?: number;
}
const OPAQUE_WRITES: Record<string, OpaqueWrites> = {
  // assignRecord() rewrites a unit or a transport in place (a delete pass
  // and an Object.assign), for both unit writers: mergeTower marks the rooms
  // whose counted fields differ or drops the rooms list when units moved, and
  // mergeSimulationDelta marks every unit it rewrites (and drops the list
  // when a record moved). The keyed writes copy the Simulation's and the
  // Tower's own fields.
  "src/wasmhost/merge.ts": { bulk: 2, keyed: 2, marks: 2 },
  // A person's fields through their key; the other keyed writes are a
  // route's legs and the cars' positions, loads and directions. The unit
  // records are written by name and marked (RAW_WRITES).
  "src/wasmhost/frameApply.ts": { bulk: 1, keyed: 5, marks: 1 },
  "src/wasmhost/frameSync.ts": { bulk: 1, keyed: 1, marks: 1 },
  "src/wasmhost/personFields.ts": { bulk: 2, keyed: 1 },
  // Errors and a sprite canvas.
  "src/dualrun/catalog.ts": { bulk: 1 },
  "src/render/pixelSprites/food.kit.ts": { bulk: 1 },
  "src/wasmhost/hostFault.ts": { bulk: 2 },
  "src/wasmhost/workerController.ts": { bulk: 4 },
  // The sprite atlas's tables and a canvas context's method.
  "src/render/atlas/bake.ts": { bulk: 4 },
  "src/render/atlas/bakeAdditions.ts": { bulk: 1 },
  "src/render/atlas/browserEntry.ts": { bulk: 1 },
  // The app's hooks, and the simulation's and tower's relayed methods and
  // fields (money, view, the tower's name).
  "src/dualrun/dualRun.ts": { bulk: 3 },
  "src/dualrun/mirror.ts": { bulk: 5 },
  "src/wasmhost/startWasmHost.ts": { bulk: 6 },
  "src/wasmhost/wasmHost.ts": { bulk: 7 },
  "src/wasmhost/workerApply.ts": { bulk: 2 },
  "src/wasmhost/workerHost.ts": { bulk: 3 },
  // Array slots: the section builder's output and the telemetry's tables.
  "src/wasmhost/buildSection.ts": { keyed: 1 },
  "src/wasmhost/telemetry.ts": { keyed: 2 },
};

function scan(): { raw: Record<string, Record<string, number>>; named: Record<string, Record<string, number>>; opaque: Record<string, OpaqueWrites> } {
  const raw: Record<string, Record<string, number>> = {};
  const named: Record<string, Record<string, number>> = {};
  const opaque: Record<string, OpaqueWrites> = {};
  for (const abs of sourceFiles("src", [".ts", ".tsx"])) {
    const rel = repoRel(abs);
    if (rel.startsWith("src/tests/") || rel.endsWith(".test.ts") || rel.endsWith(".d.ts")) continue;
    const text = code(readFileSync(abs, "utf8"));
    const bulk = text.match(BULK)?.length ?? 0;
    const keyed = HOST_CODE.some((dir) => rel.startsWith(dir)) ? (text.match(KEYED)?.length ?? 0) : 0;
    if (bulk > 0 || keyed > 0) {
      const marks = text.split("markRoom(").length - 1;
      opaque[rel] = { ...(bulk > 0 && { bulk }), ...(keyed > 0 && { keyed }), ...(marks > 0 && { marks }) };
    }
    for (const w of writesIn(text)) {
      const fields = ((w.named ? named : raw)[rel] ??= {});
      fields[w.field] = (fields[w.field] ?? 0) + 1;
    }
  }
  return { raw, named, opaque };
}

describe("writes of the fields the HUD's room counts read", () => {
  const found = scan();

  it("are the marked ones the table lists", () => {
    expect(
      found.raw,
      "A write of a room's state goes through setRoomState; any other counted field needs markRoom (src/engine/tower/rooms.ts) and a row here.",
    ).toEqual(RAW_WRITES);
  });

  it("through a person's or a class's own name are the ones the table lists", () => {
    expect(found.named, "A room bound to p, person or this still needs its mark: rename it, or list a real person's write here.").toEqual(NAMED_WRITES);
  });

  it("the field patterns cannot see are the ones the table lists, with the unit writers' marks", () => {
    expect(
      found.opaque,
      "A wholesale or computed-key write that can reach a room needs markRoom for each room it changes (or forgetUnitLists); update OPAQUE_WRITES either way.",
    ).toEqual(OPAQUE_WRITES);
  });

  it("are found in every write form, and reads and comments are passed over", () => {
    const hits = (text: string) => writesIn(text).map((w) => (w.named ? `named ${w.field}` : w.field));
    const writes = [
      "u.state = 'empty';",
      "room.noRate = true;",
      "units[i].customersIn++;",
      "get(id)!.residents -= 1;",
      "u.noRate ??= true;",
      "u.everOccupied ||= true;",
      "u.everOccupied &&= false;",
      "u.residents *= 2;",
      "u.residents |= 1;",
      "u['state'] = 'empty';",
      'u["noRate"] = true;',
    ];
    expect(hits(writes.join(" "))).toEqual(["state", "noRate", "customersIn", "residents", "noRate", "everOccupied", "everOccupied", "residents", "residents", "state", "noRate"]);
    expect(hits("++venue.customersIn; --units[i].customersIn; delete u.noRate; delete rooms[k].everOccupied;")).toEqual(["customersIn", "customersIn", "noRate", "everOccupied"]);
    expect(hits(`++u["customersIn"]; --u['residents']; delete u["noRate"];`)).toEqual(["customersIn", "residents", "noRate"]);
    expect(hits("p.state = 'riding'; this.state = 1; ++person.state;")).toEqual(["named state", "named state", "named state"]);
    // A long name after a step or a delete: a pattern that backtracks over
    // how to split the name would not finish this inside the test's timeout.
    expect(hits(`delete this.${"a".repeat(60)}; ++${"b".repeat(60)}.count;`)).toEqual([]);
    const reads = [
      "if (u.state === 'empty') {}",
      "if (u.state !== s) {}",
      "x == u.noRate;",
      "u.residents <= 3 && u.residents >= 1;",
      "const s = u.state;",
      "u.stateLabel = 1;",
      "u.customersIn > 0 ? a : b;",
      "f(u.state, u.noRate);",
    ];
    expect(hits(reads.join(" "))).toEqual([]);
    expect(hits(code("// u.state = 'empty';\n/* u.noRate = true; */\n * u.residents = 2;\nu.customersIn = 0;"))).toEqual(["customersIn"]);
    const finds = (re: RegExp, line: string) => (line.match(re)?.length ?? 0) > 0;
    const bulk = [
      "Object.assign(held, record);",
      "Object.defineProperty(u, 'state', d);",
      "Object.defineProperties(u, ds);",
      "Reflect.set(u, k, v);",
      "Reflect.deleteProperty(u, k);",
      "delete held[key];",
      "delete (u as Unit).noRate;",
      "(u as Record<string, unknown>)[key] = v;",
      "(u as Unit)[k] ??= v;",
    ];
    for (const line of bulk) expect(finds(BULK, line), line).toBe(true);
    for (const line of ["held[key] = record[key];", "out[i + 1] = x;", "slots[h] ||= 1;"]) expect(finds(KEYED, line), line).toBe(true);
    for (const line of ["const [a, b] = pair;", "xs[0] = 1;", "m['k'] = 1;", "if (xs[i] === y) {}", "xs[i] >= y;", "xs[i] <= y;"]) expect(finds(KEYED, line), line).toBe(false);
  });
});
