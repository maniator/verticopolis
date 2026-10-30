import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameApp } from "../main";
import { wireControllers } from "./appBoot";

vi.mock("../analyticsRelay", () => ({ sendToRelay: vi.fn() }));
vi.mock("virtual:pwa-register", () => ({ registerSW: () => () => {} }));

/**
 * The composition root hands the schedule review (#1548) closures that reach the
 * live app, so a tower swap is seen at once. The other controllers are mocked to
 * keep this suite to that one wiring; `appBoot.test.ts` holds the rest.
 */
const mocks = vi.hoisted(() => ({ review: {} as Record<string, unknown> }));

vi.mock("./cardKit", () => ({ createCardKit: vi.fn(() => ({ kit: "kit" })) }));
vi.mock("./buildActions", () => ({ BuildActions: class {} }));
vi.mock("./inspector", () => ({ InspectorController: class {} }));
vi.mock("./keyboardPlay", () => ({ KeyboardPlay: class {} }));
vi.mock("./saveLoad", async (orig) => ({ ...(await orig<typeof import("./saveLoad")>()), SaveLoad: class {} }));
vi.mock("./editorActions", () => ({
  EditorActions: class {
    openSchedule = vi.fn();
  },
}));
vi.mock("./scheduleReview", () => ({
  ScheduleReview: class {
    constructor(deps: Record<string, unknown>) {
      mocks.review = deps;
    }
  },
}));

function makeApp() {
  const app = {
    enginePort: { id: "engine port" },
    portCodes: { id: "codes" },
    reader: { id: "reader", header: {} },
    audio: { sfx: vi.fn() },
    ui: { toast: vi.fn(), sayVisibly: vi.fn(), showScheduleReview: vi.fn() },
    refreshEditor: vi.fn(),
    captureUndo: vi.fn(),
    commitUndo: vi.fn(),
    announce: vi.fn(),
  };
  return app as unknown as GameApp & typeof app;
}

type Deps = Record<string, (...a: unknown[]) => unknown> & { ui: Record<string, (...a: unknown[]) => unknown>; audio: unknown };

describe("wireControllers: the schedule review", () => {
  beforeEach(() => {
    mocks.review = {};
  });

  it("reads the engine, view and card kit from the live app", () => {
    const app = makeApp();
    wireControllers(app);
    const d = mocks.review as Deps;
    expect([d.engine(), d.reader(), d.kit()]).toEqual([app.enginePort, app.reader, app.cardKit]);
    expect(d.audio).toBe(app.audio);
  });

  it("routes its notices, dialog, undo steps and announcements to the app", () => {
    const app = makeApp();
    wireControllers(app);
    const d = mocks.review as Deps;
    d.ui.toast("t", "info");
    expect(app.ui.toast).toHaveBeenCalledWith("t", "info");
    d.ui.sayVisibly("v", "bad");
    expect(app.ui.sayVisibly).toHaveBeenCalledWith("v", "bad");
    d.ui.showScheduleReview("rows", "handlers", "focus");
    expect(app.ui.showScheduleReview).toHaveBeenCalledWith("rows", "handlers", "focus");
    d.captureUndo("label");
    expect(app.captureUndo).toHaveBeenCalledWith("label");
    d.commitUndo();
    expect(app.commitUndo).toHaveBeenCalled();
    d.refreshEditor();
    expect(app.refreshEditor).toHaveBeenCalled();
    d.announce("msg");
    expect(app.announce).toHaveBeenCalledWith("msg");
  });

  it("opens a shaft's schedule dialog through the editor, without selecting it", () => {
    const app = makeApp();
    wireControllers(app);
    (mocks.review as Deps).openSchedule(9);
    expect((app.editor as unknown as { openSchedule: ReturnType<typeof vi.fn> }).openSchedule).toHaveBeenCalledWith(9);
  });
});
