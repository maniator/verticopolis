import { describe, it, expect, vi, beforeEach } from "vitest";
import { maybeShowStarUp, noteStarUp } from "./starUpFlow";
import { catalogFor } from "../tests/catalogFixture";
import type { GameApp } from "../main";

/**
 * The star-up box's latch: which climbs it keeps, when it opens and what it
 * reports. The engine port and the dialog are stand-ins; the box's contents
 * are pinned in `templates/starUp.test.ts`.
 */

const show = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn());
const blocking = vi.hoisted(() => ({ modal: false, work: false }));
vi.mock("../ui/uiStarUp", () => ({ showStarUp: show }));
vi.mock("../analytics", () => ({ trackAppAction: track }));
vi.mock("./interactionState", () => ({ hasBlockingModal: () => blocking.modal, dialogHoldsWork: () => blocking.work }));
vi.mock("./portAccess", () => ({ catalogOf: () => catalogFor("classic") }));

function app(over: Record<string, unknown> = {}) {
  return {
    pendingStarUp: null,
    shownStar: false,
    reader: { header: { pendingChoice: null } },
    enginePort: { statsSheet: vi.fn() },
    portCodes: {},
    ui: {},
    ...over,
  } as unknown as GameApp & { pendingStarUp: { from: number; to: number } | null };
}

beforeEach(() => {
  show.mockClear();
  track.mockClear();
  blocking.modal = false;
  blocking.work = false;
});

describe("noteStarUp", () => {
  it("keeps the climb, and folds a second one into it from the first rating", () => {
    const a = app();
    noteStarUp(a, 1, 2);
    expect(a.pendingStarUp).toEqual({ from: 1, to: 2 });
    noteStarUp(a, 2, 3);
    expect(a.pendingStarUp).toEqual({ from: 1, to: 3 });
  });

  it("leaves the TOWER to its own congratulations", () => {
    const a = app();
    noteStarUp(a, 5, 6);
    expect(a.pendingStarUp).toBeNull();
    noteStarUp(a, 4, 6);
    expect(a.pendingStarUp).toEqual({ from: 4, to: 5 });
  });
});

describe("maybeShowStarUp", () => {
  it("opens the box once for a waiting climb, stops time, and reports it", () => {
    const a = app({ pendingStarUp: { from: 1, to: 2 } });
    maybeShowStarUp(a, false);
    expect(show).toHaveBeenCalledOnce();
    expect(show.mock.calls[0]![1]).toMatchObject({ star: 2, headsUp: null });
    expect(a.shownStar).toBe(true);
    expect(a.pendingStarUp).toBeNull();
    expect(track).toHaveBeenCalledExactlyOnceWith("star_notice", "classic-2");
    // Closing the box lets time run again.
    (show.mock.calls[0]![2] as () => void)();
    expect(a.shownStar).toBe(false);
    maybeShowStarUp(a, false);
    expect(show).toHaveBeenCalledOnce();
  });

  it("waits behind the title screen, a blocking dialog, held work and an emergency", () => {
    const waiting = { from: 2, to: 3 };
    const a = app({ pendingStarUp: waiting });
    maybeShowStarUp(a, true);
    blocking.modal = true;
    maybeShowStarUp(a, false);
    blocking.modal = false;
    blocking.work = true;
    maybeShowStarUp(a, false);
    blocking.work = false;
    const choice = app({ pendingStarUp: waiting, reader: { header: { pendingChoice: { message: "fire", cost: 1 } } } });
    maybeShowStarUp(choice, false);
    expect(show).not.toHaveBeenCalled();
    expect(a.pendingStarUp).toBe(waiting);
    maybeShowStarUp(a, false);
    expect(show).toHaveBeenCalledOnce();
  });

  it("does nothing with no climb waiting", () => {
    maybeShowStarUp(app(), false);
    expect(show).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});
