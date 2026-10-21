import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Simulation } from "../../engine/Simulation";
import { FACILITIES } from "../../engine/facilitiesData";
import { PRICED_KINDS } from "../../engine/econConfig";
import type { FacilityKind, GameMode } from "../../engine/types";
import type { SerializedGame } from "../../engine/serializedGame";
import { decodeVctower } from "../../storage/vctowerContainer";
import { markFounderFromLoadedFile } from "../../engine/sim/founderStatus";
import { REPO_ROOT } from "../conformance/scenario";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import type { WasmEngine } from "../../dualrun/binding";

/**
 * The command answers the Rust-backed facade reads (slice 6d, #1216), through
 * the WASM binding against the TypeScript engine on the same tower: the
 * exterminator booking with its `cost` and `rooms`, `previewRentBatch`, an
 * unknown facility kind refused instead of thrown, and `validateTransport`
 * with `placeTransportDryRun`. Each answer has to equal the TypeScript's,
 * field for field, and the previews have to write nothing.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

const KINDS = Object.keys(FACILITIES) as FacilityKind[];
const TRANSPORTS = KINDS.filter((k) => FACILITIES[k].transport);
/** Strings that are not catalog keys, including names an object lookup would find on its prototype. */
const UNKNOWN_KINDS = ["", "ofice", "OFFICE", " office", "office ", "__proto__", "constructor", "toString", "hasOwnProperty", "0"];

type Start = { label: string; seed?: number; fixture?: string; mode: GameMode };
const STARTS: Start[] = [
  { label: "new Classic game", seed: 7, mode: "classic" },
  { label: "new Modern game", seed: 7, mode: "modern" },
  { label: "towerone_6 in Classic", fixture: "conformance/fixtures/towerone_6.vctower", mode: "classic" },
  { label: "sixseven-december in Modern", fixture: "conformance/fixtures/sixseven-december.vctower", mode: "modern" },
  { label: "towerone-star4 in Modern", fixture: "conformance/fixtures/towerone-star4.vctower", mode: "modern" },
];

/** The TypeScript engine and the Rust engine on one save text. `tweak` edits
 *  the TypeScript tower before the text is written, so the two start equal. */
function pair(start: Start, tweak?: (sim: Simulation) => void): { sim: Simulation; engine: WasmEngine; text: string } {
  const { Engine } = wasm();
  let base: Simulation;
  if (start.seed !== undefined) {
    base = Simulation.newGame(start.seed, start.mode);
  } else {
    const raw = decodeVctower(readFileSync(resolve(REPO_ROOT, start.fixture!), "utf8"), start.fixture!) as SerializedGame;
    raw.mode = start.mode;
    base = Simulation.deserialize(raw);
    markFounderFromLoadedFile(base, raw);
  }
  tweak?.(base);
  const text = JSON.stringify(base.serialize());
  return { sim: Simulation.deserialize(JSON.parse(text) as SerializedGame), engine: Engine.fromSave(text), text };
}

/** A priced tower mix: some units on a custom price, some sold or off the market. */
function variedPrices(sim: Simulation): void {
  sim.money = 1e9;
  let i = 0;
  for (const u of sim.tower.units) {
    if (!(PRICED_KINDS as readonly string[]).includes(u.kind)) continue;
    if (i % 3 === 0) sim.adjustRent(u.id, 1);
    if (i % 5 === 0) sim.setNoRate(u.id);
    if (u.kind === "condo" && i % 4 === 0) u.everOccupied = true;
    i++;
  }
}

const parse = <T>(text: string | undefined): T | null => (text === undefined ? null : (JSON.parse(text) as T));

