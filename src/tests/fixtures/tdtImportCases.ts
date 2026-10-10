/**
 * The import half of the TDT conformance table
 * (`src/tests/integration/tdtCases.integration.test.ts`): every synthetic
 * `.TDT` the lock replays, built from the test builder (never bytes from a
 * real save), as `[id, bytes, filename?]`.
 */
import { TDT_HEADER_SIZE, TDT_STAMP_GENERATION, TDT_STAMP_MAGIC, TDT_STAMP_SIZE } from "../../storage/tdtFormat";
import { buildTdt, sampleTowerSpec, type TdtSpec } from "./tdtBuilder";

/** Append our trailer (magic + u16 generation) the way the exporter does. */
function withStamp(bytes: Uint8Array, generation: number): Uint8Array {
  const out = new Uint8Array(bytes.length + TDT_STAMP_SIZE);
  out.set(bytes);
  for (let i = 0; i < TDT_STAMP_MAGIC.length; i++) out[bytes.length + i] = TDT_STAMP_MAGIC.charCodeAt(i);
  const g = bytes.length + TDT_STAMP_MAGIC.length;
  out[g] = generation & 0xff;
  out[g + 1] = (generation >> 8) & 0xff;
  return out;
}

/** Byte offset of the first elevator slot in a built buffer. */
function elevatorTableOffset(bytes: Uint8Array): number {
  const u16 = (o: number) => bytes[o] | (bytes[o + 1] << 8);
  let o = TDT_HEADER_SIZE;
  for (let i = 0; i < 120; i++) o += 6 + u16(o) * 18 + 94 * 2;
  o += 4 + (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) * 16;
  return o + 512 * 18;
}

/** Tenant IDs whose kinds are basement-only; Cathedral parts crown floor 100. */
const BASEMENT_ONLY_IDS = new Set([11, 44, 20, 21, 31, 32, 33]);
const CATHEDRAL_IDS = new Set([36, 37, 38, 39, 40]);

function oneTenant(type: number, left = 100, right = 109, status = 0, extra: Partial<TdtSpec> = {}): TdtSpec {
  const id = Math.abs(type);
  let index = 20;
  if (BASEMENT_ONLY_IDS.has(id)) index = 6;
  else if (CATHEDRAL_IDS.has(id)) index = 109;
  return { ...extra, floors: [{ index, tenants: [{ left, right, type, status }] }] };
}

function cathedral(base: number): TdtSpec["floors"] {
  return Array.from({ length: 5 }, (_, i) => ({ index: base + i, tenants: [{ left: 180, right: 196, type: 36 + i }] }));
}

