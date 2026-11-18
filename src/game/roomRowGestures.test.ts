import { describe, expect, it, vi } from "vitest";
vi.mock("./buildPreview", () => ({ updateBuildRefusal: vi.fn(), clearBuildRefusal: vi.fn() }));
import { clearBuildRefusal, updateBuildRefusal } from "./buildPreview";
import { PortCodes } from "../simport/portCodes";
import { catalogFor } from "../tests/catalogFixture";
import { LAYOUT, mockPort } from "../tests/portKit/mockPort";
import type { GameApp } from "../main";
import type { GameMode } from "../shared/types";
import type { Tool } from "../ui/UI";
import { dragRoomRow, dropRoomRow, pressRoomRow, releaseRoomRow, roomRowPending, startsRoomRow } from "./roomRowGestures";

/**
 * The row of rooms' mouse gesture over a mock port (Modern, #646): which
 * presses start a row, the ghost a drag draws from the engine's quote, and the
 * release that places it. The quote and the build are spies.
 */

function rec(op: string, slots: Record<string, number>, tail: number[] = []): Float64Array {
  return Float64Array.from([...LAYOUT.records[op].map((n) => slots[n] ?? 0), ...tail]);
}

/** The office's width, which `snapX` keeps on the lot. */
const W = catalogFor("modern").facilities.find((f) => f.key === "office")!.width;

/** A fake app with `tool` armed whose engine quotes `rooms` for every row. */
function fakeApp(opts: { mode?: GameMode; tool?: Tool; rooms?: number[]; ok?: boolean; reason?: string } = {}) {
  const rooms = opts.rooms ?? [100];
  const ok = opts.ok ?? true;
  const port = mockPort({
    quoteRoomRow: vi.fn(() => rec("quoteRoomRow", { ok: ok ? 1 : 0, cost: rooms.length * 40_000, rooms: rooms.length }, rooms)),
    lastReason: () => opts.reason ?? "Not enough money.",
  });
  const app = {
    tool: opts.tool ?? ({ type: "build", kind: "office" } as Tool),
    catalog: catalogFor(opts.mode ?? "modern"),
    enginePort: port,
    portCodes: new PortCodes(port),
    build: { buildRoomRow: vi.fn() },
    engine: { preview: null as unknown, transportPreview: { kind: "stairs" } as unknown },
  };
  return { app, port, game: app as unknown as GameApp };
}

vi.mock("./portAccess", () => ({ catalogOf: (app: { catalog: unknown }) => app.catalog }));

describe("which presses start a row", () => {
  it("takes a mouse press with a room tool in Modern", () => {
    expect(startsRoomRow(fakeApp().game, false)).toBe(true);
  });

  it("leaves touch, Classic, brushes, shafts and the other tools alone", () => {
    expect(startsRoomRow(fakeApp().game, true)).toBe(false);
    expect(startsRoomRow(fakeApp({ mode: "classic" }).game, false)).toBe(false);
    for (const kind of ["floor", "lobby", "parking", "elevatorStandard", "stairs"] as const) {
      expect(startsRoomRow(fakeApp({ tool: { type: "build", kind } as Tool }).game, false), kind).toBe(false);
    }
    expect(startsRoomRow(fakeApp({ tool: { type: "bulldoze" } as Tool }).game, false)).toBe(false);
  });
});

describe("a row from press to release", () => {
  it("draws the press's room, stretches with the drag on the press's floor, and places the row on release", () => {
    const { app, port, game } = fakeApp({ rooms: [100, 100 + W, 100 + 2 * W] });
    const office = game.portCodes.kind("office");
    pressRoomRow(game, 100, 5);
    expect(port.quoteRoomRow).toHaveBeenLastCalledWith(office, 5, 100, 100);
    expect(dragRoomRow(game, 100 + 2 * W + 1)).toBe(true);
    expect(port.quoteRoomRow).toHaveBeenLastCalledWith(office, 5, 100, 100 + 2 * W + 1);
    expect(app.engine.preview).toEqual({
      kind: "office",
      floor: 5,
      x: 100,
      valid: true,
      reason: undefined,
      rooms: [100, 100 + W, 100 + 2 * W],
      label: "$120,000, 3 rooms",
    });
    expect(app.engine.transportPreview).toBeNull();
    expect(roomRowPending(game)).toBe(true);
    expect(releaseRoomRow(game, true)).toBe(true);
    expect(app.build.buildRoomRow).toHaveBeenCalledExactlyOnceWith("office", 5, 100, 100 + 2 * W + 1);
    expect(app.engine.preview).toBeNull();
    expect(clearBuildRefusal).toHaveBeenCalledWith(game);
    expect(roomRowPending(game)).toBe(false);
  });

  it("asks the engine again only when the pointer's column changes", () => {
    const { port, game } = fakeApp();
    pressRoomRow(game, 100, 5);
    dragRoomRow(game, 100);
    expect(port.quoteRoomRow).toHaveBeenCalledTimes(1);
    dragRoomRow(game, 101);
    expect(port.quoteRoomRow).toHaveBeenCalledTimes(2);
  });

  it("draws a refused row red, leftmost room first, with the engine's reason", () => {
    const { app, game } = fakeApp({ rooms: [100 + W, 100], ok: false });
    pressRoomRow(game, 100 + W, 5);
    dragRoomRow(game, 100);
    expect(app.engine.preview).toMatchObject({ x: 100, valid: false, reason: "Not enough money.", rooms: [100 + W, 100] });
    expect(updateBuildRefusal).toHaveBeenLastCalledWith(game, "Not enough money.", 5, 100 + Math.floor(W / 2));
  });

  it("places nothing on a release that does not act, or after the tool changed", () => {
    const { app, game } = fakeApp();
    pressRoomRow(game, 100, 5);
    releaseRoomRow(game, false);
    pressRoomRow(game, 100, 5);
    app.tool = { type: "bulldoze" } as Tool;
    releaseRoomRow(game, true);
    expect(app.build.buildRoomRow).not.toHaveBeenCalled();
  });

  it("drops the row and its ghost on the first drag after the tool changed", () => {
    const { app, port, game } = fakeApp();
    pressRoomRow(game, 100, 5);
    app.tool = { type: "build", kind: "condo" } as Tool;
    expect(dragRoomRow(game, 100 + 3 * W)).toBe(false);
    expect(port.quoteRoomRow).toHaveBeenCalledTimes(1);
    expect(app.engine.preview).toBeNull();
    expect(roomRowPending(game)).toBe(false);
    expect(releaseRoomRow(game, true)).toBe(false);
    expect(app.build.buildRoomRow).not.toHaveBeenCalled();
  });

  it("drops a cut-off row with its ghost, and a drag or release then does nothing", () => {
    const { app, game } = fakeApp();
    pressRoomRow(game, 100, 5);
    dropRoomRow(game);
    expect(app.engine.preview).toBeNull();
    expect(dragRoomRow(game, 150)).toBe(false);
    expect(releaseRoomRow(game, true)).toBe(false);
    expect(app.build.buildRoomRow).not.toHaveBeenCalled();
  });
});
