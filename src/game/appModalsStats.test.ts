import { describe, it, expect, vi } from "vitest";
import type { GameApp } from "../main";
import type { Simulation } from "../engine/Simulation";
import { showStats, confirmExterminate } from "./appModals";
import { statsTemplate } from "../ui/templates/stats";
import { towerCatalog } from "../engine/towerCatalog";
import { statsReport } from "../simport/statsSheet";
import { makeApp, makeSim, settle, withExterminator, type Refusal } from "./appModals.fixture";

/**
 * The stats screen and its exterminator action against the fake app
 * (`appModals.fixture.ts`). `statsTemplate` is stubbed to a token so the fake
 * port only answers the handful of fields the commands themselves read, while
 * `canCallExterminator` and `statsScreen` stay REAL, so the handler gate and
 * the screen's assembly are exercised against the port's answer. The stats
 * screen and the exterminator check ask the engine port, so the fake port
 * answers from the fake sim's state at the time of each ask.
 */

vi.mock("../ui/templates/stats", async (importActual) => {
  const actual = await importActual<typeof import("../ui/templates/stats")>();
  return { ...actual, statsTemplate: vi.fn(() => "STATS_BODY") };
});

describe("showStats", () => {
  it("wires an exterminate handler when the action is offerable", async () => {
    const sim = makeSim(); // recovery, 2 infested, none en route → offerable
    const { app, ui } = makeApp(sim);
    await showStats(app);
    expect(ui.showStats).toHaveBeenCalledTimes(1);
    const handlers = ui.showStats.mock.calls[0][1] as Record<string, () => void>;
    expect(typeof handlers.exterminate).toBe("function");
  });

  it("wires NO handlers when the action is not offerable", async () => {
    // No recovery rule (Classic-style): canCallExterminator is false.
    const sim = makeSim();
    withExterminator(sim, null);
    const { app, ui } = makeApp(sim);
    await showStats(app);
    const handlers = ui.showStats.mock.calls[0][1] as Record<string, () => void>;
    expect(handlers).toEqual({});
  });

  it("leaves the stats body as it was, with no review entry, when no elevator runs short", async () => {
    const { app, ui } = makeApp(makeSim());
    await showStats(app);
    expect(ui.showStats.mock.calls[0][0]).toBe("STATS_BODY");
    expect(ui.showStats.mock.calls[0][1]).not.toHaveProperty("reviewSchedules");
  });

  it("adds the elevator schedule review entry, and wires it, when some elevator runs short (#1548)", async () => {
    const { app, ui, scheduleReview } = makeApp(makeSim());
    scheduleReview.findings.mockReturnValue([{}, {}]);
    await showStats(app);
    expect(ui.showStats.mock.calls[0][0]).not.toBe("STATS_BODY");
    const handlers = ui.showStats.mock.calls[0][1] as Record<string, () => void>;
    handlers.reviewSchedules!();
    expect(scheduleReview.open).toHaveBeenCalledOnce();
  });

  it("also declines when a dispatch is already en route", async () => {
    const sim = makeSim({ exterminationDueDay: 5 });
    const { app, ui } = makeApp(sim);
    await showStats(app);
    expect(ui.showStats.mock.calls[0][1]).toEqual({});
  });

  it("also declines when nothing is infested", async () => {
    const sim = makeSim({ housekeepingCoverage: vi.fn(() => ({ infested: 0 })) });
    const { app, ui } = makeApp(sim);
    await showStats(app);
    expect(ui.showStats.mock.calls[0][1]).toEqual({});
  });

  it("draws the report with the reader's header and tower name and the tower's catalog", async () => {
    const sim = makeSim();
    const { app, enginePort, reader } = makeApp(sim);
    await showStats(app);
    expect(reader.update).toHaveBeenCalledOnce();
    expect(vi.mocked(statsTemplate)).toHaveBeenLastCalledWith({
      report: statsReport(enginePort.statsSheet.mock.results[0].value as Float64Array, app.portCodes),
      header: reader.header,
      towerName: "Fake",
      catalog: towerCatalog(sim as unknown as Simulation),
    });
  });

  it("says so in a toast and rejects when the engine fails to answer", async () => {
    const { app, ui, enginePort } = makeApp(makeSim());
    enginePort.statsSheet.mockImplementationOnce(() => {
      throw new Error("engine down");
    });
    await expect(showStats(app)).rejects.toThrow("engine down");
    expect(ui.showStats).not.toHaveBeenCalled();
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("Tower Statistics could not be shown.", "bad");
  });

  it("says so in a toast and rejects when the screen fails to draw", async () => {
    const { app, ui } = makeApp(makeSim());
    ui.showStats.mockImplementationOnce(() => {
      throw new Error("draw failed");
    });
    await expect(showStats(app)).rejects.toThrow("draw failed");
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("Tower Statistics could not be shown.", "bad");
  });

  it("describes the tower loaded at the time of the ask", async () => {
    const { app, ui } = makeApp(makeSim());
    (app as { sim: unknown }).sim = makeSim({ exterminationDueDay: 5 });
    await showStats(app);
    // The new tower has a booking en route, so the action is not offered.
    expect(ui.showStats.mock.calls[0][1]).toEqual({});
  });
});

/** Open the stats screen, fire the exterminate handler it wired, and let the
 *  coverage answer land, so a test can drive the confirm callback. */
