import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { GameApp } from "../main";
import type { SaverDialogPorts } from "../ui/screenSaver/saverDialog";
import type { ScreenSaverOpts } from "../ui/screenSaver/screenSaver";
import type { SaverTriggerPorts } from "../ui/screenSaver/saverTriggers";
import { WINDOW } from "../ui/screenSaver/saverScene";

const track = vi.fn();
vi.mock("../analytics", () => ({ trackAppAction: (...a: unknown[]) => track(...a) }));
const openDialog = vi.fn();
vi.mock("../ui/screenSaver/saverDialog", () => ({ openScreenSaverDialog: (...a: unknown[]) => openDialog(...a) }));
const show = vi.fn();
vi.mock("../ui/screenSaver/screenSaver", () => ({ showScreenSaver: (o: ScreenSaverOpts) => show(o) }));
const watch = vi.fn();
const touched = vi.fn();
vi.mock("../ui/screenSaver/saverTriggers", () => ({
  watchForSaver: (p: SaverTriggerPorts) => {
    watch(p);
    return { stop: vi.fn(), touched };
  },
}));

import {
  SCREEN_SAVER_ITEM_ID,
  marqueeLines,
  shownBucket,
  towerSnapshot,
  windowColor,
  wireScreenSaver,
} from "./screenSaverWiring";

function view() {
  return {
    rooms: [
      { kind: "office", floor: 2, x: 4, width: 9, state: "occupied" },
      { kind: "condo", floor: 3, x: 0, width: 16, state: "empty" },
      { kind: "shop", floor: -1, x: 0, width: 12, state: "occupied" },
    ],
    structure: [
      { kind: "lobby", floor: 0, x: 0, width: 4, count: 10 },
      { kind: "floor", floor: -1, x: 0, width: 4, count: 3 },
    ],
    tower: {
      towerName: "Maple Heights",
      transports: [
        { kind: "elevatorStandard", x: 20, width: 4, bottom: -2, top: 9 },
        { kind: "stairs", x: 30, width: 8, bottom: 1, top: 2 },
        { kind: "elevatorExpress", x: 40, width: 4, bottom: -5, top: -1 },
      ],
    },
    header: { star: 3, population: 12345, money: 2500000.4, pendingChoice: null, bombSearch: null },
  };
}

function appDouble(speed = 2) {
  let s = speed;
  return {
    reader: view(),
    ui: { tag: "ui" },
    prefs: { reducedMotion: false },
    reduceMq: { matches: false },
    engine: { engine: { clock: { isRunning: true, stop: vi.fn(), start: vi.fn() } } },
    getSpeed: vi.fn(() => s),
    setSpeed: vi.fn((n: number) => {
      s = n;
    }),
  };
}

describe("what the savers read from the tower", () => {
  it("lights each room by its kind, and only when someone is in", () => {
    expect(windowColor("office")).toBe(WINDOW.office);
    expect(windowColor("rentalStudio")).toBe(WINDOW.home);
    expect(windowColor("hotelSuite")).toBe(WINDOW.hotel);
    expect(windowColor("cinema")).toBe(WINDOW.shop);
    const t = towerSnapshot(view() as never);
    expect(t.rooms).toEqual([
      { floor: 2, x: 4, width: 9, color: WINDOW.office, lit: true },
      { floor: 3, x: 0, width: 16, color: WINDOW.home, lit: false },
    ]);
  });

  it("takes the tower above ground, runs at their full width, and the elevators only", () => {
    const t = towerSnapshot(view() as never);
    expect(t.structure).toEqual([{ floor: 0, x: 0, width: 40 }]);
    expect(t.shafts).toEqual([{ x: 20, width: 4, bottom: 0, top: 9 }]);
  });

  it("writes the marquee in whole sentences", () => {
    const lines = marqueeLines(view() as never);
    expect(lines[0]).toBe("Maple Heights is rated 3 stars.");
    expect(lines[1]).toBe("12,345 people live, work or play here.");
    expect(lines[2]).toBe("Funds on hand: $2,500,000.");
    const tower = {
      ...view(),
      header: { ...view().header, star: 6, population: 1, money: -5000 },
      tower: { ...view().tower, towerName: "  " },
    };
    expect(marqueeLines(tower as never).slice(0, 3)).toEqual([
      "Your tower has the TOWER rating.",
      "1 person lives, works or plays here.",
      "Funds on hand: -$5,000.",
    ]);
    const empty = { ...view(), header: { ...view().header, star: 1, population: 0 } };
    expect(marqueeLines(empty as never).slice(0, 2)).toEqual([
      "Maple Heights is rated 1 star.",
      "Nobody lives, works or plays here yet.",
    ]);
  });

  it("buckets how long a saver was up", () => {
    expect(shownBucket(59_999)).toBe("under_1m");
    expect(shownBucket(60_000)).toBe("1_5m");
    expect(shownBucket(300_000)).toBe("over_5m");
  });
});

