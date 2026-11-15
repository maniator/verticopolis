import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuBar } from "./menuBar";

/** A File menu with a Load submenu between two items, the way index.html lays
 *  out File > Load. */
function setup() {
  document.body.innerHTML = `
    <nav id="menubar">
      <div class="mb-menu">
        <button class="mb-title" id="t-file" aria-expanded="false" aria-controls="m-file"><u>F</u>ile</button>
        <div class="mb-pop" id="m-file" role="menu" hidden>
          <button class="mb-item" id="i-open" role="menuitem">Open</button>
          <div class="mb-sub" role="none">
            <button class="mb-item mb-sub-title" id="i-load" role="menuitem" aria-expanded="false" aria-controls="m-load">Load</button>
            <div class="mb-pop mb-subpop" id="m-load" role="menu" hidden>
              <button class="mb-item" id="i-auto" role="menuitem">Auto-save</button>
              <button class="mb-item" id="i-gone" role="menuitem" hidden>Slot 1</button>
              <button class="mb-item" id="i-two" role="menuitem">Slot 2</button>
            </div>
          </div>
          <button class="mb-item" id="i-save" role="menuitem">Save</button>
        </div>
      </div>
    </nav>`;
  const bar = new MenuBar(document.getElementById("menubar")!);
  bars.push(bar);
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  const press = (el: Element, pointerType: string) => {
    el.dispatchEvent(new PointerEvent("pointerdown", { pointerType, bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  };
  const point = (el: Element) => el.dispatchEvent(new PointerEvent("pointerover", { pointerType: "mouse", bubbles: true }));
  bar.open($("t-file") as HTMLButtonElement, false);
  return { bar, $, key, press, point };
}

const bars: MenuBar[] = [];
afterEach(() => {
  for (const bar of bars.splice(0)) bar.close(false);
  document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  document.body.innerHTML = "";
});

describe("a menu's submenu", () => {
  it("a mouse opens it by pointing at its title, its click keeps it open, and pointing at another item closes it", () => {
    const { bar, $, press, point } = setup();
    point($("i-load"));
    expect($("m-load").hidden).toBe(false);
    expect($("i-load").getAttribute("aria-expanded")).toBe("true");
    press($("i-load"), "mouse");
    expect($("m-load").hidden).toBe(false);
    expect(bar.current()).toBe($("t-file")); // the title is not a pick: File stays open
    point($("i-auto")); // inside the submenu: it stays
    expect($("m-load").hidden).toBe(false);
    point($("i-save"));
    expect($("m-load").hidden).toBe(true);
    expect($("i-load").getAttribute("aria-expanded")).toBe("false");
  });

  it("a tap on its title opens it and a second tap closes it", () => {
    const { $, press } = setup();
    press($("i-load"), "touch");
    expect($("m-load").hidden).toBe(false);
    press($("i-load"), "touch");
    expect($("m-load").hidden).toBe(true);
  });

  it("picking one of its items closes the whole menu", () => {
    const { bar, $, press } = setup();
    const picked = vi.fn();
    $("i-two").addEventListener("click", picked);
    press($("i-load"), "touch");
    press($("i-two"), "touch");
    expect(picked).toHaveBeenCalledOnce();
    expect(bar.current()).toBeNull();
    expect($("m-load").hidden).toBe(true);
    expect($("i-load").getAttribute("aria-expanded")).toBe("false");
  });

  it("the keys walk into it and back out, skipping a hidden item", () => {
    const { bar, $, key } = setup();
    $("i-load").focus();
    key($("i-load"), "ArrowRight");
    expect($("m-load").hidden).toBe(false);
    expect(document.activeElement).toBe($("i-auto"));
    key($("i-auto"), "ArrowDown");
    expect(document.activeElement).toBe($("i-two"));
    key($("i-two"), "ArrowLeft");
    expect($("m-load").hidden).toBe(true);
    expect(document.activeElement).toBe($("i-load"));
    key($("i-load"), "ArrowRight");
    key($("i-auto"), "Escape"); // closes the submenu only
    expect($("m-load").hidden).toBe(true);
    expect(bar.current()).toBe($("t-file"));
    key($("i-load"), "ArrowDown"); // the File menu's own items again
    expect(document.activeElement).toBe($("i-save"));
  });

  it("Enter on its title opens it with the focus on its first item", () => {
    const { $ } = setup();
    $("i-load").focus();
    $("i-load").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect($("m-load").hidden).toBe(false);
    expect(document.activeElement).toBe($("i-auto"));
  });

  it("closes with its menu", () => {
    const { bar, $, point } = setup();
    point($("i-load"));
    bar.close(false);
    expect($("m-load").hidden).toBe(true);
    bar.open($("t-file") as HTMLButtonElement, false);
    expect($("m-load").hidden).toBe(true);
  });
});
