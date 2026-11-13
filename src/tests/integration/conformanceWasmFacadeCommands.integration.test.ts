import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCatalog } from "../../engineBinding/catalog";
import type { GameMode } from "../../shared/types";
import { REPO_ROOT } from "../conformance/scenario";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import type { WasmEngine } from "../../engineBinding/binding";

/**
 * The command answers the Rust-backed facade reads (slice 6d, #1216), through
 * the WASM binding: the exterminator booking with its `cost` and `rooms`,
 * `previewRentBatch`, an unknown facility kind refused instead of thrown, and
 * `validateTransport` with `placeTransportDryRun`. Until #1875 each answer was
 * compared with the TypeScript engine's; now each is held to the answer the
 * binding documents (`src/engineBinding/engine.d.ts`) and to the command it previews.
 * The engine's own rules behind them are pinned in Rust by
 * `wasm_facade_commands.rs` (exterminator answers, unknown kinds, batch
 * targets), `wasm_port_tests.rs` (`the_rent_batch_quote_is_the_batch_without_the_write`)
 * and `catalog/charge_tests.rs` (`the_exterminator_bills_the_quoted_fees`).
 */

/** Strings that are not catalog keys, including names an object lookup would find on its prototype. */
const UNKNOWN_KINDS = ["", "ofice", "OFFICE", " office", "office ", "__proto__", "constructor", "toString", "hasOwnProperty", "0"];
const UNKNOWN = { ok: false, reason: "Unknown facility." };
const NOT_VALID = { ok: false, reason: "That request is not valid." };
/** The kinds a rent batch prices (office, condo, hotel rooms, the leased venues, rentals). */
const PRICED_KINDS = ["office", "condo", "hotelSingle", "hotelDouble", "hotelSuite", "fitnessClub", "clinic", "rentalStudio", "rentalApartment"];

type Start = { label: string; seed?: number; fixture?: string; mode: GameMode };
const STARTS: Start[] = [
  { label: "new Classic game", seed: 7, mode: "classic" },
  { label: "new Modern game", seed: 7, mode: "modern" },
  { label: "towerone_6 in Classic", fixture: "conformance/fixtures/towerone_6.vctower", mode: "classic" },
  { label: "sixseven-december in Modern", fixture: "conformance/fixtures/sixseven-december.vctower", mode: "modern" },
  { label: "towerone-star4 in Modern", fixture: "conformance/fixtures/towerone-star4.vctower", mode: "modern" },
];

type SaveUnit = { id: number; kind: string; state?: string; rent?: number; noRate?: boolean; everOccupied?: boolean };
type Save = { money: number; star: number; units: SaveUnit[]; transports: { id: number }[]; exterminationDueDay?: number; exterminationRoomIds?: number[] };

function open(start: Start): WasmEngine {
  const { Engine } = wasm();
  if (start.seed !== undefined) return Engine.newGame(start.seed, start.mode);
  return Engine.fromVctower(readFileSync(resolve(REPO_ROOT, start.fixture!), "utf8"), start.mode);
}

/** Frees `engine` and reopens its save after `edit` changed it; `text` is the reopened save. */
function reload(engine: WasmEngine, edit: (save: Save) => void): { engine: WasmEngine; text: string } {
  const save = JSON.parse(engine.serialize()) as Save;
  engine.free();
  edit(save);
  const text = JSON.stringify(save);
  return { engine: wasm().Engine.fromSave(text), text };
}

const ok = (answer: string): void => expect((JSON.parse(answer) as { ok: boolean }).ok).toBe(true);

/** A priced tower mix: some units on a custom price, some sold or off the market. */
function variedPrices(save: Save): void {
  save.money = 1e9;
  let i = 0;
  for (const u of save.units) {
    if (!PRICED_KINDS.includes(u.kind)) continue;
    if (i % 3 === 0) u.rent = 1;
    if (i % 5 === 0) u.noRate = true;
    if (u.kind === "condo" && i % 4 === 0) u.everOccupied = true;
    i++;
  }
}

const parse = <T>(text: string | undefined): T | null => (text === undefined ? null : (JSON.parse(text) as T));

