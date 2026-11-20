import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("./analyticsCore", () => core);

import {
  MENU_ITEM_CODES,
  clearMenuPicks,
  menuItemCodeOf,
  menuNameOf,
  trackMenuDismiss,
  trackMenuOpen,
  trackMenuPick,
} from "./analyticsMenus";

beforeEach(() => {
  core.trackEvent.mockClear();
  clearMenuPicks();
});

describe("menu analytics", () => {
  it("names a menu from its title's or its popup's id, and nothing else", () => {
    expect(menuNameOf("mb-file")).toBe("file");
    expect(menuNameOf("mb-help-menu")).toBe("help");
    expect(menuNameOf("mb-quick-save")).toBeNull();
    expect(menuNameOf("")).toBeNull();
  });

  it("reports an item by its code, and an unknown item as other", () => {
    expect(menuItemCodeOf("mb-undo")).toBe("undo");
    expect(menuItemCodeOf("btn-new")).toBe("new_tower");
    expect(menuItemCodeOf("mb-new-thing")).toBe("other");
    expect(menuItemCodeOf("toString")).toBe("other"); // an Object prototype key is not an item
    expect(new Set(Object.values(MENU_ITEM_CODES)).size).toBe(Object.keys(MENU_ITEM_CODES).length);
  });

  it("each pick carries the real pick before it; a grayed click is reported but never becomes one", () => {
    const pick = { menu: "file", via: "pointer", screen: "tower", browsed: 1 } as const;
    trackMenuPick({ ...pick, item: "quick_save", grayed: false });
    trackMenuPick({ ...pick, item: "undo", grayed: true });
    trackMenuPick({ ...pick, item: "export", grayed: false });
    expect(core.trackEvent.mock.calls).toEqual([
      ["menu_pick", { ...pick, item: "quick_save", grayed: false, after: "none" }],
      ["menu_pick", { ...pick, item: "undo", grayed: true, after: "quick_save" }],
      ["menu_pick", { ...pick, item: "export", grayed: false, after: "quick_save" }],
    ]);
    clearMenuPicks();
    trackMenuPick({ ...pick, item: "map", grayed: false, state: "on" });
    expect(core.trackEvent).toHaveBeenLastCalledWith("menu_pick", {
      ...pick,
      item: "map",
      grayed: false,
      state: "on",
      after: "none",
    });
  });

  it("opens and dismissals go out as they are", () => {
    trackMenuOpen({ menu: "edit", via: "alt", screen: "title" });
    trackMenuDismiss({ menu: "tower", how: "outside", screen: "tower", browsed: 3 });
    expect(core.trackEvent.mock.calls).toEqual([
      ["menu_open", { menu: "edit", via: "alt", screen: "title" }],
      ["menu_dismiss", { menu: "tower", how: "outside", screen: "tower", browsed: 3 }],
    ]);
  });
});