describe("wireScreenSaver", () => {
  beforeEach(() => {
    const item = document.createElement("button");
    item.id = SCREEN_SAVER_ITEM_ID;
    document.body.append(item);
    localStorage.clear();
  });
  afterEach(() => {
    document.getElementById(SCREEN_SAVER_ITEM_ID)?.remove();
    vi.clearAllMocks();
  });

  function dialogPorts(app: ReturnType<typeof appDouble>): SaverDialogPorts {
    wireScreenSaver(app as unknown as GameApp);
    document.getElementById(SCREEN_SAVER_ITEM_ID)!.click();
    expect(openDialog).toHaveBeenCalledWith(app.ui, expect.objectContaining({ saver: "night" }), expect.anything());
    return openDialog.mock.calls[0][2] as SaverDialogPorts;
  }

  it("pauses the tower while a saver is up and sets it back to its speed after", () => {
    const app = appDouble(2);
    const back = vi.fn();
    dialogPorts(app).preview("stars", back);
    expect(app.setSpeed).toHaveBeenCalledWith(0);
    expect(track).toHaveBeenCalledWith("screensaver_start", "preview");
    // The hidden tower stops drawing while the saver covers it.
    expect(app.engine.engine.clock.stop).toHaveBeenCalledTimes(1);
    expect(app.engine.engine.clock.start).not.toHaveBeenCalled();
    const opts = show.mock.calls[0][0] as ScreenSaverOpts;
    app.engine.engine.clock.isRunning = false;
    opts.onEnd(90_000);
    expect(app.engine.engine.clock.start).toHaveBeenCalledTimes(1);
    expect(app.setSpeed).toHaveBeenLastCalledWith(2);
    expect(track).toHaveBeenCalledWith("screensaver_end", "1_5m");
    expect(touched).toHaveBeenCalled();
    expect(back).toHaveBeenCalled();
  });

  it("leaves a paused tower paused, and leaves a speed someone else set", () => {
    const paused = appDouble(0);
    dialogPorts(paused).preview("stars", vi.fn());
    (show.mock.calls[0][0] as ScreenSaverOpts).onEnd(1);
    expect(paused.setSpeed).not.toHaveBeenCalled();
    vi.clearAllMocks();
    document.getElementById(SCREEN_SAVER_ITEM_ID)!.remove();
    const item = document.createElement("button");
    item.id = SCREEN_SAVER_ITEM_ID;
    document.body.append(item);
    const app = appDouble(1);
    dialogPorts(app).preview("stars", vi.fn());
    app.setSpeed(3);
    app.setSpeed.mockClear();
    (show.mock.calls[0][0] as ScreenSaverOpts).onEnd(1);
    expect(app.setSpeed).not.toHaveBeenCalled();
  });

  it("puts up one saver at a time", () => {
    const ports = dialogPorts(appDouble());
    ports.preview("stars", vi.fn());
    ports.preview("express", vi.fn());
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("saves the dialog's choices and the triggers read them", () => {
    const app = appDouble();
    const ports = dialogPorts(app);
    ports.save({ saver: "marquee", waitMinutes: 10, onReturn: false });
    expect(JSON.parse(localStorage.getItem("vc.screensaver")!)).toEqual({
      saver: "marquee",
      waitMinutes: 10,
      onReturn: false,
    });
    expect(track).toHaveBeenCalledWith("screensaver_set", "marquee");
    const triggers = watch.mock.calls[0][0] as SaverTriggerPorts;
    expect(triggers.prefs().saver).toBe("marquee");
    triggers.start("idle");
    expect(track).toHaveBeenCalledWith("screensaver_start", "idle");
  });

  it("never comes up under a test browser or over an emergency", () => {
    const automated = vi.spyOn(navigator, "webdriver", "get").mockReturnValue(false);
    const app = appDouble(0);
    wireScreenSaver(app as unknown as GameApp);
    const triggers = watch.mock.calls[0][0] as SaverTriggerPorts;
    expect(triggers.paused()).toBe(true);
    expect(triggers.canShow()).toBe(true);
    (app.reader.header as { pendingChoice: unknown }).pendingChoice = { kind: "fireRescue" };
    expect(triggers.canShow()).toBe(false);
    (app.reader.header as { pendingChoice: unknown }).pendingChoice = null;
    automated.mockReturnValue(true);
    expect(triggers.canShow()).toBe(false);
    automated.mockRestore();
  });
});
