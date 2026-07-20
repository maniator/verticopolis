// #503 ride-budget CEILING probe. Four zoned standard shafts (1-4, 4-7, 7-10,
// 10-13), no express/stairs, so band k needs exactly k boardings. Bands 1-2 are
// seeded occupied (a population source so the export renders; a 0-pop export
// goes black, see #510). Bands 3 and 4 start EMPTY as rent-in probes:
//   - band 3 (floor 9, 3 rides): control - should rent (>=3 already confirmed).
//   - band 4 (floor 12, 4 rides): the test - rents iff the real ceiling >= 4.
// A vacant office fills only if reachable, so whether floor 12 rents pins the
// ceiling at exactly 3 (stays vacant) or >= 4 (fills).
//
// Usage:  npx tsx tools/simtower/build-ridebudget-ceiling.ts
// Writes: tools/simtower/saves/TESTCEIL.TDT
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Simulation } from "../../src/engine/Simulation";
import { Crowd } from "../../src/engine/Crowd";
import { buildTDT } from "../../src/storage/tdtExport";
import type { SerializedGame } from "../../src/engine/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAVES = resolve(HERE, "saves");
// N zoned standard shafts, each spanning 3 floors: zone k = [3k-2 .. 3k+1].
// Band k sits at floor 3k and needs exactly k boardings. Zones share transfer
// floors (4, 7, 10, ...). ZONES env (default 4) sets how high we probe.
const ZONES = Math.max(2, Number(process.env.ZONES ?? 4) | 0);
const TOP = 3 * ZONES + 1;
const TOWER_W = Math.max(36, 6 * ZONES + 12);
const OFFICE_X = 6 * ZONES; // right of every shaft (shafts at x 0,6,12,...,6(N-1))
const BANDS = Array.from({ length: ZONES }, (_, i) => {
  const k = i + 1;
  return { name: `band${k}`, floor: 3 * k, rides: k, seed: k <= 2 }; // seed the first two for population
});

function must(ok: boolean, m: string): void { if (!ok) throw new Error(m); }

const sim = new Simulation(777, "classic");
const t = sim.tower;
for (let x = 0; x < TOWER_W; x++) must(t.place("lobby", 1, x).ok, `lobby 1,${x}`);
for (let f = 2; f <= TOP; f++) for (let x = 0; x < TOWER_W; x++) must(t.place("floor", f, x).ok, `floor ${f},${x}`);
for (let k = 0; k < ZONES; k++) {
  const bottom = 3 * k + 1; // 1, 4, 7, ...
  must(t.placeTransport("elevatorStandard", 6 * k, bottom, bottom + 3).ok, `zone ${k + 1}`);
}
const officeFloors = new Set<number>();
for (const b of BANDS) { must(t.place("office", b.floor, OFFICE_X).ok, `office ${b.name}`); officeFloors.add(b.floor); }

const crowd = new Crowd();
console.log("OUR ROUTER (Classic, current ride budget) from floor 1:");
for (const b of BANDS) console.log(`  ${b.name} floor ${b.floor} (${b.rides} rides): ${crowd.reachable(t, 1, b.floor) ? "REACHABLE" : "REFUSED"}`);

const save: SerializedGame = sim.serialize();
const seedFloors = new Set(BANDS.filter((b) => b.seed).map((b) => b.floor));
for (const u of save.units) {
  if (u.kind !== "office" || !officeFloors.has(u.floor)) continue;
  if (seedFloors.has(u.floor)) { u.state = "occupied"; u.occupants = 6; u.everOccupied = true; u.satisfaction = 1; }
  else { u.state = "empty"; u.occupants = 0; u.everOccupied = false; }
}
save.star = 3;
// Center on the TOP band (the ceiling test) so the tallest probe is in frame.
save.view = { tile: OFFICE_X, floor: 3 * ZONES - 2 };
const built = buildTDT(save);
mkdirSync(SAVES, { recursive: true });
const out = resolve(SAVES, "TESTCEIL.TDT");
writeFileSync(out, built.bytes);
console.log(`Wrote ${out} (${built.bytes.length} bytes; game filename ${built.report.filename}).`);
