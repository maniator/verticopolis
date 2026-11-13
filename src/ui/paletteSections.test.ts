import { describe, expect, it, vi } from "vitest";
import { applySectionFolds, PALETTE_FOLDED_CLASS, PALETTE_FOLDED_STORAGE_KEY, storedFoldedGroups, wireSectionFolds } from "./paletteSections";

/** The palette's item container as buildPalette lays it out: the pinned Tools
 *  cluster, then a section per category, one with a Modern sub-band. */
function paletteRoot(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <div class="pal-pinned"><div class="pal-group-title">Tools</div><div class="pal-item" data-tool="inspect"></div></div>
    <div class="pal-groups">
      <section class="pal-group" data-group="Structure"><div class="pal-group-title" data-group="Structure">Structure</div><div class="pal-item" data-kind="lobby"></div></section>
      <section class="pal-group" data-group="Leisure"><div class="pal-group-title" data-group="Leisure">Leisure</div><div class="pal-item" data-kind="cinema"></div><div class="pal-group-title pal-sub" data-sub-group="Leisure">Modern</div><div class="pal-item pal-mod" data-kind="spa"></div></section>
    </div>`;
  document.body.append(root);
  return root;
}

function memoryStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: vi.fn((key: string) => (key in data ? data[key] : null)),
    setItem: vi.fn((key: string, value: string) => {
      data[key] = value;
    }),
  };
}

const section = (root: HTMLElement, title: string) => root.querySelector<HTMLElement>(`.pal-group[data-group="${title}"]`)!;
const header = (root: HTMLElement, title: string) => section(root, title).querySelector<HTMLElement>(":scope > .pal-group-title[data-group]")!;
const folded = (root: HTMLElement, title: string) => section(root, title).classList.contains(PALETTE_FOLDED_CLASS);

describe("folding a palette category from its header", () => {
  it("makes each category header a fold control, leaving the Tools title and the Modern sub-band alone", () => {
    const root = paletteRoot();
    applySectionFolds(root, memoryStore());
    const structure = header(root, "Structure");
    expect(structure.getAttribute("role")).toBe("button");
    expect(structure.tabIndex).toBe(0);
    expect(structure.getAttribute("aria-expanded")).toBe("true");
    expect(structure.getAttribute("aria-label")).toBe("Structure tools");
    expect(root.querySelector(".pal-pinned .pal-group-title")!.hasAttribute("role")).toBe(false);
    expect(root.querySelector(".pal-sub")!.hasAttribute("role")).toBe(false);
    root.remove();
  });

  it("shows the stored folds", () => {
    const root = paletteRoot();
    applySectionFolds(root, memoryStore({ [PALETTE_FOLDED_STORAGE_KEY]: JSON.stringify(["Leisure"]) }));
    expect(folded(root, "Leisure")).toBe(true);
    expect(header(root, "Leisure").getAttribute("aria-expanded")).toBe("false");
    expect(folded(root, "Structure")).toBe(false);
    root.remove();
  });

  it("folds and opens on a click, stores the set, and asks for a refit", () => {
    const root = paletteRoot();
    const store = memoryStore();
    const refit = vi.fn();
    applySectionFolds(root, store);
    wireSectionFolds(root, store, refit);
    header(root, "Leisure").click();
    expect(folded(root, "Leisure")).toBe(true);
    expect(JSON.parse(store.data[PALETTE_FOLDED_STORAGE_KEY])).toEqual(["Leisure"]);
    header(root, "Structure").click();
    expect(JSON.parse(store.data[PALETTE_FOLDED_STORAGE_KEY])).toEqual(["Leisure", "Structure"]);
    header(root, "Leisure").click();
    expect(folded(root, "Leisure")).toBe(false);
    expect(header(root, "Leisure").getAttribute("aria-expanded")).toBe("true");
    expect(JSON.parse(store.data[PALETTE_FOLDED_STORAGE_KEY])).toEqual(["Structure"]);
    expect(refit).toHaveBeenCalledTimes(3);
    root.remove();
  });

  it("folds on an Enter press or a Space release, once per press, like the tools", () => {
    const root = paletteRoot();
    const store = memoryStore();
    applySectionFolds(root, store);
    wireSectionFolds(root, store, () => {});
    const send = (type: "keydown" | "keyup", init: KeyboardEventInit, target = header(root, "Leisure")) => {
      const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(e);
      return e;
    };
    const space = { key: " ", code: "Space" };
    expect(send("keydown", { key: "Enter" }).defaultPrevented).toBe(true);
    expect(folded(root, "Leisure")).toBe(true);
    send("keydown", { key: "Enter", repeat: true });
    send("keydown", { key: "Enter", ctrlKey: true });
    expect(folded(root, "Leisure")).toBe(true);
    // Space: the press alone does nothing, the release acts.
    expect(send("keydown", space).defaultPrevented).toBe(true);
    expect(folded(root, "Leisure")).toBe(true);
    send("keyup", space);
    expect(folded(root, "Leisure")).toBe(false);
    // A release with no press here (Space pressed elsewhere) does nothing.
    send("keyup", space);
    expect(folded(root, "Leisure")).toBe(false);
    // A release the pan key canceled (inputKeys prevents it) does nothing.
    send("keydown", space);
    const canceled = new KeyboardEvent("keyup", { bubbles: true, cancelable: true, ...space });
    canceled.preventDefault();
    header(root, "Leisure").dispatchEvent(canceled);
    expect(folded(root, "Leisure")).toBe(false);
    // A press on one header and a release on another does nothing.
    send("keydown", space);
    send("keyup", space, header(root, "Structure"));
    expect(folded(root, "Leisure")).toBe(false);
    expect(folded(root, "Structure")).toBe(false);
    // Focus leaving between the press and the release drops the press.
    send("keydown", space);
    header(root, "Leisure").dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    send("keyup", space);
    expect(folded(root, "Leisure")).toBe(false);
    // A chord with Space is left to the system.
    expect(send("keydown", { ...space, ctrlKey: true }).defaultPrevented).toBe(false);
    send("keyup", space);
    expect(folded(root, "Leisure")).toBe(false);
    root.remove();
  });

  it("ignores clicks on tools, the sub-band and the Tools title", () => {
    const root = paletteRoot();
    const store = memoryStore();
    const refit = vi.fn();
    applySectionFolds(root, store);
    wireSectionFolds(root, store, refit);
    root.querySelector<HTMLElement>('[data-kind="cinema"]')!.click();
    root.querySelector<HTMLElement>(".pal-sub")!.click();
    root.querySelector<HTMLElement>(".pal-pinned .pal-group-title")!.click();
    expect(folded(root, "Leisure")).toBe(false);
    expect(refit).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
    root.remove();
  });

  it("reads storage that throws, is missing or holds something else as nothing folded, and folds when a write throws", () => {
    expect(storedFoldedGroups(null).size).toBe(0);
    expect(storedFoldedGroups(memoryStore({ [PALETTE_FOLDED_STORAGE_KEY]: "{not json" })).size).toBe(0);
    expect(storedFoldedGroups(memoryStore({ [PALETTE_FOLDED_STORAGE_KEY]: JSON.stringify({ Leisure: true }) })).size).toBe(0);
    expect([...storedFoldedGroups(memoryStore({ [PALETTE_FOLDED_STORAGE_KEY]: JSON.stringify(["Living", 3]) }))]).toEqual(["Living"]);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    expect(storedFoldedGroups(throwing).size).toBe(0);
    const root = paletteRoot();
    applySectionFolds(root, throwing);
    wireSectionFolds(root, throwing, () => {});
    header(root, "Leisure").click();
    expect(folded(root, "Leisure")).toBe(true);
    root.remove();
  });
});
