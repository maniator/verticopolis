/**
 * Inputs for the TDT differential test
 * (`src/tests/integration/conformanceWasmTdt.integration.test.ts`): saves to
 * export (fixtures, seeded towers the TypeScript engine builds and plays,
 * edge saves, numeric fields to poison) and the seeded mutations applied to
 * valid `.TDT` files before they are imported on both sides.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Simulation } from "../../engine/Simulation";
import { ALL_KINDS, GRID } from "../../engine/facilities";
import { RNG } from "../../engine/rng";
import type { FacilityKind, SerializedGame } from "../../engine/types";
import {
  TDT_ELEVATOR_HEADER_SIZE,
  TDT_ELEVATOR_SLOTS,
  TDT_FLOOR_COUNT,
  TDT_FLOOR_INDEX_ENTRIES,
  TDT_HEADER_SIZE,
  TDT_PERSON_RECORD_SIZE,
  TDT_RETAIL_RECORD_SIZE,
  TDT_RETAIL_SLOTS,
  TDT_STAMP_MAGIC,
  TDT_TENANT_RECORD_SIZE,
} from "../../storage/tdtFormat";
import { builtShaftPayloadSize } from "../../storage/tdtConstants";
import { decodeVctower } from "../../storage/vctowerContainer";

const REPO_ROOT = resolve(__dirname, "../../..");

/** The JSON round trip the lock applies to hand-built saves. */
export const viaJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function fixtureSave(file: string): SerializedGame {
  const raw = decodeVctower(readFileSync(resolve(REPO_ROOT, file), "utf8"), file) as SerializedGame;
  return Simulation.deserialize(raw).serialize();
}

const STRUCTURE = new Set<string>(["lobby", "floor"]);
const SHAFTS: FacilityKind[] = ["elevatorStandard", "elevatorService", "elevatorExpress", "stairs", "escalator"];
const ROOMS = ALL_KINDS.filter((k) => !STRUCTURE.has(k) && !SHAFTS.includes(k));

/** A tower the TypeScript engine builds from a seed: paved stories above and
 *  below the lobby, a random mix of rooms, shafts with random car counts, a
 *  random balance and star, then a few days of play. Build refusals are part
 *  of the draw (the engine decides what fits); the tower that results is what
 *  both exporters see. */
export function seededTower(seed: number, mode: "classic" | "modern"): SerializedGame {
  const rng = new RNG(seed);
  const sim = Simulation.newGame(seed, mode);
  sim.money = 2_000_000_000;
  const width = rng.int(24, 200);
  const left = Math.max(0, Math.floor(GRID.width / 2 - width / 2) + rng.int(-40, 40));
  const right = Math.min(GRID.width - 1, left + width - 1);
  const top = rng.int(1, rng.chance(0.2) ? 60 : 20);
  const depth = rng.int(0, 9);
  const paveRow = (kind: "lobby" | "floor", floor: number) => {
    for (let x = left; x <= right; x++) sim.build(kind, floor, x);
  };
  paveRow("lobby", 1);
  for (let f = 2; f <= top; f++) paveRow(f % 15 === 0 && rng.chance(0.5) ? "lobby" : "floor", f);
  for (let f = 0; f >= 1 - depth; f--) paveRow("floor", f);
  const placements = rng.int(5, 80);
  for (let i = 0; i < placements; i++) {
    sim.build(rng.pick(ROOMS), rng.int(1 - depth, top), rng.int(left, right));
  }
  const shafts = rng.int(0, 10);
  for (let i = 0; i < shafts; i++) {
    const kind = rng.pick(SHAFTS);
    const bottom = rng.int(1 - depth, top);
    const span = kind === "stairs" || kind === "escalator" ? 1 : rng.int(1, 40);
    const x = rng.int(left, right);
    const r = sim.buildTransport(kind, x, bottom, Math.min(top, bottom + span));
    if (r.ok && kind.startsWith("elevator")) {
      const t = sim.tower.transportAt(bottom, x);
      if (t) sim.tower.setCars(t.id, rng.int(1, 8));
    }
  }
  sim.money = rng.pick([0, 1, -1, 5_000, 2_000_000, rng.int(-1_000_000, 50_000_000), 2_147_483_647 * 100]);
  sim.star = rng.int(1, 6);
  const days = rng.int(0, 2);
  for (let i = 0; i < days * 48 + rng.int(0, 47); i++) sim.tick(30);
  return sim.serialize();
}

