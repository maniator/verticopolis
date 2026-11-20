import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TowerFileEntry } from "../storage/fileSpace";
import type { RecentTower } from "../storage/recentTowers";

const fake = vi.hoisted(() => ({
  open: true,
  files: new Map<string, TowerFileEntry>(),
  canLink: true,
  linkId: "L1" as string | null,
  keptLinkId: "L1" as string | null,
  state: { name: "Towers", access: "granted" } as { name: string; access: string } | null,
  allow: vi.fn(),
  openTowersFile: vi.fn(),
  openLinkedRow: vi.fn(),
  track: vi.fn(),
}));
vi.mock("../storage/fileSpace", () => ({
  fileSpace: { isOpen: () => fake.open, get: (id: string) => fake.files.get(id) },
}));
vi.mock("../storage/linkedFolder", () => ({
  canLinkFolder: () => fake.canLink,
  linkedFolder: {
    linkId: () => fake.linkId,
    keptLinkId: () => fake.keptLinkId,
    state: () => fake.state,
    allow: fake.allow,
  },
}));
vi.mock("./fileSpaceCommands", () => ({ openTowersFile: fake.openTowersFile }));
vi.mock("./linkedFolderCommands", () => ({ openLinkedRow: fake.openLinkedRow }));
vi.mock("../analytics", () => ({ trackAppAction: fake.track }));

import type { GameApp } from "../main";
import { RECENT_KEY } from "../storage/recentTowers";
import { fillRecentMenu, openRecent, recentLabel, wireRecentMenu } from "./recentMenu";
import { html } from "lit-html";
import { drawMenuBar } from "./menuBarHost";
import { mountPage } from "../ui/testing/litTestUtils";

const towers = (n: number, kind: RecentTower["kind"] = "tower"): RecentTower => ({
  place: "towers",
  id: `id${n}`,
  name: `Tower ${n}`,
  kind,
});
const folder = (file: string, link = "L1"): RecentTower => ({
  place: "folder",
  id: file,
  name: file,
  kind: "tower",
  link,
});
const entry = (n: number, name = `Tower ${n}`, kind: TowerFileEntry["kind"] = "tower"): TowerFileEntry => ({
  id: `id${n}`,
  name,
  kind,
  size: 1,
  modified: n,
});
const stored = () => JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as RecentTower[];
const keep = (...list: RecentTower[]) => localStorage.setItem(RECENT_KEY, JSON.stringify(list));

let root: HTMLElement;
let app: { ui: { sayVisibly: ReturnType<typeof vi.fn> } };
const shown = () =>
  [...root.querySelectorAll<HTMLElement>("button")].filter((b) => !b.hidden).map((b) => b.textContent);
const item = (n: number) => root.querySelector<HTMLElement>(`#mb-recent-${n}`)!;

beforeEach(() => {
  localStorage.clear();
  Object.assign(fake, {
    open: true,
    canLink: true,
    linkId: "L1",
    keptLinkId: "L1",
    state: { name: "Towers", access: "granted" },
  });
  fake.files = new Map([1, 2, 3, 4, 5, 6].map((n) => [`id${n}`, entry(n)]));
  for (const f of [fake.allow, fake.openTowersFile, fake.openLinkedRow, fake.track]) f.mockReset();
  fake.openTowersFile.mockResolvedValue("opened");
  fake.openLinkedRow.mockResolvedValue(true);
  // The real bar, drawn from the game's model; root is Open Recent's submenu.
  mountPage(html`<div id="menubar-host"></div>`);
  drawMenuBar();
  root = document.getElementById("mb-recent-menu")!;
  app = { ui: { sayVisibly: vi.fn() } };
  wireRecentMenu(app as unknown as GameApp);
});