async function fireExterminate(app: GameApp, ui: ReturnType<typeof makeApp>["ui"]): Promise<void> {
  await showStats(app);
  const handlers = ui.showStats.mock.calls[0][1] as Record<string, () => void>;
  handlers.exterminate();
  await settle();
}

describe("confirmExterminate refusals surfaced by the confirm callback", () => {
  const cases: Array<{ reason: string; cost?: number; message: string }> = [
    { reason: "funds", cost: 500, message: "Not enough funds to book the exterminator ($500)." },
    { reason: "pending", message: "An exterminator is already on the way." },
    { reason: "none", message: "No infested rooms left to treat." },
    { reason: "whatever", message: "The exterminator is unavailable." },
  ];

  for (const { reason, cost, message } of cases) {
    it(`emits "${message}" for reason "${reason}"`, async () => {
      const res: Refusal = { ok: false, reason, ...(cost !== undefined ? { cost } : {}) };
      const sim = makeSim({ callExterminator: vi.fn(() => res) });
      const { app, ui } = makeApp(sim);
      await fireExterminate(app, ui);
      expect(ui.confirmModal).toHaveBeenCalledTimes(1);
      const onConfirm = ui.confirmModal.mock.calls[0][2] as () => Promise<void>;
      await onConfirm();
      expect(sim.callExterminator).toHaveBeenCalledTimes(1);
      expect(sim.emit).toHaveBeenCalledExactlyOnceWith(message, "bad");
    });
  }

  it("funds refusal falls back to the computed cost when the result omits one", async () => {
    // recovery 100 + 50/room * 2 infested = 200.
    const sim = makeSim({ callExterminator: vi.fn(() => ({ ok: false, reason: "funds" })) });
    const { app, ui } = makeApp(sim);
    await fireExterminate(app, ui);
    await (ui.confirmModal.mock.calls[0][2] as () => Promise<void>)();
    expect(sim.emit).toHaveBeenCalledExactlyOnceWith("Not enough funds to book the exterminator ($200).", "bad");
  });

  it("emits nothing extra and reopens stats on a successful dispatch", async () => {
    const sim = makeSim({ callExterminator: vi.fn(() => ({ ok: true })) });
    const { app, ui } = makeApp(sim);
    await fireExterminate(app, ui);
    await (ui.confirmModal.mock.calls[0][2] as () => Promise<void>)();
    await settle();
    expect(sim.emit).not.toHaveBeenCalled();
    // showStats runs again after the confirm (initial open + reopen).
    expect(ui.showStats).toHaveBeenCalledTimes(2);
  });

  it("bails with a reason before confirming when the tower cleared between render and click", async () => {
    // Rooms cleared after the modal rendered: infested is now 0, so the handler
    // says why instead of opening a confirm dialog.
    const sim = makeSim();
    const { app, ui } = makeApp(sim);
    await showStats(app);
    const handlers = ui.showStats.mock.calls[0][1] as Record<string, () => void>;
    sim.housekeepingCoverage.mockReturnValue({ infested: 0 });
    handlers.exterminate();
    await settle();
    expect(ui.confirmModal).not.toHaveBeenCalled();
    expect(sim.emit).toHaveBeenCalledExactlyOnceWith("No infested rooms left to treat.", "bad");
  });

  it("says so in a toast when the coverage ask fails, and a later click asks again", async () => {
    const sim = makeSim();
    const { app, ui, enginePort } = makeApp(sim);
    enginePort.crewCoverage.mockImplementationOnce(() => {
      throw new Error("engine down");
    });
    await expect(confirmExterminate(app)).rejects.toThrow("engine down");
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith("The exterminator could not be booked right now.", "bad");
    expect(ui.confirmModal).not.toHaveBeenCalled();
    await confirmExterminate(app);
    expect(ui.confirmModal).toHaveBeenCalledTimes(1);
  });

  it("asks the engine about the tower loaded at the time of the click", async () => {
    const { app, ui } = makeApp(makeSim());
    // The new tower has five infested rooms, so the quote shows it was asked about.
    (app as { sim: unknown }).sim = makeSim({ housekeepingCoverage: vi.fn(() => ({ infested: 5 })) });
    await confirmExterminate(app);
    expect(ui.confirmModal).toHaveBeenCalledTimes(1);
    expect(ui.confirmModal.mock.calls[0][1]).toBe("Clear 5 infested room(s) for $350? The crew arrives tomorrow.");
  });

  it("books nothing when another tower was loaded while the confirm was open", async () => {
    const sim = makeSim();
    const { app, ui } = makeApp(sim);
    await fireExterminate(app, ui);
    const onConfirm = ui.confirmModal.mock.calls[0][2] as () => Promise<void>;
    const loaded = makeSim();
    (app as { sim: unknown }).sim = loaded;
    await onConfirm();
    expect(sim.callExterminator).not.toHaveBeenCalled();
    expect(loaded.callExterminator).not.toHaveBeenCalled();
    expect(ui.showStats).toHaveBeenCalledTimes(1);
  });

  it("reports the exterminator unavailable when the recovery rule vanished", async () => {
    const sim = makeSim();
    const { app, ui } = makeApp(sim);
    await showStats(app);
    const handlers = ui.showStats.mock.calls[0][1] as Record<string, () => void>;
    withExterminator(sim, null);
    handlers.exterminate();
    await settle();
    expect(ui.confirmModal).not.toHaveBeenCalled();
    expect(sim.emit).toHaveBeenCalledExactlyOnceWith("The exterminator is unavailable.", "bad");
  });
});
