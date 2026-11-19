import { beforeEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({ catalog: vi.fn(), report: vi.fn() }));
vi.mock("./portAccess", () => ({ catalogOf: engine.catalog }));
vi.mock("@verticopolis/components/port/statsSheet", () => ({ statsReport: engine.report }));

import { TOWER_CALL_ITEM, showTowerCalls, towerCalls } from "./towerCallItems";

const MODERN_RECOVERY = { calloutFee: 5_000, perRoomFee: 2_000 };
const STRIP = Float64Array.of(7);
const SHEET = Float64Array.of(9);

/** A stand-in app: the port answers the strip and the sheet with canned
 *  records, the codes read the fire count off the strip, and the reader's
 *  header says whether a choice waits. */
function fakeApp(o: { fires?: number; choice?: boolean; flying?: boolean } = {}) {
  const port = { statsStrip: vi.fn(() => STRIP), statsSheet: vi.fn(() => SHEET) };
  const codes = { slot: vi.fn(() => o.fires ?? 0) };
  const helicopter = o.flying ? { called: 0, arrive: 30, sprayEnd: 50, leave: 65 } : null;
  const reader = { header: { pendingChoice: o.choice ? { kind: "fireRescue" } : null, fireResponse: { helicopter } } };
  return { port, codes, app: { enginePort: port, portCodes: codes, reader } as unknown as Parameters<typeof towerCalls>[0] };
}

/** The stats sheet's answer as `statsReport` decodes it. */
function sheet(fires: number, infested: number, exterminationDueDay: number | null) {
  return { stats: { fires }, housekeeping: { infested }, exterminationDueDay };
}

beforeEach(() => {
  engine.catalog.mockReset();
  engine.report.mockReset();
});

describe("towerCalls: Classic", () => {
  beforeEach(() => engine.catalog.mockReturnValue({ economy: { exterminator: null } }));

  it("asks the HUD strip for the fire count, never the stats sheet, and leaves the exterminator out", () => {
    const a = fakeApp({ fires: 2 });
    expect(towerCalls(a.app)).toEqual({ fireRescue: true, exterminator: null });
    expect(a.port.statsStrip).toHaveBeenCalledOnce();
    expect(a.codes.slot).toHaveBeenCalledExactlyOnceWith(STRIP, "statsStrip", "fires");
    expect(a.port.statsSheet).not.toHaveBeenCalled();
  });

  it("grays Fire Rescue with no fire, and while a choice already waits", () => {
    expect(towerCalls(fakeApp({ fires: 0 }).app).fireRescue).toBe(false);
    expect(towerCalls(fakeApp({ fires: 1, choice: true }).app).fireRescue).toBe(false);
  });

  it("grays Fire Rescue while the helicopter is already on its way", () => {
    expect(towerCalls(fakeApp({ fires: 1, flying: true }).app).fireRescue).toBe(false);
    expect(towerCalls(fakeApp({ fires: 1, flying: false }).app).fireRescue).toBe(true);
  });
});

describe("towerCalls: Modern", () => {
  beforeEach(() => engine.catalog.mockReturnValue({ economy: { exterminator: MODERN_RECOVERY } }));

  it("reads both calls off one stats sheet, and not the strip", () => {
    engine.report.mockReturnValue(sheet(1, 3, null));
    const a = fakeApp();
    expect(towerCalls(a.app)).toEqual({ fireRescue: true, exterminator: true });
    expect(a.port.statsSheet).toHaveBeenCalledOnce();
    expect(engine.report).toHaveBeenCalledExactlyOnceWith(SHEET, a.codes);
    expect(a.port.statsStrip).not.toHaveBeenCalled();
  });

  it("grays the exterminator with no infested room, and once a crew is booked", () => {
    engine.report.mockReturnValue(sheet(0, 0, null));
    expect(towerCalls(fakeApp().app)).toEqual({ fireRescue: false, exterminator: false });
    engine.report.mockReturnValue(sheet(0, 4, 12));
    expect(towerCalls(fakeApp().app).exterminator).toBe(false);
  });

  it("grays Fire Rescue while a choice already waits, fire or not", () => {
    engine.report.mockReturnValue(sheet(2, 0, null));
    expect(towerCalls(fakeApp({ choice: true }).app).fireRescue).toBe(false);
  });
});

describe("showTowerCalls", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button id="${TOWER_CALL_ITEM.fireRescue}"></button><button id="${TOWER_CALL_ITEM.exterminator}" hidden></button>`;
  });
  const fire = () => document.getElementById(TOWER_CALL_ITEM.fireRescue)!;
  const pests = () => document.getElementById(TOWER_CALL_ITEM.exterminator)!;

  it("lights what can be called and grays the rest", () => {
    showTowerCalls({ fireRescue: true, exterminator: false });
    expect(fire().hasAttribute("aria-disabled")).toBe(false);
    expect(pests().hidden).toBe(false);
    expect(pests().getAttribute("aria-disabled")).toBe("true");
    showTowerCalls({ fireRescue: false, exterminator: true });
    expect(fire().getAttribute("aria-disabled")).toBe("true");
    expect(pests().hasAttribute("aria-disabled")).toBe(false);
  });

  it("leaves the exterminator out where the rules have none", () => {
    showTowerCalls({ fireRescue: false, exterminator: true });
    showTowerCalls({ fireRescue: false, exterminator: null });
    expect(pests().hidden).toBe(true);
    expect(pests().getAttribute("aria-disabled")).toBe("true");
  });
});
