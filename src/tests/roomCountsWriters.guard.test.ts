import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { repoRel, sourceFiles } from "./guardFiles";

/**
 * The HUD's kept room counts (`roomCounts` in `src/engine/tower/rooms.ts`) are
 * right only while every write of a field they read marks its room. A room's
 * `state` goes through `setRoomState`, which marks it; the other fields
 * (`noRate`, `everOccupied`, `residents`, `customersIn`) are written raw in
 * the few places below, each of which marks the room or is covered by a
 * `setRoomState` in the same function.
 *
 * What this guard enforces is the count of raw writes per file and field
 * outside the tests: a new raw write, in any assignment form, a prefix or
 * postfix step, a `delete` or a quoted key, changes a count and fails here,
 * so its author has to mark the room and update the table. It does not prove
 * that the mark is there or that it follows the write; the table's notes say
 * where each file marks, and the behavior is checked by the seeded run
 * (`src/tests/integration/roomCounts.integration.test.ts`) and the cases in
 * `src/engine/tower/roomCounts.test.ts`, against the walk over every unit.
 *
 * Writes through `p`, `person` or `this` are people's and a class's own
 * fields; they are pinned per file in their own table, so a room bound to one
 * of those names still shows up as a change there. Writes the pattern cannot
 * see (`Object.assign`, `Reflect.set`, a `delete` through a cast or a
 * computed key) are held to the bulk-writer table, which names every file
 * that makes one and the call each unit writer among them marks with. A
 * destructuring assignment into a counted field (`({ state: u.state } = r)`)
 * is seen by neither; there is none today.
 *
 * Tooling outside `src/` (the screenshot scenes and tower builders under
 * `scripts/`, the e2e helpers) stages towers with raw writes and is not
 * scanned. The stats report counts the rooms afresh each time it opens
 * (`tsStatsReport`), and a placement after a staged write rebuilds the rooms
 * list; a scene that writes a counted field after the HUD's first read, with
 * no placement after it, leaves the HUD strip behind until the next rebuild.
 */

const FIELD = "state|noRate|everOccupied|residents|customersIn";
const MEMBER = String.raw`(?:\.(${FIELD})\b|\[\s*(["'\`])(${FIELD})\3\s*\])`;
/** `x.f op` and `x["f"] op`, for every assignment operator and a postfix step. */
const ASSIGNED = new RegExp(
  String.raw`(?:\b([A-Za-z_$][\w$]*)|[\])!])\s*${MEMBER}\s*(?:\*\*=|<<=|>>>?=|\?\?=|\|\|=|&&=|[-+*/%&|^]?=(?!=)|\+\+|--)`,
  "g",
);
/** A prefix step or a `delete` on a chain ending in a counted field. */
const PREFIXED = new RegExp(String.raw`(?:\+\+|--|\bdelete\b)\s*((?:[\w$]+|[.[\]()!?])*?)${MEMBER.replace("\\3", "\\4")}`, "g");
const NOT_A_ROOM: ReadonlySet<string> = new Set(["p", "person", "this"]);

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
  // The save writer, serializeUnit(): it builds a new record from a unit and
  // writes into that record, never into a room a tower holds.
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

/** A write the pattern cannot see. */
const BULK = /\bObject\.assign\(|\bReflect\.set\(|(?<![.\w$])delete\s*\(|(?<![.\w$])delete\s+[\w$.!]+\[/;

/** Every file with a bulk write, and for a unit writer the call that keeps
 *  the counts (it must appear in the file); `null` for a file whose bulk
 *  writes touch no unit. */
const BULK_WRITERS: Record<string, string | null> = {
  // mergeById(): rewrites every unit in place; mergeTower marks the rooms
  // whose counted fields differ, or drops the rooms list when units moved.
  "src/wasmhost/merge.ts": "markRoom(",
  // Errors and a sprite canvas.
  "src/dualrun/catalog.ts": null,
  "src/render/pixelSprites/food.kit.ts": null,
  "src/wasmhost/hostFault.ts": null,
  "src/wasmhost/workerController.ts": null,
  // The app's hooks, the simulation's and tower's relayed methods and fields
  // (money, view, the tower's name), and a person's optional fields.
  "src/dualrun/dualRun.ts": null,
  "src/dualrun/mirror.ts": null,
  "src/wasmhost/personFields.ts": null,
  "src/wasmhost/startWasmHost.ts": null,
  "src/wasmhost/wasmHost.ts": null,
  "src/wasmhost/workerApply.ts": null,
};

function scan(): { raw: Record<string, Record<string, number>>; named: Record<string, Record<string, number>>; bulk: string[]; texts: Map<string, string> } {
  const raw: Record<string, Record<string, number>> = {};
  const named: Record<string, Record<string, number>> = {};
  const bulk: string[] = [];
  const texts = new Map<string, string>();
  for (const abs of sourceFiles("src", [".ts", ".tsx"])) {
    const rel = repoRel(abs);
    if (rel.startsWith("src/tests/") || rel.endsWith(".test.ts") || rel.endsWith(".d.ts")) continue;
    const text = readFileSync(abs, "utf8");
    texts.set(rel, text);
    if (BULK.test(text)) bulk.push(rel);
    for (const w of writesIn(text)) {
      const fields = ((w.named ? named : raw)[rel] ??= {});
      fields[w.field] = (fields[w.field] ?? 0) + 1;
    }
  }
  return { raw, named, bulk: bulk.sort(), texts };
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

  it("made wholesale are in the bulk-writer table, and each unit writer keeps the counts", () => {
    expect(found.bulk, "A file with Object.assign, Reflect.set or a computed delete must be listed in BULK_WRITERS.").toEqual(Object.keys(BULK_WRITERS).sort());
    for (const [file, marker] of Object.entries(BULK_WRITERS)) {
      if (marker !== null) expect(found.texts.get(file), `${file} must call ${marker}`).toContain(marker);
    }
  });

  it("are found in every write form, and reads are passed over", () => {
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
    expect(hits("p.state = 'riding'; this.state = 1; ++person.state;")).toEqual(["named state", "named state", "named state"]);
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
    for (const line of ["Object.assign(held, record);", "delete held[key];", "delete (u as Unit).noRate;", "Reflect.set(u, k, v);"]) expect(BULK.test(line), line).toBe(true);
  });
});
