import { describe, expect, it } from "vitest";
import { engineSettingsView, reasonWords, type EngineSettingsInput } from "./settingsView";
import { FALLBACK_REASONS } from "../wasmhost/engineBoot";
import type { Selection } from "./policy";
import type { SafetyRecord } from "./records";

const fault: SafetyRecord = { v: 1, scope: "fault", reason: "trap-tick", stage: "host", sha: "a", at: 1 };

function sel(over: Partial<Selection> = {}): Selection {
  return { boot: "ts", requested: "ts", selectedBy: "cohort", assignedArm: "ts", stage: 1, preference: "auto", suppression: null, crashLoop: false, transition: "none", notice: "none", markerId: null, ...over };
}

function input(over: Partial<EngineSettingsInput> = {}): EngineSettingsInput {
  return { selection: sel(), running: "ts", preference: "auto", suppression: null, pageFallback: null, storable: true, ...over };
}

describe("engineSettingsView while only a choice boots Rust", () => {
  it("says why an old test host runs TypeScript and offers no restart", () => {
    const v = engineSettingsView(input({ preference: "wasm-frame", rustOnlyByChoice: true, selection: sel({ selectedBy: "setting", requested: "wasm-frame", heldForChoice: true }) }));
    expect(v.note).toBe("For now the Rust engine runs only when you pick it here or open a test link, so the game uses the TypeScript engine.");
    expect(v.restart).toBe(false);
    // A test link's Rust page says nothing.
    expect(engineSettingsView(input({ preference: "wasm", rustOnlyByChoice: true, running: "wasm", selection: sel({ selectedBy: "url", boot: "wasm" }) })).note).toBeNull();
  });

  it("lets the Rust engine itself run: picked on TypeScript, it asks for a restart and explains nothing", () => {
    const v = engineSettingsView(input({ preference: "wasm", rustOnlyByChoice: true, selection: sel({ selectedBy: "default", requested: "ts" }) }));
    expect(v.note).toBeNull();
    expect(v.restart).toBe(true);
  });

  it("lets the cohort's draw run Rust: Automatic on the WASM arm stays there with nothing to explain", () => {
    const v = engineSettingsView(input({ rustOnlyByChoice: true, running: "wasm", selection: sel({ selectedBy: "cohort", assignedArm: "wasm", requested: "wasm", boot: "wasm" }) }));
    expect(v).toMatchObject({ choice: "auto", running: "Rust engine", note: null, restart: false });
  });
});

