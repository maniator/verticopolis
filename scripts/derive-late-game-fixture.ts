/**
 * Derive `conformance/fixtures/late-game-classic.vctower`, the late-game
 * tower the five-star and TOWER scenarios start from (#864). No real save
 * reaches 15,000 people, so this script builds one on the Rust engine from
 * the card-text golden's 100-floor winning tower
 * (`src/tests/goldens/card-text/classic-winning-tower.vctower`: a lobby, an
 * elevator per 30-floor segment, a metro, a medical center, two security
 * offices, two suites, nine recycling centers and a favorable VIP visit):
 *
 * 1. load it through the WASM binding, set `star` to 4 in its saved game
 *    (so the express elevator is unlocked and the first star evaluation has
 *    the fifth rung to climb) and load that;
 * 2. lay a sky lobby across every fifteenth floor, fill the elevator pool
 *    (more standard shafts in each segment, spread across the lot, and two
 *    express shafts, every elevator at eight cars) and build a parking ramp
 *    with a few spaces, so the tower's workers can get to work and stay;
 * 3. build offices at the free places on floors 2 to 99, from the bottom up,
 *    until the tower holds `OFFICES` of them: 18,000 office workers clear the
 *    TOWER inspection's 15,000 with room to spare and stay under the 22,500
 *    the nine recycling centers serve, so the four-star recycling gate holds;
 * 4. sell the metro station and build it again, so it is under construction
 *    and the tower holds at four stars until it opens at 15:00: the fifth
 *    rung is climbed in the afternoon, after the fixture tests' noon reload
 *    (a save between the climb and the day's milestone check would adopt the
 *    milestone silently on load), and the climb is an event in the frame-day
 *    golden's day;
 * 5. in the saved game, lease every office (state `occupied`, ever occupied),
 *    and write the floor runs out tile by tile, as the other fixtures list
 *    them, at the save version a save without runs carries;
 * 6. write the result as a text `.vctower`.
 *
 * Every shaft, car and office goes through the engine's own commands, so
 * each placement is one the engine accepts; steps 1 and 4 are the only edits
 * to a saved game. Usage (the engine package installed with `npm install`):
 *   npx tsx scripts/derive-late-game-fixture.ts
 * The run is deterministic, so a rerun writes the same file.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_BRUSH_TILES } from "@verticopolis/engine/port/request";
import { deflate } from "../src/storage/saveCompression";
import { wasm } from "../src/tests/conformance/wasmEngine";
import { CONFORMANCE_ROOT } from "../src/tests/packagePaths";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "src/tests/goldens/card-text/classic-winning-tower.vctower");
const TARGET = resolve(CONFORMANCE_ROOT, "fixtures/late-game-classic.vctower");

const { Engine, catalog } = wasm();
if (!catalog) throw new Error("the tooling engine has no catalog()");
type Facility = { key: string; width: number; maxCars: number | null };
const facilities = (JSON.parse(catalog("classic")) as { facilities: Facility[] }).facilities;
const facility = (key: string) => facilities.find((f) => f.key === key)!;
const LOT_WIDTH = 375;
/** Offices in the finished tower, at six workers each. */
const OFFICES = 3000;
/** The shafts added to the source's five, the 24 the Classic elevator pool
 *  holds: standard shafts in each segment (its floors, sky lobby to sky
 *  lobby) at columns spread across the lot, so no office is farther from one
 *  than the walk an office tenant puts up with, and two express shafts from
 *  the lobby to the top floor at the right edge. Each segment's shafts sit
 *  one shaft width right of the segment below's, since neighboring segments
 *  share a sky lobby floor. */
const STANDARD_COLUMNS = [60, 130, 200, 270, 340];
const ADDED_STANDARD: readonly [bottom: number, top: number, columns: readonly number[]][] = [
  [1, 30, STANDARD_COLUMNS],
  [30, 60, STANDARD_COLUMNS],
  [60, 90, STANDARD_COLUMNS],
  [90, 100, [130, 270]],
];
const EXPRESS_X = [360, 366];
const TOP_FLOOR = 100;
/** The Classic sky lobby floors: every fifteenth. */
const SKY_LOBBY_EVERY = 15;
/** The source's metro station. */
/** The version the engine stamps a save with floor runs and nothing newer,
 *  and the one it stamps a save with none of the later features. */
const FLOOR_RUN_SAVE_VERSION = 11;
const PLAIN_SAVE_VERSION = 7;
const METRO: readonly [floor: number, x: number] = [-9, 0];
/** A parking ramp on the first basement floor with spaces beside it: one
 *  for each of the two suites and more, since a Classic office needs a free
 *  space once the suites have parked. */
