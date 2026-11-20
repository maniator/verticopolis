import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  splash: false,
  loaded: true,
  loadFromSplash: vi.fn(),
  welcomeFounder: vi.fn(),
  track: vi.fn(),
}));
vi.mock("../analytics", () => ({ trackAppAction: fake.track }));
vi.mock("./interactionState", () => ({ isSplashUp: () => fake.splash }));
vi.mock("./appModals", () => ({ loadFromSplash: fake.loadFromSplash }));
vi.mock("./titleScreen", () => ({ welcomeFounder: fake.welcomeFounder }));

import type { GameApp } from "../main";
import { LOAD_FAILED, loadSave, openLive } from "./loadMenu";

let app: {
  ui: {
    cb: { onLoadSlot: ReturnType<typeof vi.fn> };
    sayVisibly: ReturnType<typeof vi.fn>;
    toast: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  Object.assign(fake, { splash: false, loaded: true });
  fake.loadFromSplash.mockReset().mockImplementation(() => fake.loaded);
  fake.welcomeFounder.mockReset();
  fake.track.mockReset();
  app = { ui: { cb: { onLoadSlot: vi.fn() }, sayVisibly: vi.fn(), toast: vi.fn() } };
});

describe("loading the Auto-save", () => {
  it("in a tower, loads it the tower's own way", () => {
    loadSave(app as unknown as GameApp, "auto");
    expect(app.ui.cb.onLoadSlot).toHaveBeenCalledWith("auto");
    expect(fake.loadFromSplash).not.toHaveBeenCalled();
  });

  it("on the title screen, loads through the title screen and welcomes a founder once the tower arrives", () => {
    fake.splash = true;
    loadSave(app as unknown as GameApp, "auto");
    expect(fake.loadFromSplash).toHaveBeenCalledWith(app, "auto");
    expect(fake.welcomeFounder).toHaveBeenCalledWith(app);
    expect(app.ui.cb.onLoadSlot).not.toHaveBeenCalled();
  });

  it("on the title screen, says so when the save will not load", () => {
    fake.splash = true;
    fake.loaded = false;
    loadSave(app as unknown as GameApp, "auto");
    expect(fake.welcomeFounder).not.toHaveBeenCalled();
    expect(app.ui.sayVisibly).toHaveBeenCalledWith(LOAD_FAILED);
  });
});

describe("opening the file of the tower being played", () => {
  it("in the tower, says so and loads nothing, since the file is the tower", () => {
    openLive(app as unknown as GameApp, "Sky");
    expect(app.ui.toast).toHaveBeenCalledExactlyOnceWith('"Sky" is the tower you\'re in.', "info");
    expect(app.ui.cb.onLoadSlot).not.toHaveBeenCalled();
    expect(fake.track).toHaveBeenCalledExactlyOnceWith("file_open", "live");
  });

  it("on the title screen, opens it the way Continue does, from the crash copy", () => {
    fake.splash = true;
    openLive(app as unknown as GameApp, "Sky");
    expect(fake.loadFromSplash).toHaveBeenCalledExactlyOnceWith(app, "auto");
    expect(app.ui.toast).not.toHaveBeenCalled();
  });
});
