import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../analyticsActions", () => ({ trackAppAction: vi.fn() }));
import { trackAppAction } from "../analyticsActions";
import { PortCodes } from "@verticopolis/engine/port/portCodes";
import { catalogFor } from "../tests/catalogFixture";
import { LAYOUT, mockPort } from "../tests/portKit/mockPort";
import { groupDigits } from "@verticopolis/components/windows/format";
import { BuildActions, type BuildActionsDeps } from "./buildActions";
import { pickSkyBridgeLook } from "../ui/skyBridgeLookStrip";
import type { SkyBridgeView } from "@verticopolis/engine/port/view";
import {
  finishesHalfBridge,
  quoteSkyBridge,
  quotedTiles,
  skyBridgeLabel,
  tapLays,
  type SkyBridgeQuote,
} from "./skyBridgeTool";

/**
 * The Sky Bridge tool over a mock port: how the shell reads the engine's quote,
 * what the ghost's tag says, when a phone's second tap lays the bridge, and the
 * feedback and analytics of `BuildActions.buildSkyBridge`. Whether a gap is a
 * bridge, its price and the laying itself are the engine's
 * (`src/tower/skybridge_tests.rs`, `wasm_port_skybridge_tests.rs`).
 */

/** A port record for `op`, its slots in the engine's layout order. */
function rec(op: string, slots: Record<string, number>): Float64Array {
  return Float64Array.from(LAYOUT.records[op].map((n) => slots[n] ?? 0));
}

const quote = (q: Partial<SkyBridgeQuote>): SkyBridgeQuote => ({ ok: true, cost: 0, from: 0, to: 0, ...q });

describe("quoteSkyBridge", () => {
  it("asks the engine for the floor and column and reads the span and price", () => {
    const port = mockPort({
      quoteSkyBridge: () => rec("quoteSkyBridge", { ok: 1, cost: 44_000, from: 120, to: 124 }),
      lastReason: () => "unused",
    });
    const q = quoteSkyBridge(port, new PortCodes(port), 30, 121);
    expect(port.quoteSkyBridge).toHaveBeenCalledExactlyOnceWith(30, 121);
    expect(q).toEqual({ ok: true, cost: 44_000, from: 120, to: 124, reason: undefined });
    expect(port.lastReason).not.toHaveBeenCalled();
  });

  it("carries the engine's reason only on a refusal", () => {
    const port = mockPort({
      quoteSkyBridge: () => rec("quoteSkyBridge", { ok: 0 }),
      lastReason: () => "Point at the gap.",
    });
    const q = quoteSkyBridge(port, new PortCodes(port), 30, 5);
    expect(q.ok).toBe(false);
    expect(q.reason).toBe("Point at the gap.");
  });
});

describe("the ghost's tag and the tap flow", () => {
  it("counts the tiles a quote lays, never below zero", () => {
    expect(quotedTiles(quote({ from: 120, to: 124 }))).toBe(4);
    expect(quotedTiles(quote({ ok: false, from: 0, to: 0 }))).toBe(0);
    expect(quotedTiles(quote({ ok: false, from: 9, to: 3 }))).toBe(0);
  });

  it("tags the whole bridge's price and length, and nothing off a gap", () => {
    expect(skyBridgeLabel(quote({ cost: 44_000, from: 120, to: 124 }), groupDigits)).toBe("$44,000, 4 tiles");
    expect(skyBridgeLabel(quote({ cost: 11_000, from: 7, to: 8 }), groupDigits)).toBe("$11,000, 1 tile");
    expect(skyBridgeLabel(quote({ ok: false }), groupDigits)).toBeUndefined();
  });

  it("lays on a second tap only on the same bridge the first tap showed", () => {
    const shown = { floor: 30, from: 120, to: 124 };
    const same = quote({ from: 120, to: 124 });
    expect(tapLays(shown, 30, same)).toBe(true);
    expect(tapLays(null, 30, same)).toBe(false);
    expect(tapLays(shown, 45, same)).toBe(false);
    expect(tapLays(shown, 30, quote({ from: 120, to: 125 }))).toBe(false);
    expect(tapLays({ floor: 30, from: 0, to: 0 }, 30, quote({ ok: false }))).toBe(false);
  });

  it("names a bridge that finishes a half bridge from an old save", () => {
    // A bridge tile is a lobby tile over open air.
    const at = new Map<string, string>([
      ["30:119", "lobby"],
      ["30:130", "lobby"],
      ["29:130", "floor"],
    ]);
    const reader = { tower: { structureKindAt: (floor: number, x: number) => at.get(`${floor}:${x}`) } } as never;
    expect(finishesHalfBridge(reader, 30, quote({ from: 120, to: 124 }))).toBe(true);
    // A tower's sky lobby at the far end stands on a floor: a new bridge.
    expect(finishesHalfBridge(reader, 30, quote({ from: 125, to: 130 }))).toBe(false);
  });
});

