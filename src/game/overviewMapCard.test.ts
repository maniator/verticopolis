import { describe, it, expect, beforeEach, vi } from "vitest";
import { fitLayout } from "@verticopolis/components/render/overviewMap/geometry";
import type { MapTap } from "../ui/overviewMapDeps";
import type { MapPickRoom, MapPickShaft } from "../ui/overviewMapPick";

const fault = vi.hoisted(() => ({ trapped: false, stopped: false }));
const trackAppAction = vi.hoisted(() => vi.fn());
vi.mock("./engineFault", () => ({ engineTrapped: () => fault.trapped }));
vi.mock("./interactionState", () => ({ isEngineStopped: () => fault.stopped }));
vi.mock("../analyticsActions", () => ({ trackAppAction }));

const { openMapCard } = await import("./overviewMapCard");

// One map pixel per tile and ten per floor (floor f fills y (10 - f) * 10 on).
const layout = fitLayout({ leftTile: 0, width: 100, topLine: 10, bottomLine: 0 }, 100, 100);
const onFloor5 = (x: number): MapTap => ({ layout, x, y: 55, reach: 3 });
const office: MapPickRoom = { id: 1, kind: "office", floor: 5, x: 10, width: 9 };
const elevator: MapPickShaft = { id: 10, kind: "elevatorStandard", x: 50, width: 4, bottom: 1, top: 6 };

function app(tool = "inspect", phone = false) {
  return {
    reader: { rooms: [office], tower: { transports: [elevator] } },
    tool: { type: tool },
    mobileMq: { matches: phone },
    inspector: { resetLatch: vi.fn(), inspectPicked: vi.fn() },
    selectPicked: vi.fn(),
  };
}

beforeEach(() => {
  fault.trapped = false;
  fault.stopped = false;
  trackAppAction.mockClear();
});

describe("openMapCard", () => {
  it("raises a room's hover card, which names its gripe, on a computer with Inspect held", () => {
    const a = app();
    openMapCard(a, "eval", onFloor5(14), () => 1);
    expect(a.inspector.resetLatch).toHaveBeenCalledOnce();
    expect(a.inspector.inspectPicked).toHaveBeenCalledWith({ type: "unit", id: 1, kind: "office" });
    expect(a.selectPicked).not.toHaveBeenCalled();
    expect(trackAppAction).toHaveBeenCalledWith("map_card", "eval");
  });

  it("opens the room card on a phone, whose card names the gripe, or with another tool held", () => {
    for (const a of [app("inspect", true), app("build")]) {
      openMapCard(a, "hotel", onFloor5(14), () => 1);
      expect(a.selectPicked).toHaveBeenCalledWith({ type: "unit", id: 1, kind: "office" });
      expect(a.inspector.inspectPicked).not.toHaveBeenCalled();
    }
  });

  it("opens a shaft's full card on Traffic, with its cars, even on a computer with Inspect held", () => {
    const a = app();
    openMapCard(a, "traffic", onFloor5(90), () => 1);
    expect(a.selectPicked).toHaveBeenCalledWith({ type: "transport", id: 10, kind: "elevatorStandard" });
    expect(a.inspector.inspectPicked).not.toHaveBeenCalled();
    expect(trackAppAction).toHaveBeenCalledWith("map_card", "traffic");
  });

  it("does nothing on Edit, off every room, or once the engine stopped or trapped", () => {
    const a = app();
    openMapCard(a, "edit", onFloor5(14), () => 1);
    openMapCard(a, "eval", onFloor5(80), () => 1);
    fault.stopped = true;
    openMapCard(a, "eval", onFloor5(14), () => 1);
    fault.stopped = false;
    fault.trapped = true;
    openMapCard(a, "eval", onFloor5(14), () => 1);
    expect(a.selectPicked).not.toHaveBeenCalled();
    expect(a.inspector.inspectPicked).not.toHaveBeenCalled();
    expect(trackAppAction).not.toHaveBeenCalled();
  });
});
