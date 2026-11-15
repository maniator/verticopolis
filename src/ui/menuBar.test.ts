import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuBar, type MenuBarOptions } from "./menuBar";

/** Two menus, the second with a grayed and a hidden item, the way index.html
 *  lays out `#menubar`. */
function setup(onOpen = vi.fn(), more: MenuBarOptions = {}) {
  document.body.innerHTML = `
    <nav id="menubar">
      <div class="mb-menu">
        <button class="mb-title" id="t-file" aria-expanded="false" aria-controls="m-file"><u>F</u>ile</button>
        <div class="mb-pop" id="m-file" role="menu" hidden>
          <button class="mb-item" id="i-new" role="menuitem">New</button>
          <button class="mb-item" id="i-save" role="menuitem">Save</button>
        </div>
      </div>
      <div class="mb-menu">
        <button class="mb-title" id="t-edit" aria-expanded="false" aria-controls="m-edit"><u>E</u>dit</button>
        <div class="mb-pop" id="m-edit" role="menu" hidden>
          <button class="mb-item" id="i-undo" role="menuitem" aria-disabled="true">Undo</button>
          <button class="mb-item" id="i-gone" role="menuitem" hidden>Gone</button>
          <button class="mb-item" id="i-redo" role="menuitem">Redo</button>
        </div>
      </div>
    </nav>
    <div id="outside"></div>`;
  const root = document.getElementById("menubar")!;
  const bar = new MenuBar(root, { ...more, onOpen });
  bars.push(bar);
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  return { bar, $, key, onOpen };
}

/** Every bar a test made. Its window listeners outlive the test, and a bar
 *  left open, or still swallowing a press that closed it, would eat the next
 *  test's clicks: so each is closed, and one click spends any swallow. */
const bars: MenuBar[] = [];

afterEach(() => {
  for (const bar of bars.splice(0)) bar.close(false);
  document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  document.body.innerHTML = "";
});