/** Saves at the edges of what the exporter is asked to write. */
export function edgeSaves(base: SerializedGame): [string, unknown][] {
  const out: [string, unknown][] = [];
  const patch = (id: string, p: Record<string, unknown>) => out.push([id, { ...viaJson(base), ...p }]);
  const without = (id: string, ...keys: string[]) => {
    const s = viaJson(base) as unknown as Record<string, unknown>;
    for (const k of keys) delete s[k];
    out.push([id, s]);
  };
  patch("empty", { units: [], transports: [], nextId: 1 });
  patch("empty-modern", { units: [], transports: [], nextId: 1, mode: "modern" });
  for (const m of [0, -1, -100, -0.5, 0.01, 99.99, 1e15, -1e15, 2_147_483_647, -2_147_483_648, 214_748_364_700, 214_748_364_800, -214_748_364_900, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 1e300]) {
    patch(`money-${m}`, { money: m });
  }
  for (const s of [-1, 0, 1, 2, 3, 4, 5, 6, 7, 2.5, 1000]) patch(`star-${s}`, { star: s });
  for (const m of [0, 1, 59, 1439, 1440, 7 * 60 + 0.5, 1440 * 365, 1440 * 32767, 1440 * 32768, 1440 * 65536, 2 ** 31 * 1440, 2 ** 31 * 1440 + 1440 * 3 + 17, 2 ** 32 * 1440, 2 ** 53 - 1, -1, -1440]) {
    patch(`minutes-${m}`, { minutes: m });
  }
  for (const name of ["", "Zoë's Tower", "塔", "Tower 🏢", "\u0000\u0001", "a".repeat(300), "Ünïcödé façade ß", "  spaced  ", "C:\\path\\name"]) {
    patch(`name-${JSON.stringify(name).slice(0, 24)}`, { towerName: name });
  }
  patch("view-extreme", { view: { tile: 1e9, floor: -1e9 } });
  patch("view-fraction", { view: { tile: 0.5, floor: 0.5 } });
  without("no-view", "view");
  without("no-name", "towerName");
  without("no-flags", "builtWeddingHall", "evaluatedTower");
  without("no-money", "money");
  without("no-star", "star");
  without("no-minutes", "minutes");
  without("no-units", "units");
  without("no-transports", "transports");
  patch("mode-unknown", { mode: "arcade" });
  patch("units-null", { units: null });
  patch("money-string", { money: "100" });
  return out;
}

/** Every numeric leaf of a save, as a path; units and transports are sampled
 *  so the sweep stays bounded. */
export function numericPaths(save: SerializedGame, rng: RNG, perList: number): (string | number)[][] {
  const paths: (string | number)[][] = [];
  const walk = (v: unknown, path: (string | number)[]) => {
    if (typeof v === "number") paths.push(path);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
  };
  for (const [k, v] of Object.entries(save)) {
    if (k === "units" || k === "transports") continue;
    walk(v, [k]);
  }
  const pickIndexes = (n: number, max: number): number[] => {
    if (n <= max) return Array.from({ length: n }, (_, i) => i);
    const s = new Set<number>();
    while (s.size < max) s.add(rng.int(0, n - 1));
    return [...s].sort((a, b) => a - b);
  };
  // Prefer rooms over paving, whose tiles are many and alike.
  const units = save.units.map((u, i) => [u, i] as const).filter(([u]) => u.kind !== "floor" && u.kind !== "lobby");
  for (const j of pickIndexes(units.length, perList)) walk(units[j][0], ["units", units[j][1]]);
  const paving = save.units.findIndex((u) => u.kind === "floor" || u.kind === "lobby");
  if (paving >= 0) walk(save.units[paving], ["units", paving]);
  for (const j of pickIndexes(save.transports.length, perList)) walk(save.transports[j], ["transports", j]);
  return paths;
}

export function setPath(obj: unknown, path: (string | number)[], value: unknown): void {
  let at = obj as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) at = at[k] as Record<string | number, unknown>;
  at[path[path.length - 1]] = value;
}

