import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { stateView } from "../../engine/conformanceView";
import { INVALID_REQUEST } from "../../engine/request";
import type { BrushKind } from "../../engine/sim/brush";
import type { SerializedGame } from "../../engine/serializedGame";
import { digest } from "../conformance/canonical";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { DualRun, FrameDriver } from "../dualrun/dualRunHarness";

/**
 * The floor and lobby brush under the mirror: one engine call in TypeScript,
 * relayed as one `paintBrush` command, and the Rust engine's own brush ends
 * in the same state, unit order included, with the same events. A malformed
 * brush is refused in both, through the mirror and called raw, straight into
 * the wasm-bindgen glue.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

const span = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

describe.skipIf(!hasWasmPackage())("dual run: the brush", () => {
  it("relays as one command and stays in step, lobby upgrades and refusals included", () => {
    const { sim, run } = DualRun.found(5, "classic");
    sim.money = 1e9;
    const inStep = (label: string) => expect(run.shadow.handle().stateDigest(), label).toBe(digest(stateView(sim)));
    const brush = (kind: BrushKind, floor: number, tiles: number[]) => {
      const before = run.report.commands;
      const r = sim.paintBrush(kind, floor, tiles);
      expect(run.report.commands - before, "one relayed command").toBe(1);
      inStep(`${String(kind)} ${String(floor)} ${JSON.stringify(tiles)}`);
      return r;
    };

    expect(brush("floor", 1, span(170, 202))).toEqual({ placed: 32 });
    expect(brush("floor", 1, span(202, 206)).placed).toBe(4);
    for (let floor = 2; floor <= 14; floor++) {
      brush("floor", floor, span(170, 202));
      brush("floor", floor, span(202, 206));
    }
    brush("floor", 15, span(170, 200));
    // Upgrades of plain floor (199, 198, 175, 180), a bare tile on supported
    // ground (203, whose bridge lays 200 to 202, so 200 is then skipped), a
    // repeated column and a tile with nothing under it (210).
    const r = brush("lobby", 15, [199, 203, 198, 175, 200, 198, 210, 180]);
    expect(r.placed).toBe(5);
    expect(r.reason).toBeDefined();
    expect(sim.tower.structureKindAt(15, 201)).toBe("lobby");

    // Malformed brushes: nothing laid in either engine.
    const loose = (v: unknown) => v as never;
    const invalid = { placed: 0, reason: INVALID_REQUEST };
    expect(brush(loose("office"), 15, [180])).toEqual(invalid);
    expect(brush("floor", 16.5, [180])).toEqual(invalid);
    expect(brush("floor", loose("16"), [180])).toEqual(invalid);
    expect(brush("floor", 16, loose([180.5]))).toEqual(invalid);
    expect(brush("floor", 16, loose(["180"]))).toEqual(invalid);
    // eslint-disable-next-line no-sparse-arrays
    expect(brush("floor", 16, loose([, 180]))).toEqual(invalid);
    expect(brush("floor", 16, loose(null))).toEqual(invalid);
    expect(brush("floor", 16, span(150, 183))).toEqual(invalid);

    new FrameDriver(sim, 3).run(120);
    const report = run.stop();
    expect(report.divergences).toEqual([]);
    expect(report.eventDivergences).toEqual([]);
    expect(report.checkpoints).toBeGreaterThan(0);
  });

  it("refuses a malformed brush called raw as TypeScript does, moving nothing", () => {
    const built = Simulation.newGame(5, "classic");
    built.money = 1e9;
    for (let x = 150; x < 160; x++) expect(built.build("lobby", 1, x).ok).toBe(true);
    for (let floor = 2; floor <= 15; floor++) for (let x = 150; x < 154; x++) expect(built.build("floor", floor, x).ok).toBe(true);
    const save = JSON.stringify(built.serialize());
    const sim = Simulation.deserialize(JSON.parse(save) as SerializedGame);
    type Raw = (...args: unknown[]) => string;
    const engine = wasm().Engine.fromSave(save) as unknown as { paintBrush: Raw; stateDigest(): string; drainGameplayEvents(): string; free(): void };
    try {
      const start = digest(stateView(sim));
      expect(engine.stateDigest()).toBe(start);
      sim.drainGameplayEvents();
      engine.drainGameplayEvents();
      const invalid = { placed: 0, reason: INVALID_REQUEST };
      const paint = (kind: unknown, floor: unknown, tiles: unknown) => sim.paintBrush(kind as BrushKind, floor as number, tiles as number[]);
      const raw = (kind: unknown, floor: unknown, tiles: unknown): unknown => JSON.parse(engine.paintBrush(kind, floor, tiles));
      const odd = [null, undefined, true, Number.NaN, 2.5, 2 ** 53, BigInt(2), Symbol("x"), {}, [], new Number(2), new String("floor")];
      const label = (v: unknown) => (typeof v === "symbol" || typeof v === "bigint" ? String(typeof v) : JSON.stringify(v) ?? "undefined");
      for (const kind of [...odd, 7, "", "office", "Floor"]) {
        expect(raw(kind, 0, "[150]"), `kind ${label(kind)}`).toEqual(paint(kind, 0, [150]));
        expect(raw(kind, 0, "[150]")).toEqual(invalid);
      }
      for (const floor of [...odd, "0", -0.5]) {
        expect(raw("floor", floor, "[150]"), `floor ${label(floor)}`).toEqual(paint("floor", floor, [150]));
        expect(raw("floor", floor, "[150]")).toEqual(invalid);
      }
      // The binding takes the tiles as JSON text; anything else is refused.
      for (const tiles of [...odd, [150]]) expect(raw("floor", 0, tiles), `tiles ${label(tiles)}`).toEqual(invalid);
      expect(digest(stateView(sim)), "TypeScript moved").toBe(start);
      expect(engine.stateDigest(), "Rust moved").toBe(start);
      expect(sim.drainGameplayEvents()).toEqual([]);
      expect(JSON.parse(engine.drainGameplayEvents())).toEqual([]);
      // Well formed, both lay the same tile under the lobby.
      expect(raw("floor", 0, "[150]")).toEqual({ placed: 1 });
      expect(paint("floor", 0, [150])).toEqual({ placed: 1 });
      expect(engine.stateDigest()).toBe(digest(stateView(sim)));
      // A lobby over plain floor and a tile with nothing under it: the same
      // answer, reason included, and the same state, unit order included.
      const upgrade = paint("lobby", 15, [151, 150, 170]);
      expect(upgrade.placed).toBe(2);
      expect(upgrade.reason).toBeDefined();
      expect(raw("lobby", 15, "[151,150,170]")).toEqual(upgrade);
      expect(engine.stateDigest()).toBe(digest(stateView(sim)));
      expect(JSON.parse(engine.drainGameplayEvents())).toEqual(JSON.parse(JSON.stringify(sim.drainGameplayEvents())));
    } finally {
      engine.free();
    }
  });
});
