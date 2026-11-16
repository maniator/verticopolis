import { beforeEach, describe, expect, it, vi } from "vitest";
import { dropRecentTower, keepRecentTowers, noteFolderFile, noteRecentTower, noteTowersFile, RECENT_KEY, RECENT_MAX, recentTowers, type RecentTower } from "./recentTowers";

const towers = (n: number, kind: RecentTower["kind"] = "tower"): RecentTower => ({ place: "towers", id: `id${n}`, name: `Tower ${n}`, kind });
const folder = (file: string, link = "L1"): RecentTower => ({ place: "folder", id: file, name: file, kind: "tower", link });

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("the recent towers list", () => {
  it("starts empty and puts each noted tower on top, newest first", () => {
    expect(recentTowers()).toEqual([]);
    noteRecentTower(towers(1));
    noteRecentTower(folder("Sky.vctower"));
    expect(recentTowers()).toEqual([folder("Sky.vctower"), towers(1)]);
  });

  it("moves a tower noted again to the top instead of listing it twice", () => {
    noteRecentTower(towers(1));
    noteRecentTower(towers(2));
    noteRecentTower({ ...towers(1), name: "Renamed" });
    expect(recentTowers().map((t) => [t.id, t.name])).toEqual([
      ["id1", "Renamed"],
      ["id2", "Tower 2"],
    ]);
  });

  it(`keeps the newest ${RECENT_MAX} and lets the oldest go`, () => {
    for (let n = 1; n <= RECENT_MAX + 2; n++) noteRecentTower(towers(n));
    expect(recentTowers().map((t) => t.id)).toEqual(["id7", "id6", "id5", "id4", "id3"]);
  });

  it("tells the same file name apart in two links, and from a My Towers file of that id", () => {
    noteRecentTower(folder("A.vctower", "L1"));
    noteRecentTower(folder("A.vctower", "L2"));
    noteRecentTower({ place: "towers", id: "A.vctower", name: "A", kind: "tower" });
    expect(recentTowers()).toHaveLength(3);
  });

  it("drops one tower and keeps the rest in order", () => {
    [1, 2, 3].forEach((n) => noteRecentTower(towers(n)));
    dropRecentTower(towers(2));
    expect(recentTowers().map((t) => t.id)).toEqual(["id3", "id1"]);
    keepRecentTowers([towers(1)]);
    expect(recentTowers()).toEqual([towers(1)]);
  });

  it("notes a My Towers file by id and a linked file by its name on disk and link", () => {
    noteTowersFile({ id: "f1", name: "Old", kind: "tdt" });
    noteFolderFile({ id: "Sky.vctower", kind: "tower" }, "L9");
    noteFolderFile({ id: "Lost.vctower", kind: "tower" }, null);
    expect(recentTowers()).toEqual([folder("Sky.vctower", "L9"), { place: "towers", id: "f1", name: "Old", kind: "tdt" }]);
  });

  it("reads damaged text, wrong shapes and a folder line without its link as nothing", () => {
    localStorage.setItem(RECENT_KEY, "{not json");
    expect(recentTowers()).toEqual([]);
    localStorage.setItem(RECENT_KEY, JSON.stringify({ place: "towers" }));
    expect(recentTowers()).toEqual([]);
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([
        { place: "folder", id: "a.vctower", name: "a", kind: "tower" },
        { place: "towers", id: "", name: "x", kind: "tower" },
        { place: "towers", id: "x", name: "x", kind: "zip" },
        { place: "elsewhere", id: "x", name: "x", kind: "tower" },
        { place: "towers", id: "y".repeat(261), name: "y", kind: "tower" },
        towers(4),
      ]),
    );
    expect(recentTowers()).toEqual([towers(4)]);
  });

  it("refuses to note a line that is not a tower", () => {
    noteRecentTower({ place: "towers", id: "", name: "", kind: "tower" });
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
  });

  it("carries on when storage refuses to read or write", () => {
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => noteRecentTower(towers(1))).not.toThrow();
    vi.restoreAllMocks();
    expect(recentTowers()).toEqual([]);
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(recentTowers()).toEqual([]);
  });
});
