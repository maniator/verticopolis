// #575 economy-verification harness fixture builder.
//
// Builds a compact, well-framed tower whose units carry KNOWN rent CLASSES so
// the real 1994 game, on load, displays ITS OWN dollar figure for each class in
// the unit inspector. The .TDT format persists the rent-class byte (0 Very Low
// .. 3 High), not a dollar amount, so this is an assumption-free read: we set
// the class, the retail game shows the dollars it assigns to that class. If the
// game's Average office reads $10,000 and the rungs read 2k/5k/10k/15k, our
// CLASSIC_RENT_LADDERS match the retail game rung for rung.
//
// Layout (tower width 30, floors 1..5), camera framed on the rooms:
//   floor 2: office Very Low (x6) | office Low (x16)
//   floor 3: office Average (x6) | office High (x16)
//   floor 4: hotel single Average (x6) | double Average (x12) | suite Average (x19)
//   floor 5: condo Average (x6)
// One standard elevator (x0) serves 1..5; a full lobby on floor 1.
//
// Usage:  npx tsx tools/simtower/build-economy-verify.ts
// Writes: tools/simtower/saves/ECONVER.TDT
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Simulation } from "../../src/engine/Simulation";
import { buildTDT } from "../../src/storage/tdtExport";
import type { FacilityKind, SerializedGame } from "../../src/engine/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAVES = resolve(HERE, "saves");

const TOWER_W = 30;
const TOP = 5;

function must(ok: boolean, msg: string): void {
  if (!ok) throw new Error(msg);
}

const sim = new Simulation(4242, "classic");
const t = sim.tower;
sim.star = 3; // so hotel double/suite behave as established units

// Floor 1 lobby full width; floors 2..TOP plain floors full width.
for (let x = 0; x < TOWER_W; x++) must(t.place("lobby", 1, x).ok, `lobby 1,${x}`);
for (let f = 2; f <= TOP; f++)
  for (let x = 0; x < TOWER_W; x++) must(t.place("floor", f, x).ok, `floor ${f},${x}`);

// One standard elevator serving the whole stub (x0).
const shaft = t.placeTransport("elevatorStandard", 0, 1, TOP);
must(shaft.ok, `shaft: ${shaft.reason}`);

// The rooms. Each entry: kind, floor, x, and the rent value we want the TDT
// class byte to encode (buildTDT snaps our dollar value to the nearest class).
type Room = { kind: FacilityKind; floor: number; x: number; rent: number; tag: string };
const rooms: Room[] = [
  { kind: "office", floor: 2, x: 6, rent: 2_000, tag: "office Very Low" },
  { kind: "office", floor: 2, x: 16, rent: 5_000, tag: "office Low" },
  { kind: "office", floor: 3, x: 6, rent: 10_000, tag: "office Average" },
  { kind: "office", floor: 3, x: 16, rent: 15_000, tag: "office High" },
  { kind: "hotelSingle", floor: 4, x: 6, rent: 2_000, tag: "single Average" },
  { kind: "hotelDouble", floor: 4, x: 12, rent: 3_000, tag: "double Average" },
  { kind: "hotelSuite", floor: 4, x: 19, rent: 6_000, tag: "suite Average" },
  { kind: "condo", floor: 5, x: 6, rent: 150_000, tag: "condo Average" },
];
for (const r of rooms) must(t.place(r.kind, r.floor, r.x).ok, `place ${r.tag}`);

const save: SerializedGame = sim.serialize();

// Set each room's rent (so the class byte encodes the intended rung) and seed
// it occupied so the real game renders (a zero-tenant export renders black).
// EMPTY_ROOMS=1 exports the rooms VACANT (rent class preserved) so the retail
// game moves its OWN tenants in over a few in-game days, yielding a genuinely
// populated tower whose per-unit info windows are safe to open (an imported
// "occupied" room renders occupied art but the game never instantiates its
// tenant, so live Pop stays 0 and an info window divides by zero). The default
// seeds occupied for a quick render check.
const seedOccupied = process.env.EMPTY_ROOMS !== "1";
for (const u of save.units) {
  const spec = rooms.find((r) => r.kind === u.kind && r.floor === u.floor && u.x === r.x);
  if (!spec) continue;
  u.rent = spec.rent; // sets the TDT rent-class byte regardless of occupancy
  if (seedOccupied) {
    u.state = "occupied";
    u.occupants = 1;
    u.everOccupied = true;
    u.satisfaction = 1;
  } else {
    u.state = "empty";
    u.occupants = 0;
    u.everOccupied = false;
  }
}
save.star = 3;
save.view = { tile: 10, floor: 3 };

const built = buildTDT(save);
mkdirSync(SAVES, { recursive: true });
const out = resolve(SAVES, "ECONVER.TDT");
writeFileSync(out, built.bytes);
console.log(`Wrote ${out} (${built.bytes.length} bytes; game filename ${built.report.filename}).`);
console.log("Rooms and intended rent classes:");
for (const r of rooms) console.log(`  ${r.tag.padEnd(16)} rent=$${r.rent.toLocaleString()} at floor ${r.floor}, x ${r.x}`);
const behind = built.report?.staysBehind ?? [];
if (behind.length) console.log(`stays behind: ${behind.length} (${behind.slice(0, 4).join("; ")})`);