describe("MenuBar", () => {
  it("a title's click opens its menu, calls onOpen first, and a second click closes it", () => {
    const { bar, $, onOpen } = setup(vi.fn((menu: HTMLElement) => expect(menu.hidden).toBe(true)));
    $("t-file").click();
    expect($("m-file").hidden).toBe(false);
    expect($("t-file").getAttribute("aria-expanded")).toBe("true");
    expect(onOpen).toHaveBeenCalledWith($("m-file"));
    expect(bar.current()).toBe($("t-file"));
    $("t-file").click();
    expect($("m-file").hidden).toBe(true);
    expect($("t-file").getAttribute("aria-expanded")).toBe("false");
    expect(bar.current()).toBeNull();
  });

  it("pointing at another title switches menus only while one is open", () => {
    const { $ } = setup();
    const point = (el: HTMLElement, pointerType: string) => el.dispatchEvent(new PointerEvent("pointerenter", { pointerType }));
    point($("t-edit"), "mouse");
    expect($("m-edit").hidden).toBe(true);
    $("t-file").click();
    point($("t-edit"), "mouse");
    expect($("m-file").hidden).toBe(true);
    expect($("m-edit").hidden).toBe(false);
  });

  it("a tap on another title while a menu is open switches to it (a touch's pointerenter does not open and then close it)", () => {
    const { $ } = setup();
    $("t-file").click();
    $("t-edit").dispatchEvent(new PointerEvent("pointerenter", { pointerType: "touch" }));
    expect($("m-file").hidden).toBe(false);
    $("t-edit").click();
    expect($("m-file").hidden).toBe(true);
    expect($("m-edit").hidden).toBe(false);
  });

  it("an item's click runs its own handler, then closes the menu; a grayed item keeps it open", () => {
    const { $ } = setup();
    const ran = vi.fn(() => expect($("m-file").hidden).toBe(false));
    $("i-save").addEventListener("click", ran);
    $("t-file").click();
    $("i-save").click();
    expect(ran).toHaveBeenCalledOnce();
    expect($("m-file").hidden).toBe(true);
    $("t-edit").click();
    $("i-undo").click();
    expect($("m-edit").hidden).toBe(false);
  });

  it("a press outside the bar only closes the open menu: the press, its pointerup and its click never reach what is under it", () => {
    const { $ } = setup();
    const under = vi.fn();
    for (const type of ["pointerdown", "pointerup", "click"]) $("outside").addEventListener(type, under);
    $("t-file").click();
    $("outside").dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect($("m-file").hidden).toBe(true);
    $("outside").dispatchEvent(new Event("pointerup", { bubbles: true, cancelable: true }));
    $("outside").click();
    expect(under).not.toHaveBeenCalled();
    // The next press, with no menu open, lands as usual.
    $("outside").dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    $("outside").click();
    expect(under).toHaveBeenCalledTimes(2);
  });

  it("a menu that would run off either edge of the window slides back onto it, and the left edge wins", () => {
    const { $ } = setup();
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 400 });
    const rect = vi.spyOn($("m-edit"), "getBoundingClientRect").mockReturnValue({ left: 230, right: 450 } as DOMRect);
    $("t-edit").click();
    expect($("m-edit").style.translate).toBe("-50px 0");
    $("t-edit").click();
    rect.mockReturnValue({ left: 20, right: 450 } as DOMRect);
    $("t-edit").click();
    expect($("m-edit").style.translate).toBe("-20px 0");
    $("t-edit").click();
    rect.mockReturnValue({ left: 20, right: 240 } as DOMRect);
    $("t-edit").click();
    expect($("m-edit").style.translate).toBe("");
    $("t-edit").click();
    // A menu that starts before the left edge slides right (#2329: a
    // right-aligned Help on the title screen's short bar was cut off).
    rect.mockReturnValue({ left: -60, right: 160 } as DOMRect);
    $("t-edit").click();
    expect($("m-edit").style.translate).toBe("60px 0");
    // @ts-expect-error drop the test's own property, back to jsdom's
    delete document.documentElement.clientWidth;
  });

  it("Down on a title opens it on its first item; Up and Down skip grayed and hidden items and wrap", () => {
    const { $, key } = setup();
    key($("t-edit"), "ArrowDown");
    expect($("m-edit").hidden).toBe(false);
    expect(document.activeElement).toBe($("i-redo")); // Undo is grayed, Gone is hidden
    key($("i-redo"), "ArrowDown");
    expect(document.activeElement).toBe($("i-redo"));
    $("t-file").focus();
    key($("t-file"), "Enter");
    expect(document.activeElement).toBe($("i-new"));
    key($("i-new"), "ArrowUp");
    expect(document.activeElement).toBe($("i-save"));
    key($("i-save"), "Home");
    expect(document.activeElement).toBe($("i-new"));
    key($("i-new"), "End");
    expect(document.activeElement).toBe($("i-save"));
  });

  it("Left and Right in an open menu move to the next menu, wrapping", () => {
    const { $, key } = setup();
    key($("t-file"), "ArrowDown");
    key($("i-new"), "ArrowRight");
    expect($("m-file").hidden).toBe(true);
    expect($("m-edit").hidden).toBe(false);
    key($("i-redo"), "ArrowRight");
    expect($("m-file").hidden).toBe(false);
    expect(document.activeElement).toBe($("i-new"));
  });

  it("Escape closes the menu and gives the focus back to its title", () => {
    const { $, key } = setup();
    key($("t-file"), "ArrowDown");
    key($("i-new"), "Escape");
    expect($("m-file").hidden).toBe(true);
    expect(document.activeElement).toBe($("t-file"));
  });

  it("Tab closes the menu and lets the focus move on", () => {
    const { $, key } = setup();
    key($("t-file"), "ArrowDown");
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    $("i-new").dispatchEvent(ev);
    expect($("m-file").hidden).toBe(true);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("Alt with a title's underlined letter opens that menu; other chords do nothing", () => {
    const { $, key } = setup();
    key(document.body, "e", { altKey: true, ctrlKey: true });
    expect($("m-edit").hidden).toBe(true);
    key(document.body, "e", { altKey: true });
    expect($("m-edit").hidden).toBe(false);
    expect(document.activeElement).toBe($("i-redo"));
  });

  it("Left, Right and Alt letters skip a menu that is hidden or that the layout leaves out", () => {
    const { bar, $, key } = setup();
    // The layout leaves Edit out (a phone's `.mb-desktop-only`, display: none).
    $("t-edit").parentElement!.style.display = "none";
    key($("t-file"), "ArrowRight");
    expect(document.activeElement).toBe($("t-file"));
    key(document.body, "e", { altKey: true });
    expect(bar.current()).toBeNull();
    // Hidden (the title screen hides the menus that need a tower).
    $("t-edit").parentElement!.style.display = "";
    $("t-edit").parentElement!.hidden = true;
    key($("t-file"), "ArrowLeft");
    expect(document.activeElement).toBe($("t-file"));
    key(document.body, "e", { altKey: true });
    expect(bar.current()).toBeNull();
    // Back on the bar, both reach it again.
    $("t-edit").parentElement!.hidden = false;
    key($("t-file"), "ArrowRight");
    expect(document.activeElement).toBe($("t-edit"));
    key(document.body, "e", { altKey: true });
    expect(bar.current()).toBe($("t-edit"));
  });

  it("Alt with a letter does nothing while a dialog is open", () => {
    const { $, key } = setup();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    key(document.body, "e", { altKey: true });
    expect($("m-edit").hidden).toBe(true);
  });

  it("the window losing focus closes the open menu", () => {
    const { $ } = setup();
    $("t-file").click();
    window.dispatchEvent(new Event("blur"));
    expect($("m-file").hidden).toBe(true);
  });
});