describe.skipIf(!hasWasmPackage())("the facade's command answers match the TypeScript engine", () => {
  describe("callExterminator", () => {
    /** A Modern tower with `rooms` infested hotel rooms. */
    const infested = (rooms: number, money: number) => (sim: Simulation) => {
      sim.money = 1e9;
      for (let x = 170; x < 230; x++) {
        expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
        expect(sim.tower.place("floor", 2, x).ok).toBe(true);
      }
      for (let i = 0; i < rooms; i++) {
        const r = sim.tower.place("hotelSingle", 2, 170 + i * 4);
        expect(r.ok).toBe(true);
        sim.tower.getUnit(r.unitId!)!.state = "infested";
      }
      sim.money = money;
    };
    const fee = (rooms: number) => 5_000 + 2_000 * rooms;

    const book = (label: string, start: Start, tweak: (sim: Simulation) => void, expected: object, repeat = 1) =>
      it(label, () => {
        const { sim, engine } = pair(start, tweak);
        try {
          let want: unknown;
          for (let i = 0; i < repeat; i++) {
            want = sim.callExterminator();
            const got = JSON.parse(engine.callExterminator()) as unknown;
            expect(got).toEqual(want);
            expect(isDeepStrictEqual(got, want)).toBe(true);
          }
          // The answer is the one the case names, so a drifted fee or mode shows here.
          expect(want).toEqual(expected);
          // The booking is the same money and the same pending treatment.
          const saved = JSON.parse(engine.serialize()) as { money: number; exterminationDueDay?: number; exterminationRoomIds?: number[] };
          const ts = sim.serialize() as unknown as typeof saved;
          expect(saved.money).toBe(ts.money);
          expect(saved.exterminationDueDay).toBe(ts.exterminationDueDay);
          expect(saved.exterminationRoomIds).toEqual(ts.exterminationRoomIds);
        } finally {
          engine.free();
        }
      });

    const modern: Start = { label: "new Modern game", seed: 3, mode: "modern" };
    const classic: Start = { label: "new Classic game", seed: 3, mode: "classic" };
    book("books three rooms and carries cost and rooms", modern, infested(3, 1e9), { ok: true, cost: fee(3), rooms: 3 });
    book("a second call is pending", modern, infested(3, 1e9), { ok: false, reason: "pending" }, 2);
    book("refuses short of funds with the price and the rooms", modern, infested(3, fee(3) - 1), { ok: false, reason: "funds", cost: fee(3), rooms: 3 });
    book("books at exactly the price", modern, infested(3, fee(3)), { ok: true, cost: fee(3), rooms: 3 });
    book("refuses when no room is infested", modern, infested(0, 1e9), { ok: false, reason: "none" });
    book(
      "is unavailable in Classic",
      classic,
      (sim) => {
        sim.money = 1e9;
        for (let x = 170; x < 190; x++) {
          expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
          expect(sim.tower.place("floor", 2, x).ok).toBe(true);
        }
        const r = sim.tower.place("hotelSingle", 2, 170);
        expect(r.ok).toBe(true);
        sim.tower.getUnit(r.unitId!)!.state = "infested";
      },
      { ok: false, reason: "unavailable" },
    );
  });

  describe("previewRentBatch", () => {
    const TARGETS: unknown[] = ["default", "noRate", 0, 1, 50, 200, 800, 5_000, 1e9, -5, 12.5, Number.NaN, Number.POSITIVE_INFINITY, "cheap", null, undefined, {}, true];
    const run = (engine: WasmEngine, kind: string, target: unknown, only: boolean) => parse<unknown>(engine.previewRentBatch(kind, JSON.stringify(target) ?? "null", only));

    for (const start of STARTS) {
      it(`${start.label}: every priced kind and target, nothing written`, () => {
        const { sim, engine, text } = pair(start, variedPrices);
        const before = engine.serialize();
        try {
          let answered = 0;
          for (const kind of KINDS) {
            for (const target of TARGETS) {
              for (const only of [false, true]) {
                const want = sim.previewRentBatch(kind, target as never, { onlyDefaultPriced: only });
                const got = run(engine, kind, target, only);
                if (want) answered++;
                expect(got, `${kind} ${String(target)} only=${only}`).toEqual(want);
              }
            }
          }
          // The grid reached real batches, not only refusals.
          expect(answered).toBeGreaterThan(0);
          expect(engine.serialize()).toBe(before);
          expect(JSON.stringify(sim.serialize())).toBe(text);
        } finally {
          engine.free();
        }
      }, 120_000);

      it(`${start.label}: a preview is what the apply then reports`, () => {
        const { Engine } = wasm();
        const { engine, text } = pair(start, variedPrices);
        let reported = 0;
        try {
          for (const kind of PRICED_KINDS) {
            for (const target of ["default", "noRate", 1, 9_999]) {
              for (const only of [false, true]) {
                const preview = engine.previewRentBatch(kind, JSON.stringify(target), only);
                const fresh = Engine.fromSave(text);
                try {
                  const applied = fresh.applyRentBatch(kind, JSON.stringify(target), only);
                  expect(applied).toBe(preview);
                  if (applied !== undefined) {
                    reported++;
                    // An apply that reports a change wrote it.
                    if ((JSON.parse(applied) as { changed: number }).changed > 0) expect(fresh.serialize()).not.toBe(text);
                  }
                } finally {
                  fresh.free();
                }
              }
            }
          }
          expect(reported).toBeGreaterThan(0);
        } finally {
          engine.free();
        }
      }, 120_000);
    }

    it("reads the flag by truthiness and a kind that is not a string as unknown, as TypeScript does", () => {
      const { sim, engine } = pair(STARTS[1], (s) => {
        s.money = 1e9;
        for (let x = 150; x < 200; x++) {
          expect(s.tower.place("lobby", 1, x).ok).toBe(true);
          expect(s.tower.place("floor", 2, x).ok).toBe(true);
        }
        expect(s.tower.place("office", 2, 150).ok).toBe(true);
        const second = s.tower.place("office", 2, 160);
        expect(second.ok).toBe(true);
        s.tower.getUnit(second.unitId!)!.rent = 1_234;
      });
      const raw = engine as unknown as { previewRentBatch(kind: unknown, target: string, only: unknown): string | undefined };
      try {
        for (const only of [true, false, "yes", "", "0", 0, 0.5, 2 ** 32, {}, [], null, undefined]) {
          const want = sim.previewRentBatch("office", 5_000, { onlyDefaultPriced: only as boolean });
          expect(parse(raw.previewRentBatch("office", "5000", only)), `only=${String(only)}`).toEqual(want);
        }
        for (const kind of [null, undefined, 5, {}, [], Symbol("k")]) {
          expect(raw.previewRentBatch(kind, '"default"', false)).toBeUndefined();
          expect(JSON.parse(engine.validateTransport(kind as never, 150, 1, 3))).toEqual({ ok: false, reason: "Unknown facility." });
          expect(engine.placeTransportDryRun(kind as never, 150, 1, 3)).toBe(false);
          expect(JSON.parse(engine.canBuild(kind as never, 2, 150))).toEqual({ ok: false, reason: "Unknown facility.", cost: 0 });
          expect(JSON.parse(engine.build(kind as never, 2, 150))).toEqual({ ok: false, reason: "Unknown facility." });
          expect(JSON.parse(engine.buildTransport(kind as never, 150, 1, 3))).toEqual({ ok: false, reason: "Unknown facility." });
        }
      } finally {
        engine.free();
      }
    });
  });

  describe("an unknown facility kind is refused, never thrown", () => {
    for (const start of STARTS) {
      it(`${start.label}`, () => {
        const { sim, engine } = pair(start);
        const before = engine.serialize();
        try {
          for (const kind of UNKNOWN_KINDS) {
            const k = kind as FacilityKind;
            const label = JSON.stringify(kind);
            expect(JSON.parse(engine.build(kind, 2, 150)), `build ${label}`).toEqual(sim.build(k, 2, 150));
            expect(JSON.parse(engine.canBuild(kind, 2, 150)), `canBuild ${label}`).toEqual(sim.canBuild(k, 2, 150));
            expect(JSON.parse(engine.buildTransport(kind, 150, 1, 3)), `buildTransport ${label}`).toEqual(sim.buildTransport(k, 150, 1, 3));
            expect(JSON.parse(engine.validateTransport(kind, 150, 1, 3)), `validateTransport ${label}`).toEqual(sim.tower.validateTransport(k, 150, 1, 3));
            expect(engine.placeTransportDryRun(kind, 150, 1, 3), `placeTransportDryRun ${label}`).toBe(sim.tower.placeTransportDryRun(k, 150, 1, 3));
            expect(parse(engine.applyRentBatch(kind, '"default"', false)), `applyRentBatch ${label}`).toEqual(sim.applyRentBatch(k, "default"));
            expect(parse(engine.previewRentBatch(kind, '"default"', false)), `previewRentBatch ${label}`).toEqual(sim.previewRentBatch(k, "default"));
          }
          expect(JSON.parse(engine.build("ofice", 2, 150))).toEqual({ ok: false, reason: "Unknown facility." });
          expect(JSON.parse(engine.buildTransport("ofice", 150, 1, 3))).toEqual({ ok: false, reason: "Unknown facility." });
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
      it(`${start.label}: answers whether the id names a shaft, like TypeScript`, () => {
        const { sim, engine } = pair(start);
        try {
          const ids = sim.tower.transports.map((t) => t.id);
          expect(ids.length).toBeGreaterThan(0);
          for (const id of [...ids, 0, -1, 999_999]) {
            const want = sim.tower.setExpressStops(id);
            expect(engine.setExpressStops(id), `id ${id}`).toBe(want);
          }
          expect(engine.setExpressStops(999_999)).toBe(false);
        } finally {
          engine.free();
        }
      });
    }
  });

  describe("validateTransport and placeTransportDryRun", () => {
    const FLOORS = [-3, -1, 0, 1, 2, 3, 6, 10, 31, 60, 120];
    const XS = [-2, 0, 10, 88, 150, 160, 175, 199, 370, 371, 372, 1000];
    /** What a shaft is asked: every kind that is a transport, plus two that are not. */
    const ASKED = [...TRANSPORTS, "office", "floor"] as FacilityKind[];

    for (const start of STARTS) {
      it(`${start.label}: every shaft kind over a grid of columns and floors`, () => {
        const { sim, engine } = pair(start);
        const before = engine.serialize();
        try {
          let accepted = 0;
          let refused = 0;
          const diffs: string[] = [];
          for (const kind of ASKED) {
            for (const x of XS) {
              for (const bottom of FLOORS) {
                for (const top of FLOORS) {
                  const want = sim.tower.validateTransport(kind, x, bottom, top);
                  const got = JSON.parse(engine.validateTransport(kind, x, bottom, top)) as { ok: boolean; reason?: string };
                  const dry = engine.placeTransportDryRun(kind, x, bottom, top);
                  if (want.ok) accepted++;
                  else refused++;
                  if (!isDeepStrictEqual(got, want) || dry !== sim.tower.placeTransportDryRun(kind, x, bottom, top)) {
                    diffs.push(`${kind} x${x} ${bottom}..${top}: rust ${JSON.stringify(got)}/${dry} ts ${JSON.stringify(want)}`);
                  }
                }
              }
            }
          }
          expect(diffs.slice(0, 10)).toEqual([]);
          // The grid reaches accepted shafts as well as every kind of refusal.
          if (start.fixture) expect(accepted).toBeGreaterThan(0);
          expect(refused).toBeGreaterThan(0);
          expect(engine.serialize()).toBe(before);
        } finally {
          engine.free();
        }
      }, 120_000);

      it(`${start.label}: a coordinate that is not a whole number is refused`, () => {
        const { sim, engine } = pair(start);
        try {
          const bad: unknown[] = [0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53, -(2 ** 53), "3", null, undefined, true, 1n, {}, []];
          for (const v of bad) {
            for (const args of [[v, 1, 3], [150, v, 3], [150, 1, v]]) {
              const label = `${String(v)} in ${args.map(String).join(",")}`;
              const [x, b, t] = args as [number, number, number];
              const want = sim.tower.validateTransport("elevatorStandard", x, b, t);
              expect(want, label).toEqual({ ok: false, reason: "That request is not valid." });
              expect(JSON.parse(engine.validateTransport("elevatorStandard", x, b, t)), label).toEqual(want);
              expect(engine.placeTransportDryRun("elevatorStandard", x, b, t), label).toBe(false);
              expect(sim.tower.placeTransportDryRun("elevatorStandard", x, b, t), label).toBe(false);
            }
          }
          // The last safe integer is a whole number: both engines read it and the
          // tower, not the number rule, refuses the shaft off the lot.
          const edge = 2 ** 53 - 1;
          for (const args of [[edge, 1, 3], [-edge, 1, 3], [150, -edge, 3], [150, 1, edge]]) {
            const [x, b, t] = args as [number, number, number];
            const want = sim.tower.validateTransport("elevatorStandard", x, b, t);
            expect(want.ok).toBe(false);
            expect(want.reason, args.join(",")).not.toBe("That request is not valid.");
            expect(JSON.parse(engine.validateTransport("elevatorStandard", x, b, t))).toEqual(want);
          }
          // An argument missing altogether is refused the same way.
          const raw = engine as unknown as { validateTransport(kind: string): string };
          expect(JSON.parse(raw.validateTransport("elevatorStandard"))).toEqual({ ok: false, reason: "That request is not valid." });
        } finally {
          engine.free();
        }
      });
    }
  });
});
