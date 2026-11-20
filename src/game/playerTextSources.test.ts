import { beforeEach, describe, expect, it, vi } from "vitest";
import { knownPlayerText, resetPlayerTextForTest } from "../analyticsPlayerText";
import { wirePlayerTextSources } from "./playerTextSources";

const m = vi.hoisted(() => ({
  files: vi.fn(() => [] as { name: string }[]),
  linked: vi.fn(() => [] as { name: string }[]),
  recent: vi.fn(() => [] as { place: "towers" | "folder"; id: string; name: string }[]),
}));
vi.mock("../storage/fileSpace", () => ({ fileSpace: { list: m.files } }));
vi.mock("../storage/linkedFolder", () => ({ linkedFolder: { list: m.linked } }));
vi.mock("../storage/recentTowers", () => ({ recentTowers: m.recent }));

describe("the game's player text sources (#607)", () => {
  beforeEach(() => {
    resetPlayerTextForTest();
    m.files.mockReset().mockReturnValue([]);
    m.linked.mockReset().mockReturnValue([]);
    m.recent.mockReset().mockReturnValue([]);
  });

  it("names the open tower, My Towers, the linked folder and Recent, with each file's stem", () => {
    const app = { enginePort: { towerName: vi.fn(() => "Harmony Tower") } };
    m.files.mockReturnValue([{ name: "Spire" }]);
    m.linked.mockReturnValue([{ name: "Lighthouse.vctower" }]);
    m.recent.mockReturnValue([
      { place: "towers", id: "f1", name: "Old Mill" },
      { place: "folder", id: "Harbor Point.TDT", name: "Harbor" },
    ]);
    wirePlayerTextSources(app);

    expect(knownPlayerText().sort()).toEqual(
      [
        "Harbor",
        "Harbor Point",
        "Harbor Point.TDT",
        "Harmony Tower",
        "Lighthouse",
        "Lighthouse.vctower",
        "Old Mill",
        "Spire",
      ].sort(),
    );
    // A My Towers file id is not text the player wrote.
    expect(knownPlayerText()).not.toContain("f1");
  });

  it("still knows the open tower's name from the screen when the engine throws", () => {
    const app = {
      enginePort: {
        towerName: vi.fn((): string | undefined => {
          throw new Error("engine trapped");
        }),
      },
      ui: { el: { towerName: { value: "Harmony Tower" } } },
    };
    wirePlayerTextSources(app);
    expect(knownPlayerText()).toEqual(["Harmony Tower"]);
  });

  it("reads the open tower at report time, so a renamed or swapped tower is current", () => {
    const app = { enginePort: { towerName: vi.fn(() => "First") } };
    wirePlayerTextSources(app);
    expect(app.enginePort.towerName).not.toHaveBeenCalled();
    app.enginePort.towerName.mockReturnValue("Second");
    expect(knownPlayerText()).toEqual(["Second"]);
  });

  it("replaces its sources when wired again, never doubling them", () => {
    const first = { enginePort: { towerName: vi.fn(() => "First") } };
    const second = { enginePort: { towerName: vi.fn(() => "Second") } };
    wirePlayerTextSources(first);
    wirePlayerTextSources(second);
    expect(knownPlayerText()).toEqual(["Second"]);
    expect(first.enginePort.towerName).not.toHaveBeenCalled();
    expect(m.files).toHaveBeenCalledOnce();
  });
});
