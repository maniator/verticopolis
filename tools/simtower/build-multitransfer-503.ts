// #503 investigation harness fixture builder.
//
// Constructs a synthetic tower whose only path from the ground lobby to the
// top office band requires THREE elevator boardings (no whole-tower express
// shortcut: three standard shafts zoned 1..4, 4..7, 7..10; standard-to-standard
// transfers need no lobby, so the transfer floors 4 and 7 are plain floors,
// #396 gates express only). A short 10-floor tower frames cleanly in the Wine
// harness. Three office bands act as a reachability ladder:
//   - band 1 (floor 3): 1 ride  (control, always reachable)
//   - band 2 (floor 6): 2 rides (control, reachable under MAX_RIDES=2)
//   - band 3 (floor 9): 3 rides (the test; only reachable if the budget >= 3)
//
// It prints OUR router's verdict for each band (a fast, Docker-free check that
// the tower is a real discriminator: bands 1/2 reachable, band 3 refused under
// our current MAX_RIDES=2), then exports a .TDT for the Wine harness to load in
// the real 1994 game. The saved camera view centers on the bands so the game
// opens framed on them. Offices are marked occupied by default so the real game
// has commuters to route; EMPTY_OFFICES=1 leaves them vacant for the
// assumption-free "which bands rent out" read. Whether band 3 stays populated /
// rents tells us the original's true ride budget.
//
// Usage:  [EMPTY_OFFICES=1] npx tsx tools/simtower/build-multitransfer-503.ts
// Writes: tools/simtower/saves/TESTMR.TDT
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Simulation } from "../../src/engine/Simulation";
import { Crowd } from "../../src/engine/Crowd";
import { buildTDT } from "../../src/storage/tdtExport";
import type { SerializedGame } from "../../src/engine/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAVES = resolve(HERE, "saves");

const TOWER_W = 36;
const TOP = 10;
const SKY: number[] = []; // no sky lobbies; standard-standard transfers need no lobby (#396 gates express only)
const BANDS = [
  { name: "band1", floor: 3, rides: 1 },
  { name: "band2", floor: 6, rides: 2 },
  { name: "band3", floor: 9, rides: 3 },
];
const OFFICE_XS = [16, 25]; // two offices per band (width 9), just right of the shafts at x 0/6/12

function must(ok: boolean, msg: string): void {
  if (!ok) throw new Error(msg);
}

const sim = new Simulation(12345, "classic");
const t = sim.tower;

// Floors: lobby on 1 and every sky story, plain floor everywhere else, full width.
for (let x = 0; x < TOWER_W; x++) must(t.place("lobby", 1, x).ok, `lobby 1,${x}`);
for (let f = 2; f <= TOP; f++) {
  const kind = SKY.includes(f) ? "lobby" : "floor";
  for (let x = 0; x < TOWER_W; x++) must(t.place(kind, f, x).ok, `${kind} ${f},${x}`);
}

// Three zoned standard shafts (no express: no whole-tower shortcut exists).
const shaftA = t.placeTransport("elevatorStandard", 0, 1, 4);
const shaftB = t.placeTransport("elevatorStandard", 6, 4, 7);
const shaftC = t.placeTransport("elevatorStandard", 12, 7, TOP);
must(shaftA.ok, `shaftA: ${shaftA.reason}`);
must(shaftB.ok, `shaftB: ${shaftB.reason}`);
must(shaftC.ok, `shaftC: ${shaftC.reason}`);

// Offices in each band.
const officeFloors = new Set<number>();
for (const b of BANDS) {
  for (const x of OFFICE_XS) {
    const r = t.place("office", b.floor, x);
    must(r.ok, `office ${b.name} ${b.floor},${x}: ${r.reason}`);
  }
  officeFloors.add(b.floor);
}

// --- Discriminator check: OUR router's verdict for each band (no Docker). ---
const crowd = new Crowd();
console.log("OUR ROUTER (Classic, current ride budget) reachability from floor 1:");
for (const b of BANDS) {
  const ok = crowd.reachable(t, 1, b.floor);
  console.log(`  ${b.name} (floor ${b.floor}, needs ${b.rides} ride(s)): ${ok ? "REACHABLE" : "REFUSED"}`);
}

// Serialize, then mark the offices occupied so the real game has commuters.
const save: SerializedGame = sim.serialize();
// EMPTY_OFFICES=1 leaves the offices vacant so the assumption-free test is
// "which bands RENT OUT on their own" (a tenant only moves into a reachable
// office); the default seeds them occupied for the eviction-based read.
const seedOccupied = process.env.EMPTY_OFFICES !== "1";
let occupied = 0;
for (const u of save.units) {
  if (u.kind === "office" && officeFloors.has(u.floor)) {
    if (seedOccupied) {
      u.state = "occupied";
      u.occupants = 6;
      u.everOccupied = true;
      u.satisfaction = 1;
      occupied++;
    } else {
      u.state = "empty";
      u.occupants = 0;
      u.everOccupied = false;
    }
  }
}
save.star = 3; // let the loaded tower behave like an established building
// Center the saved camera on the office bands (floors 3/6/9, built columns
// x0..34) so the real game opens framed on them (the .TDT header persists the
// viewport at 0x26). Without this the serialized default camera sat at tile
// ~178, far right of this 36-wide tower, so the game opened on empty sky.
save.view = { tile: 16, floor: 6 };
console.log(`Marked ${occupied} office units occupied; camera centered at tile ${save.view.tile}, floor ${save.view.floor}.`);

const built = buildTDT(save);
mkdirSync(SAVES, { recursive: true });
const out = resolve(SAVES, "TESTMR.TDT");
writeFileSync(out, built.bytes);
console.log(`Wrote ${out} (${built.bytes.length} bytes; game filename ${built.report.filename}).`);
const behind = built.report?.staysBehind ?? [];
if (behind.length) console.log(`stays behind: ${behind.length} (${behind.slice(0, 4).join("; ")})`);
