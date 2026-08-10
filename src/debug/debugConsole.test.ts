import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebugConsole, resolveDrawRequest, UNSAFE_MARKER, type ConsoleDeps } from "./debugConsole";
import { DEBUG_SECTIONS, noDebugFlags, readStoredSpec, writeStoredSpec, type DebugFlags } from "./debugFlags";
import { emptyReading, type DebugHud } from "./debugHud";
import { ACTOR_NAMES } from "../render/excalibur/actorNames";

function fakeHud(): DebugHud & { shown: boolean } {
  const hud = {
    shown: false,
    setVisible(on: boolean) {
      hud.shown = on;
    },
    visible: () => hud.shown,
    sample: () => emptyReading(),
    reading: () => emptyReading(),
    dispose: () => {},
  };
  return hud;
}

function deps(over: Partial<ConsoleDeps> = {}): ConsoleDeps & { flags: DebugFlags; applyDraw: ReturnType<typeof vi.fn> } {
  const base = {
    hud: fakeHud(),
    flags: noDebugFlags(),
    applyDraw: vi.fn(),
    applyFilter: vi.fn(),
    frameStats: () => ({ systemDuration: { "draw:GraphicsSystem.update": 5, "update:MotionSystem.update": 2, "update:PointerSystem.update": 1 } }),
  };
  return { ...base, ...over } as ConsoleDeps & { flags: DebugFlags; applyDraw: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("resolveDrawRequest", () => {
  it("toggles against what is currently on when given nothing", () => {
    expect(resolveDrawRequest(undefined, [])).toEqual([...DEBUG_SECTIONS]);
    expect(resolveDrawRequest(undefined, ["camera"])).toEqual([]);
  });

  it("takes an explicit boolean", () => {
    expect(resolveDrawRequest(true, [])).toEqual([...DEBUG_SECTIONS]);
    expect(resolveDrawRequest(false, ["camera"])).toEqual([]);
  });

  it("accepts one section or a list, case-insensitively", () => {
    expect(resolveDrawRequest("Collider", [])).toEqual(["collider"]);
    expect(resolveDrawRequest(["motion", "entity"], [])).toEqual(["entity", "motion"]);
  });

  it("normalizes to DEBUG_SECTIONS order so a serialized spec round-trips", () => {
    expect(resolveDrawRequest(["camera", "entity"], [])).toEqual(["entity", "camera"]);
  });

  it("warns about an unknown section and keeps the valid ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveDrawRequest(["motion", "nope"], [])).toEqual(["motion"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nope"));
  });
});

describe("createDebugConsole", () => {
  it("toggles the HUD and records it in the flags", () => {
    const d = deps();
    const api = createDebugConsole(d);
    expect(api.fps()).toBe(true);
    expect(d.hud.visible()).toBe(true);
    expect(d.flags.hud).toBe(true);
    expect(api.fps()).toBe(false);
    expect(d.flags.hud).toBe(false);
  });

  it("accepts an explicit HUD state", () => {
    const d = deps();
    const api = createDebugConsole(d);
    expect(api.fps(false)).toBe(false);
    expect(api.fps(true)).toBe(true);
  });

  it("pushes draw sections to the engine and records them", () => {
    const d = deps();
    const api = createDebugConsole(d);
    expect(api.draw("collider")).toEqual(["collider"]);
    expect(d.applyDraw).toHaveBeenCalledWith(["collider"]);
    expect(d.flags.draw).toEqual(["collider"]);
  });

  it("reads the filter with no argument and clears it with false", () => {
    const d = deps();
    const api = createDebugConsole(d);
    expect(api.filter()).toBeNull();
    expect(api.filter("person")).toBe("person");
    expect(d.applyFilter).toHaveBeenCalledWith("person");
    expect(api.filter()).toBe("person"); // reading does not clear
    expect(api.filter(false)).toBeNull();
    expect(d.applyFilter).toHaveBeenLastCalledWith(null);
  });

  it("lists more than the panel's three systems", () => {
    // The HUD snapshot caps at its own top-3, so going through it would make
    // systems(10) quietly a systems(3).
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    createDebugConsole(deps()).systems(10);
    expect(table).toHaveBeenCalledWith([
      { system: "draw:GraphicsSystem", ms: 5 },
      { system: "update:MotionSystem", ms: 2 },
      { system: "update:PointerSystem", ms: 1 },
    ]);
  });

  it("honors the requested system count", () => {
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    createDebugConsole(deps()).systems(1);
    expect(table).toHaveBeenCalledWith([{ system: "draw:GraphicsSystem", ms: 5 }]);
  });

  it("says so plainly when no frame has been timed yet", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const table = vi.spyOn(console, "table").mockImplementation(() => {});
    createDebugConsole(deps({ frameStats: () => undefined })).systems();
    expect(table).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("no system timings"));
  });

  it("persists the live flags, not the boot ones", () => {
    const d = deps();
    const api = createDebugConsole(d);
    api.fps(true);
    api.draw("motion");
    expect(api.persist()).toBe("fps,draw:motion");
    expect(readStoredSpec()).toBe("fps,draw:motion");
  });

  it("clears the stored spec on persist(false)", () => {
    writeStoredSpec("fps");
    expect(createDebugConsole(deps()).persist(false)).toBeNull();
    expect(readStoredSpec()).toBeNull();
  });

  it("reports null rather than an empty spec when nothing is on", () => {
    expect(createDebugConsole(deps()).persist()).toBeNull();
  });

  it("prints help that names the current state", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const d = deps();
    const api = createDebugConsole(d);
    api.fps(true);
    api.help();
    const text = String(log.mock.calls[0][0]);
    expect(text).toContain("vcdebug.fps()");
    expect(text).toContain("now: fps");
    // The counter-contamination caveat belongs where someone will actually read it.
    expect(text).toContain("inflates");
  });

  it("lists every actor name from the renderer's own vocabulary", () => {
    // Derived, not restated: a hand-written list silently went stale the moment
    // the scenery and region actors were named.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    createDebugConsole(deps()).help();
    const text = String(log.mock.calls[0][0]);
    for (const name of Object.values(ACTOR_NAMES)) expect(text).toContain(name);
  });

  it("wraps the actor-name list instead of emitting one long line", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    createDebugConsole(deps()).help();
    const lines = String(log.mock.calls[0][0]).split("\n");
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
  });
});

describe("the unsafe half", () => {
  // Vitest runs with import.meta.env.DEV true, so this is the dev-serve branch.
  // A production build replaces both operands with false and Rollup drops the
  // block; scripts/verify-game-handle.ts asserts that on the built artifact,
  // which is the only place it can honestly be checked.
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("is absent when no app is supplied", () => {
    expect(createDebugConsole(deps()).unsafe).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("installs the mutators and warns once when an app is supplied", () => {
    const app = { sim: { money: 100 }, setSpeed: vi.fn() };
    const api = createDebugConsole(deps({ app }));
    expect(warn).toHaveBeenCalledWith(UNSAFE_MARKER);
    expect(api.unsafe?.app).toBe(app);
    expect(api.unsafe?.money(5000)).toBe(5000);
    expect(app.sim.money).toBe(5000);
    expect(api.unsafe?.speed(2)).toBe(2);
    expect(app.setSpeed).toHaveBeenCalledWith(2);
  });
});
