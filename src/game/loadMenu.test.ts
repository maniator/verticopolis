import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  splash: false,
  loaded: true,
  loadFromSplash: vi.fn(),
  welcomeFounder: vi.fn(),
}));
vi.mock("./interactionState", () => ({ isSplashUp: () => fake.splash }));
vi.mock("./appModals", () => ({ loadFromSplash: fake.loadFromSplash }));
vi.mock("./titleScreen", () => ({ welcomeFounder: fake.welcomeFounder }));

import type { GameApp } from "../main";
import { LOAD_FAILED, loadSave } from "./loadMenu";

let app: { ui: { cb: { onLoadSlot: ReturnType<typeof vi.fn> }; sayVisibly: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  Object.assign(fake, { splash: false, loaded: true });
  fake.loadFromSplash.mockReset().mockImplementation(() => fake.loaded);
  fake.welcomeFounder.mockReset();
  app = { ui: { cb: { onLoadSlot: vi.fn() }, sayVisibly: vi.fn() } };
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