describe("engineSettingsView", () => {
  it("shows Automatic on the TypeScript arm with nothing to explain", () => {
    expect(engineSettingsView(input())).toEqual({ choice: "auto", testHost: false, running: "TypeScript engine", note: null, retry: false, restart: false, storable: true });
  });

  it("shows the engine that is running rather than the stored choice", () => {
    const v = engineSettingsView(input({ selection: sel({ assignedArm: "wasm", boot: "wasm", requested: "wasm" }), running: "wasm" }));
    expect(v).toMatchObject({ choice: "auto", running: "Rust engine", restart: false });
  });

  it("asks for a restart when the stored choice changed, and never otherwise", () => {
    expect(engineSettingsView(input({ preference: "wasm" })).restart).toBe(true);
    expect(engineSettingsView(input({ preference: "ts" })).restart).toBe(false);
    expect(engineSettingsView(input({ running: "wasm", selection: sel({ assignedArm: "wasm", boot: "wasm" }), preference: "ts" })).restart).toBe(true);
  });

  it("asks for no restart when the next start repeats this one, as after a refused tower", () => {
    expect(engineSettingsView(input({ running: "ts", selection: sel({ assignedArm: "wasm", boot: "wasm", requested: "wasm" }) })).restart).toBe(false);
  });

  it("offers no retry where the choice gives TypeScript anyway", () => {
    expect(engineSettingsView(input({ selection: sel({ assignedArm: "ts" }), suppression: fault })).retry).toBe(false);
  });

  it("explains a suppression from an earlier session and offers the retry", () => {
    const v = engineSettingsView(input({ selection: sel({ selectedBy: "safety", suppression: fault, assignedArm: "wasm", requested: "wasm" }), suppression: fault }));
    expect(v.note).toBe("The Rust engine had a problem on this device earlier (it stopped while running), so the game uses the TypeScript engine.");
    expect(v).toMatchObject({ retry: true, restart: false });
  });

  it("asks for a restart once the retry cleared the suppression", () => {
    const v = engineSettingsView(input({ selection: sel({ selectedBy: "safety", suppression: fault, assignedArm: "wasm", requested: "wasm" }), suppression: null }));
    expect(v).toMatchObject({ retry: false, restart: true });
  });

  it("explains a fallback in this session", () => {
    const v = engineSettingsView(input({ selection: sel({ assignedArm: "wasm", boot: "wasm" }), pageFallback: "trap-command", suppression: fault }));
    expect(v.note).toBe("The Rust engine had a problem in this session (it stopped while running), so the game switched to the TypeScript engine.");
    expect(v).toMatchObject({ retry: true, restart: false });
  });

  it("offers no retry to a player who chose TypeScript", () => {
    expect(engineSettingsView(input({ preference: "ts", suppression: fault })).retry).toBe(false);
  });

  it("marks a tester's experimental host as the Rust choice", () => {
    expect(engineSettingsView(input({ preference: "wasm-worker" }))).toMatchObject({ choice: "rust", testHost: true });
    expect(engineSettingsView(input({ preference: "wasm" }))).toMatchObject({ choice: "rust", testHost: false });
  });

  it("asks for no restart on a URL visit", () => {
    expect(engineSettingsView(input({ selection: sel({ selectedBy: "url", boot: "wasm" }), running: "wasm" })).restart).toBe(false);
  });

  it("explains a browser that could not keep the crash check, and expects TypeScript at the next start", () => {
    const v = engineSettingsView(input({ preference: "wasm", selection: sel({ selectedBy: "setting", requested: "wasm", preference: "wasm", markerBlocked: true }) }));
    expect(v.note).toBe("This browser could not save the Rust engine's crash check, so the game uses the TypeScript engine.");
    expect(v).toMatchObject({ retry: false, restart: false });
    expect(engineSettingsView(input({ preference: "ts", selection: sel({ markerBlocked: true }) })).note).toBeNull();
  });

  it("explains a tab held on TypeScript after its crashes, and expects TypeScript at its next start", () => {
    const v = engineSettingsView(input({ preference: "wasm", selection: sel({ selectedBy: "setting", requested: "wasm", preference: "wasm", heldAfterCrashes: true }) }));
    expect(v.note).toBe("The Rust engine stopped twice in this tab, so the game uses the TypeScript engine here. A new tab tries it again.");
    expect(v).toMatchObject({ retry: false, restart: false });
  });

  it("asks for a restart after a retry in the page life where Rust failed", () => {
    const failed = { selection: sel({ assignedArm: "wasm", boot: "wasm", requested: "wasm" }), running: "ts" as const, pageFallback: "trap-tick" };
    expect(engineSettingsView(input({ ...failed, suppression: fault })).restart).toBe(false);
    expect(engineSettingsView(input({ ...failed, suppression: null })).restart).toBe(false);
    expect(engineSettingsView(input({ ...failed, suppression: null, retried: true })).restart).toBe(true);
  });

  it("puts every code in words", () => {
    for (const c of ["trap-command", "trap-tick", "trap-undo", "boot-error", "boot-timeout", "package-mismatch", "unverifiable", "attach-refused", "unclean-exit", "trap-loop", "corrupt", "other"]) {
      expect(reasonWords(c)).toMatch(/^[a-z]/);
    }
    // Every coded fallback reason has its own words, so a new code cannot fall through unnoticed.
    for (const c of FALLBACK_REASONS.filter((r) => r !== "none" && r !== "other")) expect(reasonWords(c)).not.toBe(reasonWords("other"));
    // The traps share one phrase; every other kind of failure reads differently.
    const kinds = ["trap-tick", "trap-loop", "boot-error", "boot-timeout", "package-mismatch", "unverifiable", "attach-refused", "unclean-exit", "corrupt", "other"];
    expect(new Set(kinds.map(reasonWords)).size).toBe(kinds.length);
  });
});
