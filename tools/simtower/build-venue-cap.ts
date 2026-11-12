// Party hall and theater cap fixture builder (#1932).
//
// The .TDT venue table holds 16 records, one per party hall or theater. This
// builds a Classic tower at 3 stars with exactly 16 venues (8 theaters and 8
// party halls) and an empty pair of floors above them, so a player in the 1994
// game can try to build a 17th. If the game refuses a 17th hall or theater,
// the two kinds share one cap of 16.
//
// Layout (tower width 120, floors 1..11), one standard elevator at x 0:
//   floors 2-3, 4-5, 6-7, 8-9: theater x 6, theater x 37, hall x 68, hall x 92
//   floors 10-11: empty floors, room for one more theater or hall
//
// Usage:  npx tsx tools/simtower/build-venue-cap.ts [theaters] [halls] [NAME]
// Writes: tools/simtower/saves/<NAME>.TDT (default 8 theaters, 8 halls, VENUE16)
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { draftTower } from "../../src/tests/portKit/drafts";
import { buildTDT } from "../../src/tests/conformance/tdtWasm";
import type { FacilityKind, SerializedGame } from "../../src/shared/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAVES = resolve(HERE, "saves");

const TOWER_W = 120;
const TOP = 11;

function must(ok: boolean, msg: string): void {
  if (!ok) throw new Error(msg);
}

const sim = draftTower(1932, "classic");
const t = sim.tower;
sim.star = 3;

for (let x = 0; x < TOWER_W; x++) must(t.place("lobby", 1, x).ok, `lobby 1,${x}`);
for (let f = 2; f <= TOP; f++)
  for (let x = 0; x < TOWER_W; x++) must(t.place("floor", f, x).ok, `floor ${f},${x}`);

const shaft = t.placeTransport("elevatorStandard", 0, 1, TOP);
must(shaft.ok, `shaft: ${shaft.reason}`);

const theaters = Number(process.argv[2] ?? 8);
const halls = Number(process.argv[3] ?? 8);
const name = process.argv[4] ?? "VENUE16";
must(theaters >= 0 && theaters <= 8 && halls >= 0 && halls <= 8, "0 to 8 theaters and 0 to 8 halls");
type Venue = { kind: FacilityKind; floor: number; x: number };
const venues: Venue[] = [];
const floors = [2, 4, 6, 8];
for (let i = 0; i < theaters; i++) venues.push({ kind: "cinema", floor: floors[Math.floor(i / 2)], x: i % 2 === 0 ? 6 : 37 });
for (let i = 0; i < halls; i++) venues.push({ kind: "partyHall", floor: floors[Math.floor(i / 2)], x: i % 2 === 0 ? 68 : 92 });
for (const v of venues) {
  const r = t.place(v.kind, v.floor, v.x);
  must(r.ok, `place ${v.kind} at floor ${v.floor}, x ${v.x}: ${r.reason}`);
}

const save: SerializedGame = sim.serialize();
save.star = 3;
save.view = { tile: 60, floor: 6 };

const built = buildTDT(save);
mkdirSync(SAVES, { recursive: true });
const out = resolve(SAVES, `${name}.TDT`);
writeFileSync(out, built.bytes);
const count = (k: FacilityKind) => save.units.filter((u) => u.kind === k).length;
console.log(`Wrote ${out} (${built.bytes.length} bytes; game filename ${built.report.filename}).`);
console.log(`Theaters ${count("cinema")}, party halls ${count("partyHall")}, star ${save.star}.`);
const behind = built.report?.staysBehind ?? [];
if (behind.length) console.log(`stays behind: ${behind.length} (${behind.slice(0, 4).join("; ")})`);
console.log(
  "READ: load it, then try to build a 17th theater and a 17th party hall on floors 10-11. Report whether each is refused, and the message if any.",
);
