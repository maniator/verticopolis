// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SlotInfo } from "../storage/SaveGame";

const fake = vi.hoisted(() => ({
  slots: [] as SlotInfo[],
  listThrows: false,
  splash: false,
  loaded: true,
  loadFromSplash: vi.fn(),
  welcomeFounder: vi.fn(),
}));
vi.mock("../storage/SaveGame", () => ({
  SaveGame: {
    listSlots: () => {
      if (fake.listThrows) throw new Error("SecurityError");
      return fake.slots;
    },
  },
}));
vi.mock("./interactionState", () => ({ isSplashUp: () => fake.splash }));
vi.mock("./appModals", () => ({ loadFromSplash: fake.loadFromSplash }));
vi.mock("./titleScreen", () => ({ welcomeFounder: fake.welcomeFounder }));

import type { GameApp } from "../main";
import { fillLoadMenu, LOAD_FAILED, loadItemText, wireLoadMenu } from "./loadMenu";

const row = (slot: SlotInfo["slot"], towerName?: string, exists = true): SlotInfo => ({ slot, exists, present: true, towerName });

let root: HTMLElement;
let app: { ui: { cb: { onLoadSlot: ReturnType<typeof vi.fn> }; sayVisibly: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  Object.assign(fake, { slots: [], listThrows: false, splash: false, loaded: true });
  fake.loadFromSplash.mockReset().mockImplementation(() => fake.loaded);
  fake.welcomeFounder.mockReset();
  root = document.createElement("div");
  root.innerHTML = `<div id="mb-load-menu">
    <button id="mb-load-auto" data-load-slot="auto" hidden>Auto-save</button>
    <button id="mb-load-1" data-load-slot="1" hidden>Slot 1</button>
    <button id="mb-load-2" data-load-slot="2" hidden>Slot 2</button>
    <button id="mb-load-3" data-load-slot="3" hidden>Slot 3</button>
    <button id="mb-load-none" aria-disabled="true">No saved towers yet</button>
  </div>`;
  app = { ui: { cb: { onLoadSlot: vi.fn() }, sayVisibly: vi.fn() } };
  wireLoadMenu(app as unknown as GameApp, root);
});

const item = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
const shown = () => [...root.querySelectorAll<HTMLElement>("button")].filter((b) => !b.hidden).map((b) => b.textContent);

describe("File > Load", () => {
  it("names each save and its tower", () => {
    expect(loadItemText(row("auto", "Sky Hotel"))).toBe("Auto-save: Sky Hotel");
    expect(loadItemText(row(2, "Pine Plaza"))).toBe("Slot 2: Pine Plaza");
    expect(loadItemText(row(1))).toBe("Slot 1: Tower");
  });

  it("lists the Auto-save and each filled slot, and hides the empty ones", () => {
    fake.slots = [row("auto", "Sky Hotel"), row(1, undefined, false), row(2, "Pine Plaza"), row(3, undefined, false)];
    fillLoadMenu(root);
    expect(shown()).toEqual(["Auto-save: Sky Hotel", "Slot 2: Pine Plaza"]);
  });

  it("shows the grayed line when there is nothing to load, or storage is blocked", () => {
    fake.slots = [row("auto", "Sky Hotel")];
    fillLoadMenu(root);
    fake.slots = [row("auto", undefined, false), row(1, undefined, false)];
    fillLoadMenu(root);
    expect(shown()).toEqual(["No saved towers yet"]);
    fake.listThrows = true;
    fillLoadMenu(root);
    expect(shown()).toEqual(["No saved towers yet"]);
  });

  it("in a tower, loads the picked save the way Saved Towers… does", () => {
    item("mb-load-2").click();
    item("mb-load-auto").click();
    expect(app.ui.cb.onLoadSlot.mock.calls).toEqual([[2], ["auto"]]);
    expect(fake.loadFromSplash).not.toHaveBeenCalled();
  });

  it("on the title screen, loads through the title screen and welcomes a founder once the tower arrives", () => {
    fake.splash = true;
    item("mb-load-1").click();
    expect(fake.loadFromSplash).toHaveBeenCalledWith(app, 1);
    expect(fake.welcomeFounder).toHaveBeenCalledWith(app);
    expect(app.ui.cb.onLoadSlot).not.toHaveBeenCalled();
  });

  it("on the title screen, says so when the save will not load", () => {
    fake.splash = true;
    fake.loaded = false;
    item("mb-load-auto").click();
    expect(fake.welcomeFounder).not.toHaveBeenCalled();
    expect(app.ui.sayVisibly).toHaveBeenCalledWith(LOAD_FAILED);
  });
});
