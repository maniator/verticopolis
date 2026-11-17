import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../analyticsActions", () => ({ trackAppAction: vi.fn() }));
import { trackAppAction } from "../analyticsActions";
import { PortCodes } from "../simport/portCodes";
import { catalogFor } from "../tests/catalogFixture";
import { LAYOUT, mockPort } from "../tests/portKit/mockPort";
import { groupDigits } from "../ui/format";
import { BuildActions, type BuildActionsDeps } from "./buildActions";
import { quoteRoomRow, roomRowBand, roomRowLabel, type RoomRowQuote } from "./roomRowTool";

/**
 * The row of rooms over a mock port (Modern, #646): how the shell reads the
 * engine's quote, what the ghost's tag says, and the feedback and analytics of
 * `BuildActions.buildRoomRow`. Which rooms fit, their price and the placing
 * are the engine's (`engine-rs/src/sim_room_row_tests.rs`,
 * `wasm_port_room_row_tests.rs`).
 */

/** A port record for `op`, its slots in the engine's layout order, then `tail`. */
function rec(op: string, slots: Record<string, number>, tail: number[] = []): Float64Array {
  return Float64Array.from([...LAYOUT.records[op].map((n) => slots[n] ?? 0), ...tail]);
}

const quote = (q: Partial<RoomRowQuote>): RoomRowQuote => ({ ok: true, cost: 0, rooms: [], ...q });

describe("quoteRoomRow", () => {
  it("asks the engine for the kind, floor and ends, and reads the rooms after the header", () => {
    const port = mockPort({ quoteRoomRow: () => rec("quoteRoomRow", { ok: 1, cost: 120_000, rooms: 3 }, [100, 109, 118]), lastReason: () => "unused" });
    const codes = new PortCodes(port);
    const q = quoteRoomRow(port, codes, "office", 5, 100, 120);
    expect(port.quoteRoomRow).toHaveBeenCalledExactlyOnceWith(codes.kind("office"), 5, 100, 120);
    expect(q).toEqual({ ok: true, cost: 120_000, rooms: [100, 109, 118], reason: undefined });
    expect(port.lastReason).not.toHaveBeenCalled();
  });

  it("keeps the rooms of a row the money does not cover, with the engine's reason", () => {
    const port = mockPort({ quoteRoomRow: () => rec("quoteRoomRow", { ok: 0, cost: 80_000, rooms: 2 }, [118, 109]), lastReason: () => "Not enough money." });
    const q = quoteRoomRow(port, new PortCodes(port), "office", 5, 118, 100);
    expect(q).toEqual({ ok: false, cost: 80_000, rooms: [118, 109], reason: "Not enough money." });
  });
});

describe("the ghost's tag and the length band", () => {
  it("tags a row of two or more with its price and length, and a single room not at all", () => {
    expect(roomRowLabel(quote({ cost: 120_000, rooms: [100, 109, 118] }), groupDigits)).toBe("$120,000, 3 rooms");
    expect(roomRowLabel(quote({ ok: false, cost: 80_000, rooms: [1, 10] }), groupDigits)).toBe("$80,000, 2 rooms");
    expect(roomRowLabel(quote({ cost: 40_000, rooms: [100] }), groupDigits)).toBeUndefined();
    expect(roomRowLabel(quote({ ok: false }), groupDigits)).toBeUndefined();
  });

  it("bands a row's length", () => {
    expect([2, 4, 5, 9, 10, 40].map(roomRowBand)).toEqual(["2-4", "2-4", "5-9", "5-9", "10+", "10+"]);
  });
});

describe("BuildActions.buildRoomRow", () => {
  beforeEach(() => vi.mocked(trackAppAction).mockClear());

  function setup(answers: Parameters<typeof mockPort>[0]) {
    const port = mockPort({ lastReason: () => "Not enough money.", ...answers });
    const codes = new PortCodes(port);
    const deps = {
      enginePort: () => port,
      portCodes: () => codes,
      reader: () => ({}) as never,
      catalog: () => catalogFor("modern"),
      isUnlocked: vi.fn(() => true),
      ui: { toast: vi.fn() },
      audio: { sfx: vi.fn() },
      selectedId: vi.fn((): number | null => null),
      clearSelection: vi.fn(),
      lobbyHeight: vi.fn(() => 1),
    } satisfies BuildActionsDeps;
    return { port, codes, deps, build: new BuildActions(deps) };
  }

  it("places the row in one command, sounds the build and reports its length band", () => {
    const { build, port, codes, deps } = setup({ buildRoomRow: () => rec("buildRoomRow", { status: 1, placed: 6 }) });
    expect(build.buildRoomRow("office", 5, 100, 150)).toEqual({ ok: true, placed: 6 });
    expect(port.buildRoomRow).toHaveBeenCalledExactlyOnceWith(codes.kind("office"), 5, 100, 150);
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("build");
    expect(deps.ui.toast).not.toHaveBeenCalled();
    expect(trackAppAction).toHaveBeenCalledExactlyOnceWith("room_row", "5-9");
  });

  it("reports nothing for a single room", () => {
    const { build } = setup({ buildRoomRow: () => rec("buildRoomRow", { status: 1, placed: 1 }) });
    expect(build.buildRoomRow("office", 5, 100, 100)).toEqual({ ok: true, placed: 1 });
    expect(trackAppAction).not.toHaveBeenCalled();
  });

  it("says why on a refusal, places nothing and reports nothing", () => {
    const { build, deps } = setup({ buildRoomRow: () => rec("buildRoomRow", { status: 0 }) });
    expect(build.buildRoomRow("office", 5, 100, 150)).toEqual({ ok: false, placed: 0, reason: "Not enough money." });
    expect(deps.audio.sfx).toHaveBeenCalledExactlyOnceWith("error");
    expect(deps.ui.toast).toHaveBeenCalledExactlyOnceWith("Not enough money.", "bad");
    expect(trackAppAction).not.toHaveBeenCalled();
  });
});
