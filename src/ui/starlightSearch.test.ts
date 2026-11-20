import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openStarlightSearch } from "./starlightSearch";

/**
 * A stand-in for Starlight's search, as its openModal behaves: the button
 * opens the dialog, stops its own click, and then closes the dialog on any
 * later click on the window outside the dialog's frame. A menu item calls the
 * opener from its own click handler.
 */
function mountPage(): { item: HTMLButtonElement; dialog: HTMLDialogElement } {
  document.body.innerHTML = `
    <site-search>
      <button data-open-modal>Search</button>
      <dialog><div class="dialog-frame"><input></div></dialog>
    </site-search>
    <button id="find">Find…</button>`;
  const button = document.querySelector<HTMLButtonElement>("button[data-open-modal]")!;
  const dialog = document.querySelector("dialog")!;
  const frame = document.querySelector(".dialog-frame")!;
  const onWindowClick = (e: MouseEvent) => {
    if (!frame.contains(e.target as Node)) {
      dialog.removeAttribute("open");
      window.removeEventListener("click", onWindowClick);
    }
  };
  button.addEventListener("click", (e) => {
    dialog.setAttribute("open", "");
    e.stopPropagation();
    window.addEventListener("click", onWindowClick);
  });
  const item = document.querySelector<HTMLButtonElement>("#find")!;
  item.addEventListener("click", () => openStarlightSearch(document));
  return { item, dialog };
}

describe("openStarlightSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("leaves the search open after the menu item's own click reaches the window", () => {
    const { item, dialog } = mountPage();
    item.click();
    vi.runAllTimers();
    expect(dialog.hasAttribute("open")).toBe(true);
  });

  it("opens nothing before the item's click is done", () => {
    const { item, dialog } = mountPage();
    item.click();
    expect(dialog.hasAttribute("open")).toBe(false);
    vi.runAllTimers();
    expect(dialog.hasAttribute("open")).toBe(true);
  });

  it("does nothing on a page without a search box", () => {
    document.body.innerHTML = "<p>No search here</p>";
    openStarlightSearch(document);
    expect(() => vi.runAllTimers()).not.toThrow();
  });
});