describe("MenuBar trips (the menu analytics' hooks)", () => {
  const pointerClick = (el: HTMLElement) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  function tripSetup() {
    const onTrip = vi.fn();
    const onDismiss = vi.fn();
    return { ...setup(vi.fn(), { onTrip, onDismiss }), onTrip, onDismiss };
  }

  it("a trip begins once, however many menus it shows, and counts them", () => {
    const { bar, $, onTrip, onDismiss } = tripSetup();
    pointerClick($("t-file"));
    expect(onTrip).toHaveBeenCalledExactlyOnceWith($("t-file"), "click");
    $("t-edit").dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    $("t-file").dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    expect(onTrip).toHaveBeenCalledOnce();
    expect(bar.browsed()).toBe(2);
    pointerClick($("i-new"));
    expect(onDismiss).not.toHaveBeenCalled(); // a pick is not a dismissal
    expect(bar.browsed()).toBe(0);
    pointerClick($("t-edit"));
    expect(onTrip).toHaveBeenLastCalledWith($("t-edit"), "click");
    expect(bar.browsed()).toBe(1);
  });

  it("says how a trip began: a click, the keyboard on a title, or Alt with its letter", () => {
    const { bar, $, key, onTrip } = tripSetup();
    key($("t-file"), "ArrowDown");
    expect(onTrip).toHaveBeenLastCalledWith($("t-file"), "keys");
    bar.close();
    $("t-edit").click(); // Enter or Space on a focused button: a click with no pointer
    expect(onTrip).toHaveBeenLastCalledWith($("t-edit"), "keys");
    bar.close();
    key(document.body, "e", { altKey: true });
    expect(onTrip).toHaveBeenLastCalledWith($("t-edit"), "alt");
    bar.close();
  });

  it("reports each way a trip ends with no pick, with the menu last open and the menus it showed", () => {
    const { $, key, onDismiss } = tripSetup();
    key($("t-file"), "ArrowDown");
    key($("i-new"), "Escape");
    expect(onDismiss).toHaveBeenLastCalledWith($("t-file"), "escape", 1);

    key($("t-file"), "ArrowDown");
    key($("i-new"), "Tab");
    expect(onDismiss).toHaveBeenLastCalledWith($("t-file"), "tab", 1);

    pointerClick($("t-file"));
    pointerClick($("t-file"));
    expect(onDismiss).toHaveBeenLastCalledWith($("t-file"), "title", 1);

    pointerClick($("t-file"));
    window.dispatchEvent(new Event("blur"));
    expect(onDismiss).toHaveBeenLastCalledWith($("t-file"), "blur", 1);

    window.dispatchEvent(new Event("blur")); // nothing open: nothing to report
    expect(onDismiss).toHaveBeenCalledTimes(4);

    // Last, since the press that closes a menu swallows the clicks after it.
    pointerClick($("t-file"));
    $("t-edit").dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    $("outside").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(onDismiss).toHaveBeenLastCalledWith($("t-edit"), "outside", 2);
    expect(onDismiss).toHaveBeenCalledTimes(5);
  });

  it("a grayed item keeps the trip going", () => {
    const { bar, $, onDismiss } = tripSetup();
    pointerClick($("t-edit"));
    pointerClick($("i-undo"));
    expect(bar.current()).toBe($("t-edit"));
    expect(bar.browsed()).toBe(1);
    expect(onDismiss).not.toHaveBeenCalled();
    bar.close();
  });
});

describe("the game's File menu (index.html)", () => {
  it("reads New…, Open…, Save, Save As… and Close, with no Load submenu (4.3)", () => {
    const indexHtml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../index.html"), "utf8");
    const page = new DOMParser().parseFromString(indexHtml, "text/html");
    const menu = page.getElementById("mb-file-menu")!;
    const label = (item: Element) => [...item.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim();
    const shown = [...menu.querySelectorAll(".mb-item:not([hidden])")].map(label);
    expect(shown).toEqual(["New…", "Open…", "Save", "Save As…", "Close"]);
    expect(menu.querySelector(".mb-sub, [aria-haspopup]"), "File > Load and its submenu are gone").toBeNull();
  });
});
