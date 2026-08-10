import { afterEach, describe, expect, it, vi } from "vitest";
import { publishDebugStub, type DebugStub } from "./consoleStub";

const global = globalThis as Record<string, unknown>;
const stub = (): DebugStub => global.vcdebug as DebugStub;

afterEach(() => {
  delete global.vcdebug;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** The narrow shape installDebug needs, enough to boot the real surface. */
function fakeApp(): unknown {
  const sections = [
    "entity",
    "transform",
    "graphics",
    "collider",
    "physics",
    "motion",
    "body",
    "camera",
    "tilemap",
  ];
  return {
    engine: {
      engine: {
        on: () => {},
        off: () => {},
        stats: { currFrame: { fps: 60 } },
        debug: {
          filter: { useFilter: false, nameQuery: "", ids: [] },
          ...Object.fromEntries(sections.map((s) => [s, { showAll: false }])),
        },
        showDebug: () => {},
      },
      cam: { zoom: 1 },
      crowdCulled: false,
    },
    sim: { money: 0 },
    setSpeed: () => {},
  };
}

describe("publishDebugStub", () => {
  it("publishes a reachable vcdebug in a session with no debug flag", () => {
    // The whole reason this exists: the hitch you want to measure has already
    // happened by the time you open devtools, and reloading with ?debug=
    // destroys the state that caused it.
    expect(global.vcdebug).toBeUndefined();
    publishDebugStub(fakeApp());
    expect(typeof stub().on).toBe("function");
  });

  it("loads nothing until asked", () => {
    publishDebugStub(fakeApp());
    // No HUD, no surface: publishing the stub must not drag in the chunk.
    expect(document.getElementById("debug-hud")).toBeNull();
    expect(Object.keys(stub())).toEqual(["on", "help"]);
  });

  it("help() points at the one call that starts it", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    publishDebugStub(fakeApp());
    stub().help();
    expect(String(log.mock.calls[0][0])).toContain("await vcdebug.on()");
  });

  it("on() installs the full surface and replaces itself", async () => {
    publishDebugStub(fakeApp());
    const api = (await stub().on()) as Record<string, unknown>;
    expect(typeof api.fps).toBe("function");
    expect(typeof api.systems).toBe("function");
    // window.vcdebug is now the real API, so everything after is synchronous.
    expect(global.vcdebug).toBe(api);
    expect("on" in (global.vcdebug as object)).toBe(false);
  });

  it("on() is idempotent, so a second call cannot install twice", async () => {
    publishDebugStub(fakeApp());
    const first = await stub().on();
    const again = await (first as { on?: () => Promise<unknown> }).on?.();
    expect(again).toBeUndefined(); // the real API has no `on`
    expect(global.vcdebug).toBe(first);
  });

  it("two concurrent on() calls install exactly one surface", async () => {
    // `vcdebug.on(); vcdebug.on()` pasted as one line: both calls clear the
    // installed() check before either import resolves. Two surfaces would mean
    // two rAF loops, only the second of them reachable to dispose, so the first
    // spins for the life of the page.
    //
    // Two guards cover this and either one alone is sufficient (verified by
    // mutation: the test only fails when BOTH are removed): the memoized
    // in-flight promise, and the re-check inside the `.then`. This pins the
    // outcome rather than either mechanism, which is the property that matters.
    publishDebugStub(fakeApp());
    const s = stub();
    const [a, b] = await Promise.all([s.on(), s.on()]);
    expect(a).toBe(b);
    expect(global.vcdebug).toBe(a);
  });

  it("never clobbers a surface that is already live", () => {
    const live = { marker: true };
    global.vcdebug = live;
    publishDebugStub(fakeApp());
    // A flagged session installs the full surface first; the stub must not
    // overwrite it with a loader that would then reinstall over the top.
    expect(global.vcdebug).toBe(live);
  });

  it("survives a global that refuses the write, rather than failing boot", () => {
    // A setter that throws is the realistic hostile case (a hardened page, an
    // extension guarding the global). This runs during boot, so any throw here
    // would take the game down over a developer tool.
    Object.defineProperty(globalThis, "vcdebug", {
      configurable: true,
      get: () => undefined,
      set: () => {
        throw new Error("refused");
      },
    });
    try {
      expect(() => publishDebugStub(fakeApp())).not.toThrow();
      expect(global.vcdebug).toBeUndefined();
    } finally {
      delete (globalThis as Record<string, unknown>).vcdebug;
    }
  });
});
