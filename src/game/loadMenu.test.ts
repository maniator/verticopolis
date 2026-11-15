// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SlotInfo } from "../storage/SaveGame";
import type { TowerFileEntry } from "../storage/fileSpace";

const fake = vi.hoisted(() => ({
  slots: [] as SlotInfo[],
  files: [] as TowerFileEntry[],
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
vi.mock("../storage/fileSpace", () => ({ fileSpace: { list: () => fake.files } }));
vi.mock("./interactionState", () => ({ isSplashUp: () => fake.splash }));
vi.mock("./appModals", () => ({ loadFromSplash: fake.loadFromSplash }));
vi.mock("./titleScreen", () => ({ welcomeFounder: fake.welcomeFounder }));

import type { GameApp } from "../main";
import { autoItemText, fileItemText, fillLoadMenu, LOAD_FAILED, wireLoadMenu } from "./loadMenu";

const auto = (towerName?: string, exists = true): SlotInfo => ({ slot: "auto", exists, present: true, towerName });
const file = (n: number, kind: TowerFileEntry["kind"] = "tower"): TowerFileEntry => ({ id: `id${n}`, name: `Tower ${n}`, kind, size: 10, modified: n });

let root: HTMLElement;
let app: { ui: { cb: { onLoadSlot: ReturnType<typeof vi.fn> }; sayVisibly: ReturnType<typeof vi.fn> } };
const commands = { openFile: vi.fn(), more: vi.fn() };

beforeEach(() => {
  Object.assign(fake, { slots: [], files: [], listThrows: false, splash: false, loaded: true });
  fake.loadFromSplash.mockReset().mockImplementation(() => fake.loaded);
  fake.welcomeFounder.mockReset();
  commands.openFile.mockReset();
  commands.more.mockReset();
  root = document.createElement("div");
  const fileItems = [1, 2, 3, 4, 5].map((n) => `<button id="mb-load-file-${n}" data-load-file="" hidden></button>`).join("");
  root.innerHTML = `<div id="mb-load-menu">
    <button id="mb-load-auto" hidden>Auto-save</button>
    ${fileItems}
    <button id="mb-load-more" hidden>More…</button>
    <button id="mb-load-none" aria-disabled="true">No saved towers yet</button>
  </div>`;
  app = { ui: { cb: { onLoadSlot: vi.fn() }, sayVisibly: vi.fn() } };
  wireLoadMenu(app as unknown as GameApp, commands, root);
});

const item = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
const shown = () => [...root.querySelectorAll<HTMLElement>("button")].filter((b) => !b.hidden).map((b) => b.textContent?.trim());

describe("File > Load", () => {
  it("names the Auto-save by its tower, and a 1994 file as one", () => {
    expect(autoItemText(auto("Sky Hotel"))).toBe("Auto-save: Sky Hotel");
    expect(autoItemText(auto())).toBe("Auto-save: Tower");
    expect(fileItemText(file(1))).toBe("Tower 1");
    expect(fileItemText(file(2, "tdt"))).toBe("Tower 2 (1994)");
  });

  it("lists the Auto-save and the newest files, in the folder's order", () => {
    fake.slots = [auto("Sky Hotel")];
    fake.files = [file(9), file(8, "tdt")];
    fillLoadMenu(root);
    expect(shown()).toEqual(["Auto-save: Sky Hotel", "Tower 9", "Tower 8 (1994)"]);
  });

  it("shows five files, then More…", () => {
    fake.files = [6, 5, 4, 3, 2, 1].map((n) => file(n));
    fillLoadMenu(root);
    expect(shown()).toEqual(["Tower 6", "Tower 5", "Tower 4", "Tower 3", "Tower 2", "More…"]);
  });

  it("shows the grayed line when there is nothing to load, or storage is blocked", () => {
    fake.slots = [auto("Sky", false)];
    fillLoadMenu(root);
    expect(shown()).toEqual(["No saved towers yet"]);
    fake.listThrows = true;
    fillLoadMenu(root);
    expect(shown()).toEqual(["No saved towers yet"]);
  });

  it("opens a listed file by its id, and More… opens the Open window", () => {
    fake.files = [file(1), file(2)];
    fillLoadMenu(root);
    item("mb-load-file-2").click();
    item("mb-load-more").click();
    expect(commands.openFile).toHaveBeenCalledWith("id2");
    expect(commands.more).toHaveBeenCalledOnce();
  });

  it("in a tower, loads the Auto-save the tower's own way", () => {
    item("mb-load-auto").click();
    expect(app.ui.cb.onLoadSlot).toHaveBeenCalledWith("auto");
    expect(fake.loadFromSplash).not.toHaveBeenCalled();
  });

  it("on the title screen, loads through the title screen and welcomes a founder once the tower arrives", () => {
    fake.splash = true;
    item("mb-load-auto").click();
    expect(fake.loadFromSplash).toHaveBeenCalledWith(app, "auto");
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