const PARKING_FLOOR = 0;
const RAMP_X = 300;
const PARKING_SPACES = 4;

type SavedUnit = {
  id: number;
  kind: string;
  floor: number;
  x: number;
  run?: number;
  state?: string;
  everOccupied?: boolean;
};
type Save = {
  version: number;
  money: number;
  star: number;
  units: SavedUnit[];
  transports: { id: number; kind: string }[];
};
const read = (engine: ReturnType<typeof Engine.newGame>) => JSON.parse(engine.serialize()) as Save;
const ok = (what: string, json: string) => {
  const r = JSON.parse(json) as { ok: boolean; reason?: string };
  if (!r.ok) throw new Error(`${what}: ${r.reason}`);
};

const source = Engine.fromVctower(readFileSync(SOURCE, "utf8"), null);
const start = read(source);
source.free();
start.star = 4;
const engine = Engine.fromSave(JSON.stringify(start), null);
try {
  engine.setMoney(1e12);
  for (let floor = SKY_LOBBY_EVERY; floor < TOP_FLOOR; floor += SKY_LOBBY_EVERY) {
    for (let x = 0; x < LOT_WIDTH; x += MAX_BRUSH_TILES) {
      const tiles = Array.from({ length: Math.min(MAX_BRUSH_TILES, LOT_WIDTH - x) }, (_, i) => x + i);
      engine.paintBrush("lobby", floor, JSON.stringify(tiles));
    }
  }
  const standard = facility("elevatorStandard");
  ADDED_STANDARD.forEach(([bottom, top, columns], segment) => {
    for (const column of columns) {
      const x = column + segment * standard.width;
      ok(`standard shaft at ${x}`, engine.buildTransport(standard.key, x, bottom, top));
    }
  });
  for (const x of EXPRESS_X) ok(`express shaft at ${x}`, engine.buildTransport("elevatorExpress", x, 1, TOP_FLOOR));
  for (const t of read(engine).transports) {
    const cars = facility(t.kind).maxCars;
    if (cars) engine.setCars(t.id, cars);
  }
  const ramp = facility("parkingRamp");
  ok("parking ramp", engine.build(ramp.key, PARKING_FLOOR, RAMP_X));
  const space = facility("parking");
  for (let i = 0; i < PARKING_SPACES; i++)
    ok(`parking space ${i}`, engine.build(space.key, PARKING_FLOOR, RAMP_X + ramp.width + i * space.width));
  const officeWidth = facility("office").width;
  const before = start.units.filter((u) => u.kind === "office").length;
  let built = 0;
  for (let floor = 2; floor < TOP_FLOOR && before + built < OFFICES; floor++) {
    for (let ox = 0; ox + officeWidth <= LOT_WIDTH && before + built < OFFICES;) {
      const r = JSON.parse(engine.build("office", floor, ox)) as { ok: boolean };
      if (r.ok) {
        built += 1;
        ox += officeWidth;
      } else ox += 1;
    }
  }
  if (!engine.sellAt(...METRO)) throw new Error("the metro did not sell");
  ok("metro", engine.build("metro", ...METRO));
  engine.setMoney(start.money);
  const save = read(engine);
  // A run `{ id, x, run: n }` stands for n floor tiles, at x and the next
  // n - 1 places, with the next ids (`src/save_floor_runs.rs`).
  // With no run left, the save is stamped as the engine stamps a save with
  // no floor run, no tall lobby and no schedule (`stamped_save_version` in
  // `src/sim.rs`).
  save.units = save.units.flatMap(({ run, ...u }) =>
    run ? Array.from({ length: run }, (_, k) => ({ ...u, id: u.id + k, x: u.x + k })) : [u],
  );
  if (save.version !== FLOOR_RUN_SAVE_VERSION)
    throw new Error(
      `the engine wrote save version ${save.version}, not the floor-run version ${FLOOR_RUN_SAVE_VERSION}`,
    );
  save.version = PLAIN_SAVE_VERSION;
  let leased = 0;
  for (const u of save.units) {
    if (u.kind !== "office") continue;
    u.state = "occupied";
    u.everOccupied = true;
    leased += 1;
  }
  const packed = await deflate(new TextEncoder().encode(JSON.stringify(save)));
  writeFileSync(TARGET, `VCTOWER1\n${Buffer.from(packed).toString("base64")}\n`);
  console.log(`${TARGET}: ${save.transports.length} shafts, ${built} offices built, ${leased} leased, star 4`);
} finally {
  engine.free();
}