// ---- Mutation fuzz ----------------------------------------------------------

/** Byte offsets of the fields a mutation aims at, found by walking the
 *  layout the way the reader does (as far as the walk gets). */
export interface Fields {
  u16: number[];
  u32: number[];
  u8: number[];
  floors: [number, number][];
  tenants: number[];
  boundaries: number[];
}

export function fieldsOf(b: Uint8Array): Fields {
  const f: Fields = { u16: [2, 0x14, 0x26, 0x28], u32: [4, 0x16], u8: [], floors: [], tenants: [], boundaries: [TDT_HEADER_SIZE] };
  const u16 = (o: number) => b[o] | (b[o + 1] << 8);
  let o = TDT_HEADER_SIZE;
  for (let i = 0; i < TDT_FLOOR_COUNT; i++) {
    if (o + 6 > b.length) return f;
    const n = u16(o);
    f.u16.push(o, o + 2, o + 4);
    const end = o + 6 + n * TDT_TENANT_RECORD_SIZE + TDT_FLOOR_INDEX_ENTRIES * 2;
    for (let t = 0; t < n; t++) {
      const r = o + 6 + t * TDT_TENANT_RECORD_SIZE;
      f.tenants.push(r);
      f.u16.push(r, r + 2);
      f.u8.push(r + 4, r + 5, r + 6, r + 16, r + 17);
    }
    f.floors.push([o, end]);
    o = end;
    f.boundaries.push(o);
    if (o > b.length) return f;
  }
  if (o + 4 > b.length) return f;
  f.u32.push(o);
  const people = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  o += 4 + people * TDT_PERSON_RECORD_SIZE;
  f.boundaries.push(o);
  o += TDT_RETAIL_SLOTS * TDT_RETAIL_RECORD_SIZE;
  f.boundaries.push(o);
  for (let s = 0; s < TDT_ELEVATOR_SLOTS && o + TDT_ELEVATOR_HEADER_SIZE <= b.length; s++) {
    f.u8.push(o, o + 1, o + 2, o + 3, o + 62, o + 63);
    f.u16.push(o + 60);
    const used = b[o];
    const topF = b[o + 62];
    const bottomF = b[o + 63];
    o += TDT_ELEVATOR_HEADER_SIZE;
    if (used !== 0) {
      if (topF < bottomF) return f;
      o += builtShaftPayloadSize(bottomF, topF);
    }
    f.boundaries.push(o);
  }
  // Stairs records and the stamp trailer sit somewhere after the table; the
  // stamp is found by its magic.
  const text = String.fromCharCode(...b.subarray(Math.max(0, b.length - 64)));
  const at = text.lastIndexOf(TDT_STAMP_MAGIC);
  if (at >= 0) {
    const s = Math.max(0, b.length - 64) + at;
    f.u16.push(s + TDT_STAMP_MAGIC.length);
    f.u8.push(s);
    f.boundaries.push(s);
  }
  return f;
}

const U16_EXTREMES = [0, 1, 0x7f, 0x80, 0xff, 0x100, 0x101, 0x7fff, 0x8000, 0xfffe, 0xffff];
const U32_EXTREMES = [0, 1, 0x7fffffff, 0x80000000, 0xffffffff, 100_000, 100_001, 0x10000];
const U8_EXTREMES = [0, 1, 2, 3, 7, 8, 9, 0x7f, 0x80, 0xfe, 0xff];

function splice(b: Uint8Array, at: number, del: number, ins: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(b.length - del + ins.length);
  out.set(b.subarray(0, at));
  out.set(ins, at);
  out.set(b.subarray(at + del), at + ins.length);
  return out;
}