describe("File > Open Recent", () => {
  it("shows the grayed line with no recent towers", () => {
    fillRecentMenu(root);
    expect(shown()).toEqual(["No recent towers"]);
  });

  it("numbers the towers newest first, with the number underlined as its key", () => {
    keep(towers(2), folder("Sky Mall.vctower"), towers(1, "tdt"));
    fake.files.set("id1", entry(1, "Old Tower", "tdt"));
    fillRecentMenu(root);
    expect(shown()).toEqual(["1Tower 2", "2Sky Mall.vctower", "3Old Tower (1994)"]);
    expect(item(2).querySelector("u")?.textContent).toBe("2");
    expect(item(1).title).toBe("In My Towers");
    expect(item(2).title).toBe('In the linked folder "Towers"');
  });

  it("shows a My Towers file under its new name after a rename", () => {
    keep(towers(1));
    fake.files.set("id1", entry(1, "Renamed"));
    expect(recentLabel(towers(1))).toBe("Renamed");
  });

  it("takes a file deleted from My Towers, and one from a folder no longer linked, off the list", () => {
    keep(towers(9), towers(1), folder("Gone.vctower", "L0"), folder("Here.vctower"));
    fillRecentMenu(root);
    expect(shown()).toEqual(["1Tower 1", "2Here.vctower"]);
    expect(stored()).toEqual([towers(1), folder("Here.vctower")]);
  });

  it("hides, and keeps, the lines of a folder another tab linked since this page opened", () => {
    // This page still has link L1; another tab linked a new folder (L2) and
    // put one of its files on top of the shared list.
    fake.keptLinkId = "L2";
    keep(folder("Theirs.vctower", "L2"), folder("Mine.vctower"), folder("Old.vctower", "L0"));
    fillRecentMenu(root);
    expect(shown()).toEqual(["1Mine.vctower"]);
    expect(stored()).toEqual([folder("Theirs.vctower", "L2"), folder("Mine.vctower")]);
  });

  it("keeps every line while My Towers is still opening, under the stored names", () => {
    fake.open = false;
    keep(towers(9));
    fillRecentMenu(root);
    expect(shown()).toEqual(["1Tower 9"]);
    expect(stored()).toEqual([towers(9)]);
  });

  it("hides a linked file in a browser that can't link a folder, and keeps it", () => {
    fake.canLink = false;
    keep(folder("Sky.vctower"), towers(1));
    fillRecentMenu(root);
    expect(shown()).toEqual(["1Tower 1"]);
    expect(stored()).toHaveLength(2);
  });

  it("opens a My Towers line through the Open window's path, and counts where it came from", async () => {
    keep(towers(2), towers(1));
    fillRecentMenu(root);
    item(2).click();
    await vi.waitFor(() => expect(fake.openTowersFile).toHaveBeenCalledWith(app, "id1"));
    expect(fake.track).toHaveBeenCalledWith("files_open", "recent");
    expect(app.ui.sayVisibly).not.toHaveBeenCalled();
  });

  it("says a My Towers file is gone, takes it off the list and counts it", async () => {
    keep(towers(1), towers(2));
    fake.openTowersFile.mockResolvedValue("gone");
    await openRecent(app as unknown as GameApp, towers(1));
    expect(app.ui.sayVisibly).toHaveBeenCalledWith(expect.stringContaining(`"Tower 1" isn't in My Towers any more`));
    expect(fake.track).toHaveBeenCalledWith("recent_missing", "towers");
    expect(stored()).toEqual([towers(2)]);
  });

  it("keeps the line when My Towers itself can't open, and says why", async () => {
    keep(towers(1));
    fake.openTowersFile.mockResolvedValue("closed");
    await openRecent(app as unknown as GameApp, towers(1));
    expect(app.ui.sayVisibly).toHaveBeenCalledWith(expect.stringContaining("My Towers can't be opened"));
    expect(stored()).toEqual([towers(1)]);
    expect(fake.track).not.toHaveBeenCalledWith("recent_missing", expect.anything());
  });

  it("opens a linked file through the folder's path, without asking when the folder is allowed", async () => {
    await openRecent(app as unknown as GameApp, folder("Sky.vctower"));
    expect(fake.allow).not.toHaveBeenCalled();
    expect(fake.openLinkedRow).toHaveBeenCalledWith(app, { id: "Sky.vctower", name: "Sky.vctower", type: "tower" });
  });

  it("asks the browser's OK first when the folder needs it, and opens once it is given", async () => {
    fake.state = { name: "Towers", access: "prompt" };
    fake.allow.mockResolvedValue("granted");
    await openRecent(app as unknown as GameApp, folder("Sky.vctower"));
    expect(fake.track).toHaveBeenCalledWith("folder_allow", "granted");
    expect(fake.openLinkedRow).toHaveBeenCalledOnce();
  });

  it("keeps the line and opens nothing when the browser says no", async () => {
    keep(folder("Sky.vctower"));
    fake.state = { name: "Towers", access: "prompt" };
    fake.allow.mockRejectedValue(new DOMException("no gesture", "SecurityError"));
    await openRecent(app as unknown as GameApp, folder("Sky.vctower"));
    expect(fake.track).toHaveBeenCalledWith("folder_allow", "denied");
    expect(fake.openLinkedRow).not.toHaveBeenCalled();
    expect(app.ui.sayVisibly).toHaveBeenCalledWith(expect.stringContaining("didn't allow"));
    expect(stored()).toEqual([folder("Sky.vctower")]);
  });

  it("drops a linked file that is gone from its folder", async () => {
    keep(folder("Sky.vctower"), towers(1));
    fake.openLinkedRow.mockResolvedValue(false);
    await openRecent(app as unknown as GameApp, folder("Sky.vctower"));
    expect(fake.track).toHaveBeenCalledWith("recent_missing", "folder");
    expect(stored()).toEqual([towers(1)]);
  });

  it("drops a linked file whose folder was unlinked since the menu opened, and says so", async () => {
    keep(folder("Sky.vctower"));
    fake.linkId = null;
    await openRecent(app as unknown as GameApp, folder("Sky.vctower"));
    expect(fake.openLinkedRow).not.toHaveBeenCalled();
    expect(app.ui.sayVisibly).toHaveBeenCalledWith(expect.stringContaining("isn't linked any more"));
    expect(stored()).toEqual([]);
  });
});