export function importInputs(): [string, Uint8Array, string?][] {
  const out: [string, Uint8Array, string?][] = [];
  const add = (id: string, spec: TdtSpec, filename?: string) => out.push([id, buildTdt(spec), filename]);
  add("sample", sampleTowerSpec(), "MY_TOWER.TDT");
  add("sample-other-name", sampleTowerSpec(), "C:\\GAMES\\SIM\\towers\\alpha-one.tdt");
  add("sample-unprintable-name", sampleTowerSpec(), "§§§.tdt");
  add("sample-long-name", sampleTowerSpec(), "a-very-long-tower-name-that-keeps-going.tdt");
  add("sample-synthesized", { ...sampleTowerSpec(), includeTransports: false });
  add("empty", {});
  add("no-retail", { includeRetail: false });
  add("retail-rows", { retailRows: 7 });
  add("balance-negative", { balance: -500 });
  add("frame-2300-day-5", { frameTime: 2300, currentDay: 5 });
  add("frame-2599-day-5", { frameTime: 2599, currentDay: 5 });
  add("frame-800", { frameTime: 800, floors: [{ index: 20, tenants: [{ left: 100, right: 104, type: 3, status: 16 | 1 }] }] });
  add("frame-out-of-range", { frameTime: 60_000 });
  add("day-negative", { currentDay: -12 });
  add("day-huge", { currentDay: 2_000_000 });
  add("level-0", { level: 0 });
  add("level-4", { level: 4 });
  add("level-6", { level: 6 });
  add("level-9", { level: 9 });
  add("view-words", { viewX: 1105, viewY: 3491 });
  add("view-words-extreme", { viewX: 60_000, viewY: 60_000 });
  // One tenant of every single-story type id and every multi-story part id.
  for (const id of [3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 17, 44]) add(`tenant-${id}`, oneTenant(id));
  for (const id of [18, 19, 34, 35, 20, 21, 29, 30, 31, 32, 33, 36, 40]) add(`part-${id}`, oneTenant(id));
  add("tunnel-45", oneTenant(45));
  add("unknown-50", oneTenant(50));
  add("construction-office", oneTenant(-7));
  add("construction-fastfood", oneTenant(-12, 100, 116));
  add("office-tenanted", oneTenant(7, 100, 109, 1));
  add("office-wide", oneTenant(7, 100, 112));
  add("condo-sold", oneTenant(9, 100, 113, 1));
  for (const status of [0, 1, 8, 17, 18, 19, 32, 48, 64, 255]) add(`hotel-status-${status}`, oneTenant(3, 100, 104, status));
  add("retail-variants", {
    floors: [
      {
        index: 20,
        tenants: [
          { left: 100, right: 112, type: 10, variant: 3, byte17: 1 },
          { left: 112, right: 128, type: 12, variant: 1 },
          { left: 128, right: 152, type: 6, variant: 4 },
          { left: 152, right: 164, type: 10, variant: 200 },
        ],
      },
    ],
  });
  add("rent-classes", {
    floors: [
      {
        index: 20,
        tenants: [
          { left: 100, right: 109, type: 7, rentRate: 0 },
          { left: 109, right: 118, type: 7, rentRate: 1 },
          { left: 118, right: 127, type: 7, rentRate: 3 },
          { left: 127, right: 136, type: 7, rentRate: 4 },
          { left: 136, right: 145, type: 7, rentRate: 9 },
          { left: 145, right: 157, type: 10, rentRate: 4 },
          { left: 157, right: 161, type: 3, rentRate: 7 },
        ],
      },
    ],
  });
  add("theatre-whole", {
    floors: [
      { index: 20, tenants: [{ left: 100, right: 127, type: 19 }, { left: 127, right: 131, type: 35 }] },
      { index: 21, tenants: [{ left: 100, right: 127, type: 18 }, { left: 127, right: 131, type: 34 }] },
    ],
  });
  add("cathedral-crown", { floors: cathedral(105) });
  add("cathedral-crown-level-5", { level: 5, currentDay: 10, floors: cathedral(105) });
  add("cathedral-crown-level-6", { level: 6, currentDay: 10, floors: cathedral(105) });
  add("cathedral-off-crown", { floors: cathedral(100) });
  add("recycling-far-apart", {
    floors: [
      { index: 3, tenants: [{ left: 100, right: 120, type: 21 }] },
      { index: 4, tenants: [{ left: 100, right: 120, type: 20 }] },
      { index: 6, tenants: [{ left: 100, right: 120, type: 21 }] },
      { index: 7, tenants: [{ left: 100, right: 120, type: 20 }] },
    ],
  });
  add("recycling-flush", {
    floors: [{ index: 5, tenants: [{ left: 100, right: 120, type: 21 }, { left: 120, right: 140, type: 21 }] }],
  });
  add("recycling-chain", {
    floors: [
      { index: 6, tenants: [{ left: 107, right: 127, type: 21 }] },
      { index: 7, tenants: [{ left: 107, right: 127, type: 20 }] },
      { index: 8, tenants: [{ left: 92, right: 112, type: 21 }, { left: 112, right: 132, type: 21 }] },
      { index: 9, tenants: [{ left: 92, right: 112, type: 20 }, { left: 112, right: 132, type: 20 }] },
    ],
  });
  add("recycling-adjacent-pairs", {
    floors: [
      { index: 3, tenants: [{ left: 100, right: 120, type: 21 }] },
      { index: 4, tenants: [{ left: 100, right: 120, type: 20 }] },
      { index: 5, tenants: [{ left: 100, right: 120, type: 21 }] },
      { index: 6, tenants: [{ left: 100, right: 120, type: 20 }] },
    ],
  });
  add("recycling-above-ground", {
    floors: [
      { index: 20, tenants: [{ left: 100, right: 120, type: 21 }] },
      { index: 21, tenants: [{ left: 100, right: 120, type: 20 }] },
    ],
  });
  add("cinema-upper-story-blocked", {
    floors: [
      { index: 20, tenants: [{ left: 100, right: 131, type: 19 }] },
      { index: 21, tenants: [{ left: 100, right: 109, type: 7 }] },
    ],
  });
  add("cinema-past-top", {
    floors: [
      { index: 109, tenants: [{ left: 100, right: 131, type: 19 }] },
      { index: 108, tenants: [{ left: 100, right: 109, type: 7 }] },
    ],
  });
  add("cinema-under-construction", {
    floors: [
      { index: 20, tenants: [{ left: 100, right: 131, type: -19 }] },
      { index: 21, tenants: [{ left: 100, right: 131, type: 18 }] },
    ],
  });
  add("metro-station", {
    floors: [
      { index: 0, tenants: [{ left: 0, right: 375, type: 33 }] },
      { index: 1, tenants: [{ left: 0, right: 375, type: 32 }] },
      { index: 2, tenants: [{ left: 0, right: 375, type: 31 }] },
    ],
  });
  add("parking-above-ground", { floors: [{ index: 20, tenants: [{ left: 100, right: 116, type: 44 }, { left: 116, right: 120, type: 11 }] }] });
  add("office-basement", { floors: [{ index: 6, tenants: [{ left: 100, right: 109, type: 7 }] }] });
  add("fastfood-ground", { floors: [{ index: 10, tenants: [{ left: 100, right: 116, type: 12 }] }] });
  add("basement-excavated", {
    floors: [
      { index: 9, tenants: [{ left: 100, right: 104, type: 11 }] },
      { index: 20, tenants: [{ left: 100, right: 109, type: 7 }] },
    ],
  });
  add("pave-floor", { floors: [{ index: 15, tenants: [{ left: 100, right: 120, type: 0 }] }] });
  add("pave-lobby", { floors: [{ index: 10, tenants: [{ left: 100, right: 120, type: 24 }] }] });
  add("pave-sky-lobby", { floors: [{ index: 24, leftEdge: 100, rightEdge: 110 }] });
  add("pave-plain", { floors: [{ index: 20, leftEdge: 100, rightEdge: 110 }] });
  add("burned", { floors: [{ index: 20, tenants: [{ left: 100, right: 109, type: 48 }, { left: 109, right: 118, type: 7 }] }] });
  add("floor-0", { floors: [{ index: 0, tenants: [{ left: 100, right: 109, type: 10 }] }] });
  add("floor-109", { floors: [{ index: 109, tenants: [{ left: 100, right: 109, type: 7 }] }] });
  add("floor-110-dropped", { floors: [{ index: 110, tenants: [{ left: 100, right: 109, type: 7 }] }] });
  add("overlapping-rooms", {
    floors: [
      { index: 20, tenants: [{ left: 100, right: 109, type: 7 }, { left: 105, right: 114, type: 7 }, { left: 114, right: 123, type: 7 }] },
    ],
  });
  add("off-lot-rooms", {
    floors: [
      { index: 20, tenants: [{ left: 400, right: 410, type: 7 }, { left: 110, right: 100, type: 7 }, { left: 370, right: 380, type: 7 }] },
    ],
  });
  // Transports: every elevator kind with car homes and stop maps, every
  // stair variant, corrupt geometry, and the pooled caps.
  add("shaft-standard", {
    floors: [{ index: 10, leftEdge: 100, rightEdge: 200 }],
    elevators: [{ type: 1, cars: 3, x: 150, bottomFloor: 9, topFloor: 39, carHomes: [10, 24, 39] }],
  });
  add("shaft-express-stops", {
    floors: [{ index: 10, leftEdge: 100, rightEdge: 200 }],
    elevators: [{ type: 0, cars: 8, x: 150, bottomFloor: 10, topFloor: 69, serviced: [10, 24, 39, 54, 69] }],
  });
  add("shaft-service-and-corrupt", {
    elevators: [
      { type: 2, cars: 2, x: 100, bottomFloor: 10, topFloor: 20 },
      { type: 1, cars: 2, x: 500, bottomFloor: 10, topFloor: 20 },
      { type: 1, cars: 2, x: 100, bottomFloor: 20, topFloor: 20 },
    ],
  });
  add("shaft-trimmed", {
    floors: [{ index: 10, leftEdge: 100, rightEdge: 200 }],
    elevators: [
      { type: 1, cars: 2, x: 100, bottomFloor: 115, topFloor: 118 },
      { type: 1, cars: 2, x: 200, bottomFloor: 10, topFloor: 119 },
    ],
  });
  add("shaft-overlap", {
    elevators: [
      { type: 1, cars: 2, x: 100, bottomFloor: 10, topFloor: 20 },
      { type: 1, cars: 2, x: 101, bottomFloor: 12, topFloor: 18 },
    ],
  });
  add("shaft-car-homes-clamped", {
    elevators: [{ type: 1, cars: 8, x: 100, bottomFloor: 10, topFloor: 20, carHomes: [0, 5, 10, 15, 20, 25, 119, 3] }],
  });
  add("stairs-variants", {
    stairs: [
      { type: 1, x: 100, floor: 10 },
      { type: 0, x: 120, floor: 10 },
      { type: 3, x: 140, floor: 10 },
      { type: 4, x: 160, floor: 10 },
      { type: 2, x: 180, floor: 108 },
      { type: 5, x: 200, floor: 0 },
    ],
  });
  add("stairs-pool-cap", { stairs: Array.from({ length: 30 }, (_, i) => ({ type: 5, x: i * 12, floor: 10 })) });
  add("stairs-overlap-shaft", {
    elevators: [{ type: 1, cars: 2, x: 100, bottomFloor: 10, topFloor: 20 }],
    stairs: [{ type: 1, x: 101, floor: 12 }, { type: 1, x: 101, floor: 13 }],
  });
  add("parking-block", { ...sampleTowerSpec(), parkingConnected: 302 });
  add("people-tail", { ...sampleTowerSpec(), peopleCount: 1500, retailRows: 40 });
  // Payload layouts: the game's express rule, our span rule stamped and
  // unstamped, the 2.9.0 serviced rule, and the files that must be refused.
  const legacy: TdtSpec = {
    elevators: [
      { type: 1, cars: 2, x: 100, bottomFloor: 10, topFloor: 21, serviced: [10, 11, 12, 18, 19, 20, 21] },
      { type: 2, cars: 3, x: 140, bottomFloor: 10, topFloor: 18 },
    ],
    routingTailBytes: 20_000,
    legacyServicedPayload: true,
  };
  add("layout-legacy-serviced", legacy);
  for (const generation of [2, 0, 0xffff]) out.push([`layout-legacy-stamped-${generation}`, withStamp(buildTdt(legacy), generation)]);
  add("layout-game-express", {
    elevators: [
      { type: 0, cars: 8, x: 175, bottomFloor: 10, topFloor: 100, serviced: [10, 25, 40, 55, 70, 85, 99, 100] },
      { type: 1, cars: 6, x: 145, bottomFloor: 10, topFloor: 24 },
      { type: 1, cars: 4, x: 251, bottomFloor: 24, topFloor: 39, serviced: [24, 25, 30, 39] },
      { type: 2, cars: 3, x: 209, bottomFloor: 39, topFloor: 54 },
    ],
    stairs: [{ type: 1, x: 120, floor: 10 }],
    parkingConnected: 302,
    routingTailBytes: 20_000,
  });
  const spanned: TdtSpec = {
    elevators: [
      { type: 0, cars: 8, x: 175, bottomFloor: 10, topFloor: 100, serviced: [10, 55, 100] },
      { type: 1, cars: 6, x: 145, bottomFloor: 10, topFloor: 24 },
    ],
    stairs: [],
    parkingConnected: 7,
    spannedExpressPayload: true,
  };
  add("layout-spanned-bare", spanned);
  out.push(["layout-spanned-stamped", withStamp(buildTdt(spanned), TDT_STAMP_GENERATION)]);
  add("layout-spanned-anchored", { ...spanned, stairs: [{ type: 1, x: 120, floor: 10 }], routingTailBytes: 20_000 });
  for (const tail of [0, 32, 63]) add(`layout-spanned-tail-${tail}`, { ...spanned, routingTailBytes: tail });
  add("layout-express-no-stops", {
    elevators: [
      { type: 0, cars: 8, x: 175, bottomFloor: 10, topFloor: 100, serviced: [] },
      { type: 1, cars: 6, x: 145, bottomFloor: 10, topFloor: 24 },
    ],
    stairs: [{ type: 1, x: 120, floor: 10 }],
    parkingConnected: 7,
    routingTailBytes: 20_000,
    spannedExpressPayload: true,
  });
  const skipper: TdtSpec = {
    elevators: [{ type: 1, cars: 2, x: 100, bottomFloor: 10, topFloor: 40, serviced: [10, 40] }],
    stairs: [{ type: 1, x: 120, floor: 10 }],
    parkingConnected: 7,
  };
  const full = buildTdt(skipper);
  out.push(["layout-truncated-current", full.slice(0, full.length - 2_000)]);
  out.push(["layout-truncated-legacy-length", full.slice(0, buildTdt({ ...skipper, legacyServicedPayload: true }).length)]);
  for (const len of [3_000, 3_097, 40_000, full.length - 11, full.length - 650, full.length - 1_300]) {
    out.push([`layout-truncated-${len}`, full.slice(0, len)]);
  }
  for (const skipped of [1, 5, 29]) {
    const serviced: number[] = [];
    for (let f = 10; f <= 40; f++) if (f < 12 || f >= 12 + skipped) serviced.push(f);
    add(`layout-legacy-stairless-${skipped}`, {
      elevators: [{ type: 1, cars: 2, x: 100, bottomFloor: 10, topFloor: 40, serviced }],
      stairs: [],
      parkingConnected: 7,
      routingTailBytes: 20_000,
      legacyServicedPayload: true,
    });
  }
  add("layout-legacy-pre-tail", {
    elevators: [
      { type: 1, cars: 2, x: 100, bottomFloor: 10, topFloor: 40, serviced: [10, 40] },
      { type: 2, cars: 3, x: 140, bottomFloor: 10, topFloor: 18 },
    ],
    stairs: [],
    parkingConnected: 7,
    legacyServicedPayload: true,
  });
  add("layout-current-stairless", {
    elevators: [{ type: 1, cars: 2, x: 100, bottomFloor: 10, topFloor: 40, serviced: [10, 20, 40] }],
    stairs: [],
    parkingConnected: 7,
    routingTailBytes: 20_000,
  });
  add("layout-legacy-only-skipper", {
    elevators: [{ type: 1, cars: 2, x: 100, bottomFloor: 10, topFloor: 40, serviced: [10, 40] }],
    stairs: [{ type: 1, x: 120, floor: 10 }, { type: 0, x: 140, floor: 11 }],
    parkingConnected: 7,
    trailingBytes: 20_000,
    legacyServicedPayload: true,
  });
  for (const skipped of [1, 2, 3]) {
    const serviced: number[] = [];
    for (let f = 10; f <= 25; f++) if (f < 12 || f >= 12 + skipped) serviced.push(f);
    add(`layout-legacy-skip-${skipped}`, {
      elevators: [{ type: 1, cars: 2, x: 100, bottomFloor: 10, topFloor: 25, serviced }],
      stairs: [{ type: 1, x: 120, floor: 10 }],
      parkingConnected: 9,
      trailingBytes: 20_000,
      legacyServicedPayload: true,
    });
  }
  add("layout-current-only-skipper", {
    elevators: [{ type: 1, cars: 2, x: 100, bottomFloor: 10, topFloor: 40, serviced: [10, 40] }],
    stairs: [{ type: 1, x: 120, floor: 10 }, { type: 0, x: 140, floor: 11 }],
    parkingConnected: 7,
    trailingBytes: 20_000,
  });
  // Corrupt tables: an inverted span and an absurd car count abandon the
  // decode; a forged people count and a cut tail downgrade to warnings.
  const inverted = buildTdt({
    elevators: [
      { type: 1, cars: 2, x: 100, bottomFloor: 20, topFloor: 40 },
      { type: 1, cars: 2, x: 140, bottomFloor: 10, topFloor: 20 },
    ],
  });
  inverted[elevatorTableOffset(inverted) + 64] = 15;
  out.push(["corrupt-inverted-span", inverted]);
  const badCars = buildTdt(sampleTowerSpec());
  badCars[elevatorTableOffset(badCars) + 3] = 200;
  out.push(["corrupt-car-count", badCars]);
  const people = buildTdt({ includeRetail: false });
  people.set([0xff, 0xff, 0xff, 0xff], people.length - 4);
  out.push(["corrupt-people-count", people]);
  const sample = buildTdt(sampleTowerSpec());
  out.push(["cut-after-elevators", sample.slice(0, elevatorTableOffset(sample) + 24 * 194 + 20)]);
  out.push(["cut-inside-parking", sample.slice(0, elevatorTableOffset(sample) + 24 * 194 + 3140 + 6 * 324 + 348 + 132 + 100)]);
  out.push(["cut-people-table", buildTdt({ peopleCount: 3, includeRetail: false }).slice(0, -20)]);
  // Hostile files that must be refused outright.
  add("hostile-magic", { magic: 0x1234 });
  out.push(["hostile-too-small", new Uint8Array(8)]);
  add("hostile-cut-floor-map", { ...sampleTowerSpec(), truncateAt: TDT_HEADER_SIZE + 194 * 3 + 10 });
  add("hostile-tenant-count", { floors: [{ index: 10, forgeTenantCount: 257 }] });
  add("hostile-tenant-count-large", { floors: [{ index: 10, forgeTenantCount: 65_535 }] });
  add("hostile-tenant-count-cut", { floors: [{ index: 119, forgeTenantCount: 250 }], peopleCount: 0, includeRetail: false });
  // Seeded byte flips of the sample, the import test's fuzz-lite.
  const pristine = buildTdt(sampleTowerSpec());
  let s = 0xc0ffee;
  const rnd = (n: number) => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s % n;
  };
  for (let round = 0; round < 24; round++) {
    const bytes = pristine.slice();
    const flips = 1 + rnd(3);
    for (let f = 0; f < flips; f++) bytes[rnd(bytes.length)] ^= 1 << rnd(8);
    out.push([`fuzz-${round}`, bytes, "FUZZ.TDT"]);
  }
  return out;
}