describe("BuildActions.buildSkyBridge", () => {
  beforeEach(() => vi.mocked(trackAppAction).mockClear());

  beforeEach(() => pickSkyBridgeLook(1, null));

  function setup(
    answers: Parameters<typeof mockPort>[0],
    kinds: Record<string, string> = {},
    bridges: SkyBridgeView[] = [],
  ) {
    const port = mockPort({ lastReason: () => "Not enough money.", ...answers });
    const codes = new PortCodes(port);
    const tower = {
      structureKindAt: vi.fn((floor: number, x: number) => kinds[`${floor}:${x}`]),
      skyBridges: () => bridges,
    };
    const deps = {
      enginePort: () => port,
      portCodes: () => codes,
      reader: () => ({ tower }) as never,
      catalog: () => catalogFor("modern"),
      isUnlocked: vi.fn(() => true),
      ui: { toast: vi.fn() },
      audio: { sfx: vi.fn() },
      selectedId: vi.fn((): number | null => null),
      clearSelection: vi.fn(),
      lobbyHeight: vi.fn(() => 1),
    } satisfies BuildActionsDeps;
    return { port, deps, build: new BuildActions(deps) };
  }

  it("lays the bridge in one command, sounds the build and reports a new bridge", () => {
    const { build, port, deps } = setup({
      quoteSkyBridge: () => rec("quoteSkyBridge", { ok: 1, cost: 44_000, from: 120, to: 124 }),
      buildSkyBridge: () => rec("buildSkyBridge", { status: 1, tiles: 4 }),
    });
    pickSkyBridgeLook(2, null);
    expect(build.buildSkyBridge(121, 30)).toEqual({ ok: true, tiles: 4, restyled: false });
    expect(port.buildSkyBridge).toHaveBeenCalledExactlyOnceWith(30, 121, 2);
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("build");
    expect(deps.ui.toast).not.toHaveBeenCalled();
    expect(vi.mocked(trackAppAction).mock.calls).toEqual([
      ["sky_bridge", "new"],
      ["sky_bridge_look", "Steel Truss"],
    ]);
  });

  it("dresses a finished bridge in the picked look, free, instead of building", () => {
    const { build, port, deps } = setup(
      {
        restyleSkyBridge: () => rec("restyleSkyBridge", { status: 1 }),
        buildSkyBridge: () => rec("buildSkyBridge", { status: 1 }),
      },
      { "30:119": "lobby", "30:124": "lobby" },
      [{ floor: 30, from: 120, to: 124, look: 1 }],
    );
    pickSkyBridgeLook(4, null);
    expect(build.buildSkyBridge(122, 30)).toEqual({ ok: true, tiles: 0, restyled: true });
    expect(port.restyleSkyBridge).toHaveBeenCalledExactlyOnceWith(30, 122, 4);
    expect(port.buildSkyBridge).not.toHaveBeenCalled();
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("build");
    expect(vi.mocked(trackAppAction).mock.calls).toEqual([
      ["sky_bridge", "restyle"],
      ["sky_bridge_look", "Garden Walk"],
    ]);
  });

  it("says so when the bridge already wears the picked look, and asks the engine nothing", () => {
    const { build, port, deps } = setup(
      { restyleSkyBridge: () => rec("restyleSkyBridge", { status: 1 }) },
      { "30:119": "lobby", "30:124": "lobby" },
      [{ floor: 30, from: 120, to: 124, look: 1 }],
    );
    const r = build.buildSkyBridge(122, 30);
    expect(r.ok).toBe(false);
    expect(port.restyleSkyBridge).not.toHaveBeenCalled();
    expect(deps.ui.toast).toHaveBeenCalledExactlyOnceWith(
      "This sky bridge already has that look. Pick another look on the strip.",
      "info",
    );
    expect(trackAppAction).not.toHaveBeenCalled();
  });

  it("reports finishing a half bridge when a bridge tile stands beside the gap", () => {
    const { build } = setup(
      {
        quoteSkyBridge: () => rec("quoteSkyBridge", { ok: 1, cost: 22_000, from: 120, to: 122 }),
        buildSkyBridge: () => rec("buildSkyBridge", { status: 1, tiles: 2 }),
      },
      { "30:119": "lobby" },
    );
    build.buildSkyBridge(120, 30);
    expect(trackAppAction).toHaveBeenCalledWith("sky_bridge", "finish");
  });

  it("says why on a refusal, lays nothing and reports nothing", () => {
    const { build, deps } = setup({
      quoteSkyBridge: () => rec("quoteSkyBridge", { ok: 1, cost: 44_000, from: 120, to: 124 }),
      buildSkyBridge: () => rec("buildSkyBridge", { status: 0 }),
    });
    expect(build.buildSkyBridge(121, 30)).toEqual({
      ok: false,
      reason: "Not enough money.",
      tiles: 0,
      restyled: false,
    });
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("error");
    expect(deps.ui.toast).toHaveBeenCalledExactlyOnceWith("Not enough money.", "bad");
    expect(trackAppAction).not.toHaveBeenCalled();
  });
});
