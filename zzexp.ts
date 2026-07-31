// TEMP scratch: build differential experiment .TDTs for the real 1994 game.
//
//   EXPA.TDT  elevator per-floor entries = SERVICED floors (what we ship today)
//   EXPB.TDT  same tower, entries = SPANNED floors (bottom..top inclusive)
//
// The tower puts a floor-skipping shaft in slot 1 with two plain shafts after
// it, so a wrong stride hides slots 2-3 in the game. It also carries burned
// (type 48) areas in three shapes so one render answers the charred-room
// question too: one wide record, a strip of 1-tile records, and a control row.
import { writeFileSync } from "node:fs";
import { buildTDT } from "./src/storage/tdtExport";
import {
  TDT_ELEVATOR_BUILT_FIXED,
  TDT_ELEVATOR_CAR_BLOCK_SIZE,
  TDT_ELEVATOR_HEADER_SIZE,
  TDT_ELEVATOR_PER_FLOOR_SIZE,
  TDT_ELEVATOR_SLOTS,
  TDT_FLOOR_COUNT,
  TDT_FLOOR_INDEX_ENTRIES,
  TDT_HEADER_SIZE,
  TDT_PERSON_RECORD_SIZE,
  TDT_RETAIL_RECORD_SIZE,
  TDT_RETAIL_SLOTS,
  TDT_TENANT_RECORD_SIZE,
} from "./src/storage/tdtConstants";

const LEFT = 100; // lot column the test tower starts at
let id = 1;
const units: any[] = [];
const push = (u: any) => units.push({ id: id++, satisfaction: 0.6, everOccupied: true, ...u });

// Ground lobby across the tower's footprint.
for (let x = LEFT; x < LEFT + 80; x++) push({ kind: "lobby", floor: 1, x, width: 1, state: "occupied" });

// Floors 2..12: four occupied offices each (population, so the game renders).
for (let fl = 2; fl <= 12; fl++) {
  for (let i = 0; i < 4; i++) {
    push({
      kind: "office",
      floor: fl,
      x: LEFT + 40 + i * 9,
      width: 9,
      state: "occupied",
      rent: 15000,
      occupants: 6,
    });
  }
}

// Burned shapes. Floor 3: one 9-wide gutted office (today's encoding).
push({ kind: "office", floor: 3, x: LEFT + 4, width: 9, state: "gutted", rent: 15000 });
// Floor 5: the same 9 tiles as nine 1-tile gutted records.
for (let i = 0; i < 9; i++) push({ kind: "office", floor: 5, x: LEFT + 4 + i, width: 1, state: "gutted", rent: 15000 });
// Floor 7: healthy office in the same spot (control row).
push({ kind: "office", floor: 7, x: LEFT + 4, width: 9, state: "occupied", rent: 15000, occupants: 6 });

// Shafts: slot 0 plain, slot 1 SKIPS floors 4-8, slots 2-3 plain. A stride that
// under-counts slot 1's payload desyncs the table and hides slots 2-3.
const shaft = (x: number, skipFloors: number[]) => ({
  id: id++,
  kind: "elevatorStandard",
  x,
  width: 4,
  bottom: 1,
  top: 12,
  cars: 2,
  carPositions: [1, 1],
  carDir: [0, 0],
  load: 0,
  skipFloors,
});
const transports = [
  shaft(LEFT + 0, []),
  shaft(LEFT + 8, [4, 5, 6, 7, 8]),
  shaft(LEFT + 16, []),
  shaft(LEFT + 24, []),
];

const save: any = {
  version: 1,
  seed: 1,
  money: 2_000_000,
  star: 2,
  minutes: 60 * 12,
  mode: "classic",
  modernCalendar: false,
  lastQuarterMoney: 2_000_000,
  units,
  transports,
  nextId: id,
  towerName: "EXP",
  evaluatedTower: true,
  events: { rngState: 1, pending: null },
  excavated: 12,
  milestones: {},
  ledger: {},
  view: { x: 0, y: 0 },
  log: [],
};

const built = buildTDT(save);
writeFileSync("tools/simtower/saves/EXPA.TDT", built.bytes);
console.log(`EXPA.TDT ${built.bytes.length} bytes (serviced-floor stride, current code)`);

// ---- Splice variant B: pad each built shaft out to one entry per SPANNED floor.
function spanVariant(src: Uint8Array): Uint8Array {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  let o = TDT_HEADER_SIZE;
  for (let i = 0; i < TDT_FLOOR_COUNT; i++) {
    const count = dv.getUint16(o, true);
    o += 6 + count * TDT_TENANT_RECORD_SIZE + TDT_FLOOR_INDEX_ENTRIES * 2;
  }
  const people = dv.getUint32(o, true);
  o += 4 + people * TDT_PERSON_RECORD_SIZE + TDT_RETAIL_SLOTS * TDT_RETAIL_RECORD_SIZE;

  const out: number[] = [...src.subarray(0, o)];
  let p = o;
  for (let s = 0; s < TDT_ELEVATOR_SLOTS; s++) {
    const used = src[p];
    const top = src[p + 64];
    const bottom = src[p + 65];
    let serviced = 0;
    for (let f = 0; f < 120; f++) if (src[p + 66 + f]) serviced++;
    out.push(...src.subarray(p, p + TDT_ELEVATOR_HEADER_SIZE));
    p += TDT_ELEVATOR_HEADER_SIZE;
    if (!used) continue;
    const payload = TDT_ELEVATOR_BUILT_FIXED + serviced * TDT_ELEVATOR_PER_FLOOR_SIZE + TDT_ELEVATOR_CAR_BLOCK_SIZE;
    const span = top - bottom + 1;
    const extra = Math.max(0, (span - serviced) * TDT_ELEVATOR_PER_FLOOR_SIZE);
    out.push(...src.subarray(p, p + payload - TDT_ELEVATOR_CAR_BLOCK_SIZE));
    for (let k = 0; k < extra; k++) out.push(0); // the added per-floor entries
    out.push(...src.subarray(p + payload - TDT_ELEVATOR_CAR_BLOCK_SIZE, p + payload)); // car block stays last
    p += payload;
    if (extra) console.log(`  slot ${s}: serviced=${serviced} span=${span} (+${extra} bytes)`);
  }
  out.push(...src.subarray(p));
  return new Uint8Array(out);
}

const b = spanVariant(built.bytes);
writeFileSync("tools/simtower/saves/EXPB.TDT", b);
console.log(`EXPB.TDT ${b.length} bytes (spanned-floor stride)`);
