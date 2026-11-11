import { afterEach, describe, expect, it } from "vitest";
import type { EnginePort, PortRecord } from "../../simport/enginePort";
import { done, kind, lobbyCenter, must, subject, type Subject } from "../../simport/engineSubject.fixture";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { releaseDrafts } from "../portKit/drafts";

/**
 * The renderer keeps its scene through an undo or redo step and finds the
 * change by the tower revision (towerScene `followStep`). That holds only if
 * every done step raises the revision above every revision the tower had, so
 * the Rust engine is held to it here, step after step.
 */
if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

type RustEngine = EnginePort & { free(): void };
const made: RustEngine[] = [];
afterEach(() => {
  for (const e of made.splice(0)) e.free();
  releaseDrafts();
});

function make(save: string): EnginePort {
  const engine = wasm().Engine.fromSave(save) as unknown as RustEngine;
  made.push(engine);
  return engine;
}

describe.skipIf(!hasWasmPackage())("the Rust engine's undo and redo steps", () => {
  it("raise the tower revision above every earlier one, so the kept scene sees each step", () => {
    const s: Subject = subject(make);
    const mid = lobbyCenter(s);
    const seen: number[] = [];
    const read = (): number => {
      s.reader.update();
      seen.push(s.reader.tower.revision);
      return s.reader.tower.revision;
    };
    read();
    for (const floor of [2, 3]) {
      s.port.undoCapture("Build Office");
      must(s, (p) => p.buildAt(kind("office"), floor, mid - 4), `office on ${floor}`);
      expect(s.port.undoCommit()).toBe(true);
      read();
    }
    const undo = (): PortRecord => s.port.undo();
    const redo = (): PortRecord => s.port.redo();
    for (const [name, step] of [["undo", undo], ["undo", undo], ["redo", redo], ["undo", undo], ["redo", redo], ["redo", redo]] as const) {
      const highest = Math.max(...seen);
      expect(done(step()), name).toBe(true);
      expect(read(), `${name} after revisions ${seen.slice(0, -1).join(", ")}`).toBeGreaterThan(highest);
    }
    const offices = s.reader.tower.units.filter((u) => u.kind === "office");
    expect(offices.map((u) => u.floor).sort((a, b) => a - b), "both offices are back").toEqual([2, 3]);
  });
});