describe.skipIf(!hasWasmPackage())("the facade's command answers through the WASM binding", () => {
  describe("callExterminator", () => {
    const fee = (rooms: number) => 5_000 + 2_000 * rooms;
    /** A tower with `rooms` infested hotel rooms: built through the binding at
     *  a rating that allows hotels, then marked infested in the save. */
    const infested = (mode: GameMode, rooms: number, money: number) => {
      const engine = wasm().Engine.newGame(3, mode);
      engine.setMoney(1e9);
      for (let x = 170; x < 230; x++) {
        ok(engine.build("lobby", 1, x));
        ok(engine.build("floor", 2, x));
      }
      const rated = reload(engine, (save) => {
        save.star = 3;
      }).engine;
      for (let i = 0; i < rooms; i++) ok(rated.build("hotelSingle", 2, 170 + i * 4));
      return reload(rated, (save) => {
        for (const u of save.units) if (u.kind === "hotelSingle") u.state = "infested";
        save.money = money;
      });
    };

    const book = (label: string, mode: GameMode, rooms: number, money: number, expected: object, repeat = 1) =>
      it(label, () => {
        const { engine } = infested(mode, rooms, money);
        try {
          let got: unknown;
          for (let i = 0; i < repeat; i++) got = JSON.parse(engine.callExterminator());
          expect(got).toEqual(expected);
          const saved = JSON.parse(engine.serialize()) as Save;
          const booked = (expected as { ok: boolean }).ok || repeat > 1;
          // A booking charges the quoted fee once and names every infested room; a refusal writes nothing.
          expect(saved.money).toBe(booked ? money - fee(rooms) : money);
          expect(saved.exterminationRoomIds?.length ?? 0).toBe(booked ? rooms : 0);
          expect(saved.exterminationDueDay !== undefined).toBe(booked);
        } finally {
          engine.free();
        }
      });

    book("books three rooms and carries cost and rooms", "modern", 3, 1e9, { ok: true, cost: fee(3), rooms: 3 });
    book("a second call is pending", "modern", 3, 1e9, { ok: false, reason: "pending" }, 2);
    book("refuses short of funds with the price and the rooms", "modern", 3, fee(3) - 1, { ok: false, reason: "funds", cost: fee(3), rooms: 3 });
    book("books at exactly the price", "modern", 3, fee(3), { ok: true, cost: fee(3), rooms: 3 });
    book("refuses when no room is infested", "modern", 0, 1e9, { ok: false, reason: "none" });
    book("is unavailable in Classic", "classic", 1, 1e9, { ok: false, reason: "unavailable" });
  });

  describe("previewRentBatch", () => {
    const TARGETS: unknown[] = ["default", "noRate", 0, 1, 50, 200, 800, 5_000, 1e9, -5, 12.5, Number.NaN, Number.POSITIVE_INFINITY, "cheap", null, undefined, {}, true];
    const target = (t: unknown): string => JSON.stringify(t) ?? "null";

    for (const start of STARTS) {
      it(`${start.label}: every kind and target previews what the apply then reports, and the preview writes nothing`, () => {
        const { Engine } = wasm();
        const { engine, text } = reload(open(start), variedPrices);
        const before = engine.serialize();
        const kinds = readCatalog(wasm(), start.mode).facilities.map((f) => f.key);
        let reported = 0;
        try {
          for (const kind of kinds) {
            for (const t of TARGETS) {
              for (const only of [false, true]) {
                const preview = engine.previewRentBatch(kind, target(t), only);
                const label = `${kind} ${String(t)} only=${only}`;
                // Only a priced kind has a batch to preview.
                if (!PRICED_KINDS.includes(kind)) {
                  expect(preview, label).toBeUndefined();
                  continue;
                }
                const fresh = Engine.fromSave(text);
                try {
                  const applied = fresh.applyRentBatch(kind, target(t), only);
                  expect(applied, label).toBe(preview);
                  if (applied === undefined) continue;
                  reported++;
                  // An apply that reports a change wrote it.
                  if ((JSON.parse(applied) as { changed: number }).changed > 0) expect(fresh.serialize(), label).not.toBe(text);
                } finally {
                  fresh.free();
                }
              }
            }
          }
          // The grid reached real batches, not only refusals.
          expect(reported).toBeGreaterThan(0);
          expect(engine.serialize()).toBe(before);
        } finally {
          engine.free();
        }
      }, 120_000);
    }

    it("reads the flag by truthiness and a kind that is not a string as unknown", () => {
      const built = open(STARTS[1]!);
      built.setMoney(1e9);
      for (let x = 150; x < 200; x++) {
        ok(built.build("lobby", 1, x));
        ok(built.build("floor", 2, x));
      }
      ok(built.build("office", 2, 150));
      ok(built.build("office", 2, 160));
      // The second office goes on a custom price.
      const { engine } = reload(built, (save) => {
        save.units.filter((u) => u.kind === "office")[1]!.rent = 1_234;
      });
      const raw = engine as unknown as { previewRentBatch(kind: unknown, target: string, only: unknown): string | undefined };
      try {
        const onlyDefault = raw.previewRentBatch("office", "5000", true);
        const every = raw.previewRentBatch("office", "5000", false);
        // The custom-priced office makes the two flags differ, so a misread flag shows.
        expect(onlyDefault).not.toEqual(every);
        for (const only of ["yes", "0", 0.5, 2 ** 32, {}, []]) expect(raw.previewRentBatch("office", "5000", only), `only=${String(only)}`).toEqual(onlyDefault);
        for (const only of ["", 0, null, undefined]) expect(raw.previewRentBatch("office", "5000", only), `only=${String(only)}`).toEqual(every);
        for (const kind of [null, undefined, 5, {}, [], Symbol("k")]) {
          expect(raw.previewRentBatch(kind, '"default"', false)).toBeUndefined();
          expect(JSON.parse(engine.validateTransport(kind as never, 150, 1, 3))).toEqual(UNKNOWN);
          expect(engine.placeTransportDryRun(kind as never, 150, 1, 3)).toBe(false);
          expect(JSON.parse(engine.canBuild(kind as never, 2, 150))).toEqual({ ...UNKNOWN, cost: 0 });
          expect(JSON.parse(engine.build(kind as never, 2, 150))).toEqual(UNKNOWN);
          expect(JSON.parse(engine.buildTransport(kind as never, 150, 1, 3))).toEqual(UNKNOWN);
        }
      } finally {
        engine.free();
      }
    });
  });

  describe("an unknown facility kind is refused, never thrown", () => {
    for (const start of STARTS) {
      it(`${start.label}`, () => {
        const engine = open(start);
        const before = engine.serialize();
        try {
          for (const kind of UNKNOWN_KINDS) {
            const label = JSON.stringify(kind);
            expect(JSON.parse(engine.build(kind, 2, 150)), `build ${label}`).toEqual(UNKNOWN);
            expect(JSON.parse(engine.canBuild(kind, 2, 150)), `canBuild ${label}`).toEqual({ ...UNKNOWN, cost: 0 });
            expect(JSON.parse(engine.buildTransport(kind, 150, 1, 3)), `buildTransport ${label}`).toEqual(UNKNOWN);
            expect(JSON.parse(engine.validateTransport(kind, 150, 1, 3)), `validateTransport ${label}`).toEqual(UNKNOWN);
            expect(engine.placeTransportDryRun(kind, 150, 1, 3), `placeTransportDryRun ${label}`).toBe(false);
            expect(parse(engine.applyRentBatch(kind, '"default"', false)), `applyRentBatch ${label}`).toBeNull();
            expect(parse(engine.previewRentBatch(kind, '"default"', false)), `previewRentBatch ${label}`).toBeNull();
          }
          // Refused means nothing moved.
          expect(engine.serialize()).toBe(before);
        } finally {
          engine.free();
        }
      });
    }
  });

  describe("setExpressStops", () => {
    for (const start of STARTS.filter((s) => s.fixture)) {
      it(`${start.label}: answers whether the id names a shaft`, () => {
        const engine = open(start);
        try {
          const ids = (JSON.parse(engine.serialize()) as Save).transports.map((t) => t.id);
          expect(ids.length).toBeGreaterThan(0);
          for (const id of ids) expect(engine.setExpressStops(id), `id ${id}`).toBe(true);
          const after = engine.serialize();
          for (const id of [0, -1, 999_999]) expect(engine.setExpressStops(id), `id ${id}`).toBe(false);
          // An unknown id changes nothing.
          expect(engine.serialize()).toBe(after);
        } finally {
          engine.free();
        }
      });
    }
  });

  describe("validateTransport and placeTransportDryRun", () => {
    const FLOORS = [-3, -1, 0, 1, 2, 3, 6, 10, 31, 60, 120];
    const XS = [-2, 0, 10, 88, 150, 160, 175, 199, 370, 371, 372, 1000];

    for (const start of STARTS) {
      it(`${start.label}: every shaft kind over a grid of columns and floors`, () => {
        const { Engine } = wasm();
        const engine = open(start);
        engine.setMoney(1e9);
        const before = engine.serialize();
        const catalog = readCatalog(wasm(), start.mode).facilities;
        const transports = catalog.filter((f) => f.transport).map((f) => f.key);
        try {
          let accepted = 0;
          let refused = 0;
          const built = new Set<string>();
          const diffs: string[] = [];
          for (const kind of [...transports, "office", "floor"]) {
            for (const x of XS) {
              for (const bottom of FLOORS) {
                for (const top of FLOORS) {
                  const got = JSON.parse(engine.validateTransport(kind, x, bottom, top)) as { ok: boolean; reason?: string };
                  const dry = engine.placeTransportDryRun(kind, x, bottom, top);
                  const at = `${kind} x${x} ${bottom}..${top}`;
                  // The dry run agrees with the validation, and only a transport kind is ever accepted.
                  if (dry !== got.ok || (got.ok && !(transports as readonly string[]).includes(kind))) diffs.push(`${at}: ${JSON.stringify(got)}/${dry}`);
                  if (!got.ok) {
                    refused++;
                    continue;
                  }
                  accepted++;
                  if (built.has(kind)) continue;
                  // The first accepted shaft of each kind builds on a copy of the tower.
                  built.add(kind);
                  const copy = Engine.fromSave(before);
                  try {
                    if (!(JSON.parse(copy.buildTransport(kind, x, bottom, top)) as { ok: boolean }).ok) diffs.push(`${at}: accepted but not built`);
                  } finally {
                    copy.free();
                  }
                }
              }
            }
          }
          expect(diffs.slice(0, 10)).toEqual([]);
          // The grid reaches accepted shafts as well as refusals.
          if (start.fixture) expect(accepted).toBeGreaterThan(0);
          expect(refused).toBeGreaterThan(0);
          expect(engine.serialize()).toBe(before);
        } finally {
          engine.free();
        }
      }, 120_000);

      it(`${start.label}: a coordinate that is not a whole number is refused`, () => {
        const engine = open(start);
        try {
          const bad: unknown[] = [0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53, -(2 ** 53), "3", null, undefined, true, 1n, {}, []];
          for (const v of bad) {
            for (const args of [[v, 1, 3], [150, v, 3], [150, 1, v]]) {
              const label = `${String(v)} in ${args.map(String).join(",")}`;
              const [x, b, t] = args as [number, number, number];
              expect(JSON.parse(engine.validateTransport("elevatorStandard", x, b, t)), label).toEqual(NOT_VALID);
              expect(engine.placeTransportDryRun("elevatorStandard", x, b, t), label).toBe(false);
            }
          }
          // The last safe integer is a whole number: the engine reads it and the
          // tower, not the number rule, refuses the shaft off the lot.
          const edge = 2 ** 53 - 1;
          for (const args of [[edge, 1, 3], [-edge, 1, 3], [150, -edge, 3], [150, 1, edge]]) {
            const [x, b, t] = args as [number, number, number];
            const got = JSON.parse(engine.validateTransport("elevatorStandard", x, b, t)) as { ok: boolean; reason?: string };
            expect(got.ok).toBe(false);
            expect(got.reason, args.join(",")).not.toBe(NOT_VALID.reason);
          }
          // An argument missing altogether is refused the same way.
          const raw = engine as unknown as { validateTransport(kind: string): string };
          expect(JSON.parse(raw.validateTransport("elevatorStandard"))).toEqual(NOT_VALID);
        } finally {
          engine.free();
        }
      });
    }
  });
});
