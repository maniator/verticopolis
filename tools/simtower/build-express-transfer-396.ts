// #396 verification harness fixture builder.
//
// Tests whether the 1994 original really forbids an express<->local transfer at
// a NON-lobby floor (our Classic gate, GameRules.expressTransferNeedsLobby,
// shipped from web guides in #396). Design:
//   - Express E spans 1..22; it stops at lobbies (1, 15) AND its terminus 22
//     (a non-lobby floor).
//   - Local M spans 15..21 (from sky lobby 15). Local L spans 22..28 (from the
//     express terminus 22).
//   - CONTROL office floor 20: reachable via E->(lobby 15)->M. Transfer at a
//     lobby, so our gate ALLOWS it: reachable in both modes.
//   - TEST office floor 26: reachable ONLY via E->(non-lobby 22)->L. Our gate
//     REFUSES the transfer at 22, so our router calls it unreachable. Both legs
//     are within MAX_RIDES=2, so the ride budget is NOT the cause: the express
//     lobby gate is the only thing refusing it.
// If the real game keeps floor-26 tenanted / rents it out, our lobby gate is
// too strict (a #396 over-restriction). If floor 26 stays vacant while floor 20
// fills, the gate matches the original.
//
// Usage:  [EMPTY_OFFICES=1] npx tsx tools/simtower/build-express-transfer-396.ts
// Writes: tools/simtower/saves/TESTXF.TDT
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Simulation } from "../../src/engine/Simulation";
import { Crowd } from "../../src/engine/Crowd";
import { buildTDT } from "../../src/storage/tdtExport";
import type { SerializedGame } from "../../src/engine/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAVES = resolve(HERE, "saves");
const TOWER_W = 30;
const TOP = 28; // only floors 1 and 15 are (sky) lobbies (15 % 15 === 0; 30 is out of range)
const CONTROL = { name: "control(lobby xfer)", floor: 20, x: 18 }; // E->15->M
const TEST = { name: "test(non-lobby xfer)", floor: 26, x: 18 }; // E->22->L

function must(ok: boolean, msg: string): void {
  if (!ok) throw new Error(msg);
}

const sim = new Simulation(4242, "classic");
const t = sim.tower;
for (let x = 0; x < TOWER_W; x++) must(t.place("lobby", 1, x).ok, `lobby 1,${x}`);
for (let f = 2; f <= TOP; f++) {
  const kind = f % 15 === 0 ? "lobby" : "floor";
  for (let x = 0; x < TOWER_W; x++) must(t.place(kind, f, x).ok, `${kind} ${f},${x}`);
}
const E = t.placeTransport("elevatorExpress", 0, 1, 22); // stops 1,15,22 (terminus non-lobby)
const M = t.placeTransport("elevatorStandard", 6, 15, 21); // local off the sky lobby
const L = t.placeTransport("elevatorStandard", 12, 22, 28); // local off the express terminus
must(E.ok, `express: ${E.reason}`);
must(M.ok, `localM: ${M.reason}`);
must(L.ok, `localL: ${L.reason}`);

const officeFloors = new Set<number>();
for (const o of [CONTROL, TEST]) {
  must(t.place("office", o.floor, o.x).ok, `office ${o.name}`);
  officeFloors.add(o.floor);
}

const crowd = new Crowd();
console.log("OUR ROUTER (Classic, express-transfer-needs-lobby) from floor 1:");
for (const o of [CONTROL, TEST]) {
  const ok = crowd.reachable(t, 1, o.floor);
  console.log(`  ${o.name} floor ${o.floor}: ${ok ? "REACHABLE" : "REFUSED"}`);
}

const save: SerializedGame = sim.serialize();
// Modes:
//   default        : both offices seeded occupied.
//   EMPTY_OFFICES=1: both empty (assumption-free rent-in; but a 0-population
//                    export renders black in the harness).
//   MIXED=1        : control (floor 20) seeded occupied, TEST (floor 26) empty,
//                    so population is nonzero (renders) AND the route-gated
//                    move-in is still what decides whether floor 26 ever fills.
const mixed = process.env.MIXED === "1";
const emptyAll = process.env.EMPTY_OFFICES === "1";
if (mixed && emptyAll) {
  console.error("Set only one of MIXED=1 or EMPTY_OFFICES=1, not both.");
  process.exit(2);
}
for (const u of save.units) {
  if (u.kind !== "office" || !officeFloors.has(u.floor)) continue;
  const isTest = u.floor === TEST.floor;
  const occupy = mixed ? !isTest : !emptyAll;
  if (occupy) {
    u.state = "occupied";
    u.occupants = 6;
    u.everOccupied = true;
    u.satisfaction = 1;
  } else {
    u.state = "empty";
    u.occupants = 0;
    u.everOccupied = false;
  }
}
save.star = 3;
save.view = { tile: 15, floor: 20 }; // frame floors ~14..27 (both offices + the transfer floors)
console.log(`mode=${mixed ? "MIXED" : emptyAll ? "EMPTY" : "seeded"}; camera at tile ${save.view.tile}, floor ${save.view.floor}.`);

const built = buildTDT(save);
mkdirSync(SAVES, { recursive: true });
const out = resolve(SAVES, "TESTXF.TDT");
writeFileSync(out, built.bytes);
console.log(`Wrote ${out} (${built.bytes.length} bytes; game filename ${built.report.filename}).`);
