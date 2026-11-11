import { describe, it, expect } from "vitest";
import { createAppHistory } from "../../game/appHistory";
import { look, must, newEngine, noEngine } from "../portKit/rustEngine";
import { LOT_WIDTH } from "../portKit/draftFixtures";

// The app's undo history on the Rust engine. The stack rules the TypeScript
// reference's copy checked until #1875 are `engine-rs/src/undo_tests.rs`, and
// what the undo signature reads is `engine-rs/src/rule_tests/undo_signature.rs`.

describe.skipIf(noEngine)("the app's history through the port", () => {
  // A refused step's reason is the unit suite's (`appHistory.test.ts`, "shows
  // the engine's reason for a refused step and resolves").
  it("steps through the engine and follows the restore, keeping the trail", async () => {
    const enginePort = newEngine(1);
    const toasts: string[] = [];
    const followed: string[] = [];
    const hist = createAppHistory({ enginePort, ui: { toast: (m) => toasts.push(m) }, followSwap: (follow) => followed.push(follow), showSteps: () => {} });
    await hist.undo();
    expect(toasts).toEqual(["Nothing to undo."]);
    expect(followed, "nothing was swapped").toEqual([]);

    hist.capture("build");
    must(look(enginePort).build("lobby", 1, 160), "the lobby");
    hist.commit();
    await hist.undo();
    expect(followed).toEqual(["step"]);
    expect(toasts[toasts.length - 1]).toBe("Undid: build");
    await hist.redo();
    expect(toasts[toasts.length - 1]).toBe("Redid: build");
  });

  it("undo of a build restores the exact tower and keeps a bridging toggle changed afterward", async () => {
    // `restore` carries the live autoBridge across, so undoing a BUILD never
    // silently flips a Settings toggle the player changed after that build.
    const enginePort = newEngine(3, "modern", "realWorld");
    const tower = look(enginePort);
    const hist = createAppHistory({ enginePort, ui: { toast: () => {} }, followSwap: () => {}, showSteps: () => {} });
    const cx = Math.floor(LOT_WIDTH / 2);
    const before = JSON.parse(enginePort.serialize()) as Record<string, unknown>;
    expect(enginePort.autoBridge()).toBe(true);
    hist.capture("Build"); // snapshot taken while bridging is on
    must(tower.tower.place("lobby", 1, cx), "the lobby");
    hist.commit();
    expect(enginePort.chooseAutoBridge(false)[0]).toBe(1); // the player turns bridging off AFTER the build
    await hist.undo();
    expect(tower.tower.structureKindAt(1, cx)).toBeUndefined();
    expect(enginePort.autoBridge()).toBe(false);
    // The step reverses the build, not a snapshot, so the id counter stays
    // past the undone lobby's id (a redo builds it again under that id).
    const after = JSON.parse(enginePort.serialize()) as Record<string, unknown>;
    expect(after.nextId).toBe((before.nextId as number) + 1);
    expect({ ...after, autoBridge: true, nextId: 0 }).toEqual({ ...before, autoBridge: true, nextId: 0 });
  });
});