export function mutateOnce(b: Uint8Array, rng: RNG, f: Fields): [string, Uint8Array] {
  const out = b.slice();
  const anywhere = () => rng.int(0, Math.max(0, b.length - 1));
  const near = () => Math.max(0, Math.min(b.length, rng.pick(f.boundaries) + rng.int(-3, 3)));
  const junk = (n: number) => Uint8Array.from({ length: n }, () => (rng.chance(0.3) ? rng.pick([0, 0xff]) : rng.int(0, 255)));
  switch (rng.int(0, 11)) {
    case 0: {
      const n = rng.int(1, 4);
      for (let i = 0; i < n; i++) out[anywhere()] = rng.int(0, 255);
      return ["flip", out];
    }
    case 1: {
      const o = anywhere();
      out[o] ^= 1 << rng.int(0, 7);
      return ["bit", out];
    }
    case 2:
      return ["truncate", b.slice(0, rng.chance(0.5) ? anywhere() : near())];
    case 3: {
      const at = rng.chance(0.5) ? anywhere() : near();
      return ["insert", splice(b, at, 0, junk(rng.pick([1, 2, 18, rng.int(1, 64)])))];
    }
    case 4: {
      const at = rng.chance(0.5) ? anywhere() : near();
      return ["delete", splice(b, at, Math.min(b.length - at, rng.pick([1, 2, 18, rng.int(1, 256)])))];
    }
    case 5:
    case 6: {
      if (f.u16.length === 0) return ["flip", out];
      const o = rng.pick(f.u16);
      if (o + 1 >= out.length) return ["u16", out];
      const v = rng.pick(U16_EXTREMES);
      out[o] = v & 0xff;
      out[o + 1] = v >> 8;
      return ["u16", out];
    }
    case 7: {
      const o = rng.pick(f.u32);
      if (o + 3 >= out.length) return ["u32", out];
      const v = rng.pick(U32_EXTREMES);
      for (let i = 0; i < 4; i++) out[o + i] = (v >>> (8 * i)) & 0xff;
      return ["u32", out];
    }
    case 8: {
      if (f.u8.length === 0) return ["flip", out];
      const o = rng.pick(f.u8);
      if (o < out.length) out[o] = rng.pick(U8_EXTREMES);
      return ["u8", out];
    }
    case 9: {
      // Swap two tenant records (same size, maybe on different floors).
      if (f.tenants.length < 2) return ["flip", out];
      const a = rng.pick(f.tenants);
      const c = rng.pick(f.tenants);
      if (a + TDT_TENANT_RECORD_SIZE > b.length || c + TDT_TENANT_RECORD_SIZE > b.length) return ["swapTenant", out];
      out.set(b.subarray(a, a + TDT_TENANT_RECORD_SIZE), c);
      out.set(b.subarray(c, c + TDT_TENANT_RECORD_SIZE), a);
      return ["swapTenant", out];
    }
    case 10: {
      // Swap two whole floor records (their lengths may differ).
      if (f.floors.length < 2) return ["flip", out];
      let [a, c] = [rng.pick(f.floors), rng.pick(f.floors)];
      if (a[0] > c[0]) [a, c] = [c, a];
      if (a[0] === c[0] || c[1] > b.length) return ["swapFloor", out];
      const parts = [b.subarray(0, a[0]), b.subarray(c[0], c[1]), b.subarray(a[1], c[0]), b.subarray(a[0], a[1]), b.subarray(c[1])];
      const joined = new Uint8Array(b.length);
      let o = 0;
      for (const p of parts) {
        joined.set(p, o);
        o += p.length;
      }
      return ["swapFloor", joined];
    }
    default: {
      // Swap two random equal-size chunks, or duplicate one over another.
      const n = rng.pick([2, 4, 18, 194, rng.int(1, 512)]);
      if (b.length <= n * 2) return ["swapChunk", out];
      const a = rng.int(0, b.length - n);
      const c = rng.int(0, b.length - n);
      out.set(b.subarray(a, a + n), c);
      if (rng.chance(0.5)) out.set(b.subarray(c, c + n), a);
      return ["swapChunk", out];
    }
  }
}

/** Values a forged save can put in a numeric field. */
export const FORGED: unknown[] = ["12", " 12 ", "\uFEFF7", "0x10", "0o7", "0b11", "1e2", "Infinity", "-Infinity", "infinity", "", "abc", true, false, null, [5], ["5"], [], {}, -0, 1.5, 1e21];

export const FILENAMES = ["TOWER.TDT", "tower.tdt", "Zoë 塔.TDT", "", "a.b.c.TDT", "no-extension", "C:\\SIMTOWER\\MY TOWER.TDT", "x".repeat(200) + ".TDT"];
