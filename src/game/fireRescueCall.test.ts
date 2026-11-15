import { describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { FIRE_RESCUE_REFUSED, callFireRescue } from "./fireRescueCall";

/** A stand-in app: the port answers `callFireRescue` with `status` and, on a
 *  refusal, `reason`; the reader and the toast are spies. */
function app(status: 0 | 1, reason: string | null = null) {
  const port = {
    callFireRescue: vi.fn(() => Float64Array.of(status, 0, status ? 150_000 : 0)),
    lastReason: vi.fn(() => reason),
  };
  const reader = { update: vi.fn() };
  const ui = { toast: vi.fn() };
  return { port, reader, ui, game: { enginePort: port, reader, ui } as unknown as GameApp };
}

describe("Tower > Call Fire Rescue (#1889)", () => {
  it("asks the engine for the offer and reads the frame again so it opens", () => {
    const a = app(1);
    callFireRescue(a.game);
    expect(a.port.callFireRescue).toHaveBeenCalledTimes(1);
    expect(a.reader.update).toHaveBeenCalledTimes(1);
    expect(a.ui.toast).not.toHaveBeenCalled();
  });

  it("says no fire is burning when the engine refuses with none", () => {
    const a = app(0, "none");
    callFireRescue(a.game);
    expect(a.ui.toast).toHaveBeenCalledWith(FIRE_RESCUE_REFUSED.none, "info");
    expect(a.reader.update).not.toHaveBeenCalled();
  });

  it("points at the waiting emergency when the engine refuses with pending", () => {
    const a = app(0, "pending");
    callFireRescue(a.game);
    expect(a.ui.toast).toHaveBeenCalledWith(FIRE_RESCUE_REFUSED.pending, "info");
  });
});
