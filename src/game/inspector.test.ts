import { describe, expect, it, vi } from "vitest";
import { catalogFacility } from "../catalog/catalogTypes";
import { catalogFor } from "../tests/catalogFixture";
import type { CardKit } from "./cardKit";
import { InspectorController, type InspectorDeps } from "./inspector";

vi.mock("../simport/headerClock", () => ({ clockOf: () => ({ hour: 14 }) }));
vi.mock("../ui/templates/inspector", () => ({
  unitInspectorTemplate: vi.fn(
    (u: { id: number }, _c: unknown, hour: number, diag: unknown) => ({
      unit: u.id,
      hour,
      diag,
    }),
  ),
  transportInspectorTemplate: vi.fn(
    (t: { id: number }, _c: unknown, diag: unknown) => ({ shaft: t.id, diag }),
  ),
}));

/**
 * The hover inspector over a mock card kit: which card it asks for, where it
 * anchors the panel, what it shows, and the dismissal latch. The cards' text
 * is the templates' (`ui/templates/inspector.test.ts`).
 */

const CATALOG = catalogFor("classic");
const condo = { id: 3, kind: "condo", x: 10, width: 4, floor: 5 };
const lift = { id: 8, kind: "elevatorStandard", x: 40, width: 1, top: 9 };

function setup() {
  const cards = {
    unit: vi.fn((id: number) => (id === condo.id ? condo : undefined)),
    shaft: vi.fn((id: number) => (id === lift.id ? lift : undefined)),
  };
  const diagnostics = {
    unit: vi.fn(() => ["unit facts"]),
    transport: vi.fn(() => ["shaft facts"]),
  };
  const kit = {
    cards,
    diagnostics,
    catalog: () => CATALOG,
  } as unknown as CardKit;
  const deps = {
    kit: () => kit,
    reader: () => ({ header: {} as never }),
    ui: { showInspector: vi.fn() },
    setAnchor: vi.fn(),
  } satisfies InspectorDeps;
  return { cards, diagnostics, deps, inspector: new InspectorController(deps) };
}

const onCondo = { type: "unit" as const, id: condo.id, kind: "condo" as const };
const onLift = {
  type: "transport" as const,
  id: lift.id,
  kind: "elevatorStandard" as const,
};

describe("InspectorController", () => {
  it("shows a unit's card anchored over its top floor, asking for fresh diagnostics once per facility", () => {
    const { inspector, deps, diagnostics } = setup();
    inspector.inspectPicked(onCondo);
    const floors = catalogFacility(CATALOG, "condo").floors;
    expect(deps.setAnchor).toHaveBeenCalledExactlyOnceWith({
      x: condo.x + condo.width,
      left: condo.x,
      floor: condo.floor + floors - 1,
    });
    expect(deps.ui.showInspector).toHaveBeenCalledExactlyOnceWith({
      unit: condo.id,
      hour: 14,
      diag: ["unit facts"],
    });
    inspector.inspectPicked(onCondo);
    expect(diagnostics.unit.mock.calls).toEqual([
      [condo.id, true],
      [condo.id, false],
    ]);
  });

  it("shows a shaft's card anchored at its top", () => {
    const { inspector, deps, diagnostics } = setup();
    inspector.inspectPicked(onLift);
    expect(deps.setAnchor).toHaveBeenCalledExactlyOnceWith({
      x: lift.x + lift.width,
      left: lift.x,
      floor: lift.top,
    });
    expect(diagnostics.transport).toHaveBeenCalledExactlyOnceWith(lift.id);
    expect(deps.ui.showInspector).toHaveBeenCalledExactlyOnceWith({
      shaft: lift.id,
      diag: ["shaft facts"],
    });
  });

  it("hides on no pick, a floor tile, or a facility that is gone", () => {
    const { inspector, deps } = setup();
    inspector.inspectPicked(null);
    inspector.inspectPicked({ type: "unit", id: 0, kind: "floor" });
    inspector.inspectPicked({ type: "unit", id: 99, kind: "office" });
    inspector.inspectPicked({ type: "transport", id: 99, kind: "stairs" });
    expect(deps.ui.showInspector.mock.calls).toEqual([
      [null],
      [null],
      [null],
      [null],
    ]);
    expect(deps.setAnchor.mock.calls).toEqual([[null], [null], [null], [null]]);
  });

  it("a dismissed card stays closed while hover picks land on it, through jitter", () => {
    const { inspector, deps } = setup();
    inspector.inspectPicked(onCondo);
    inspector.dismiss();
    inspector.inspectPicked(null);
    inspector.inspectPicked(onCondo);
    expect(
      deps.ui.showInspector.mock.calls.filter(([c]) => c !== null),
    ).toHaveLength(1);
  });

  it("a different facility, a tap or a reset re-arms the card", () => {
    const { inspector, deps } = setup();
    const shown = () =>
      deps.ui.showInspector.mock.calls.filter(([c]) => c !== null).length;
    inspector.inspectPicked(onCondo);
    inspector.dismiss();
    inspector.inspectPicked(onLift);
    inspector.inspectPicked(onCondo);
    expect(shown(), "picking another facility spends the latch").toBe(3);
    inspector.dismiss();
    inspector.resetLatch();
    inspector.inspectPicked(onCondo);
    expect(shown(), "a tap is fresh intent").toBe(4);
    inspector.dismiss();
    inspector.clear();
    inspector.inspectPicked(onCondo);
    expect(shown(), "a tower swap clears the latch").toBe(5);
  });
});
