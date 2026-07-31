// TEMP scratch: measure a REAL game-written .TDT — burned (type 48) records and
// the elevator table stride when shafts have non-serviced (skipped) floors.
import { readFileSync } from "node:fs";
import {
  TDT_FLOOR_COUNT,
  TDT_FLOOR_INDEX_ENTRIES,
  TDT_HEADER_SIZE,
  TDT_TENANT_RECORD_SIZE,
  TDT_ELEVATOR_SLOTS,
  TDT_ELEVATOR_HEADER_SIZE,
  TDT_ELEVATOR_BUILT_FIXED,
  TDT_ELEVATOR_PER_FLOOR_SIZE,
  TDT_ELEVATOR_CAR_BLOCK_SIZE,
  TDT_PERSON_RECORD_SIZE,
  TDT_RETAIL_SLOTS,
  TDT_RETAIL_RECORD_SIZE,
  TDT_FLOOR_OFFSET,
} from "./src/storage/tdtConstants";

const buf = readFileSync(process.argv[2]);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
console.log(`=== ${process.argv[2]} (${buf.length} bytes) ===`);

let o = 0;
const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };

o = TDT_HEADER_SIZE;
// ---- floor map ----
const burned: { floor: number; left: number; right: number; bytes: number[] }[] = [];
const typeHist: Record<number, number> = {};
for (let i = 0; i < TDT_FLOOR_COUNT; i++) {
  const count = u16();
  u16(); u16(); // edges
  for (let t = 0; t < count; t++) {
    const rec = o;
    const left = dv.getUint16(o, true);
    const right = dv.getUint16(o + 2, true);
    const type = dv.getInt8(o + 4);
    typeHist[type] = (typeHist[type] ?? 0) + 1;
    if (type === 48) burned.push({ floor: i - TDT_FLOOR_OFFSET, left, right, bytes: [...buf.subarray(rec, rec + TDT_TENANT_RECORD_SIZE)] });
    o += TDT_TENANT_RECORD_SIZE;
  }
  o += TDT_FLOOR_INDEX_ENTRIES * 2;
}
console.log("floor map ends at", o.toString(16));
console.log("type histogram:", JSON.stringify(typeHist));
console.log(`\nBURNED (type 48) records: ${burned.length}`);
for (const b of burned.slice(0, 20))
  console.log(`  floor ${String(b.floor).padStart(3)} left=${b.left} right=${b.right} width=${b.right - b.left} bytes=[${b.bytes.join(",")}]`);

// ---- people ----
const people = u32();
console.log(`\npeople count = ${people}`);
o += people * TDT_PERSON_RECORD_SIZE;
// ---- retail ----
o += TDT_RETAIL_SLOTS * TDT_RETAIL_RECORD_SIZE;
console.log("elevator table starts at", o.toString(16));

// ---- elevators, both stride rules ----
function walk(rule: "serviced" | "span") {
  let p = o;
  const rows: string[] = [];
  let sane = 0;
  for (let s = 0; s < TDT_ELEVATOR_SLOTS; s++) {
    if (p + TDT_ELEVATOR_HEADER_SIZE > buf.length) { rows.push(`  slot ${s}: PAST EOF`); break; }
    const used = buf[p];
    const type = buf[p + 1];
    const cap = buf[p + 2];
    const cars = buf[p + 3];
    const x = dv.getUint16(p + 62, true);
    const top = buf[p + 64];
    const bottom = buf[p + 65];
    let serviced = 0;
    for (let f = 0; f < 120; f++) if (buf[p + 66 + f]) serviced++;
    const span = top - bottom + 1;
    const ok = (used === 0 || used === 1) && type <= 2 && cars >= 1 && cars <= 8 && top > bottom && x < 1000;
    if (ok) sane++;
    rows.push(
      `  slot ${String(s).padStart(2)} @0x${p.toString(16)} used=${used} type=${type} cap=${cap} cars=${cars} x=${x} bottom=${bottom} top=${top} span=${span} servicedBits=${serviced} ${ok ? "" : "  <-- IMPLAUSIBLE"}`,
    );
    p += TDT_ELEVATOR_HEADER_SIZE;
    if (used) {
      const n = rule === "serviced" ? serviced : span;
      p += TDT_ELEVATOR_BUILT_FIXED + n * TDT_ELEVATOR_PER_FLOOR_SIZE + TDT_ELEVATOR_CAR_BLOCK_SIZE;
    }
  }
  console.log(`\n--- stride rule: ${rule} (plausible slots: ${sane}/${TDT_ELEVATOR_SLOTS}) ---`);
  console.log(rows.join("\n"));
  return { end: p, sane };
}
const a = walk("serviced");
const b = walk("span");
console.log(`\nend offsets: serviced=0x${a.end.toString(16)} span=0x${b.end.toString(16)} fileLen=0x${buf.length.toString(16)}`);
