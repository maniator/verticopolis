import { describe, it, expect, vi, beforeEach } from "vitest";
import { SAVE_WARNING_ID, clearSaveWarning, showSaveWarning } from "./saveWarning";

/** The save-failure notice on the toast rail: one notice, reworded rather than
 *  stacked, with an Export button that calls back and a Dismiss that removes it. */
describe("save-failure notice", () => {
  let rail: HTMLElement;
  beforeEach(() => {
    rail = document.createElement("div");
    rail.append(document.createElement("div"));
  });

  it("goes first on the rail with its headline, text and buttons", () => {
    showSaveWarning(rail, "Storage is blocked.", vi.fn());
    const box = rail.firstElementChild as HTMLElement;
    expect(box.id).toBe(SAVE_WARNING_ID);
    expect(box.classList.contains("toast--sticky")).toBe(true);
    expect(box.getAttribute("role")).toBe("alert");
    expect(box.querySelector(".save-warning-title")?.textContent).toBe("Your tower isn't being saved");
    expect(box.querySelector(".save-warning-text")?.textContent).toBe("Storage is blocked.");
    expect([...box.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Export tower…", "Dismiss"]);
  });

  it("rewords the notice already up instead of adding a second", () => {
    showSaveWarning(rail, "first", vi.fn());
    showSaveWarning(rail, "second", vi.fn());
    expect(rail.querySelectorAll(`#${SAVE_WARNING_ID}`)).toHaveLength(1);
    expect(rail.querySelector(".save-warning-text")?.textContent).toBe("second");
  });

  it("keeps markup in the text as text", () => {
    showSaveWarning(rail, "<b>bold</b>", vi.fn());
    expect(rail.querySelector(".save-warning-text b")).toBeNull();
    expect(rail.querySelector(".save-warning-text")?.textContent).toBe("<b>bold</b>");
  });

  it("calls the export back and stays up, and Dismiss takes it down", () => {
    const onExport = vi.fn();
    showSaveWarning(rail, "text", onExport);
    rail.querySelector<HTMLButtonElement>('[data-act="export"]')?.click();
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(rail.querySelector(`#${SAVE_WARNING_ID}`)).not.toBeNull();
    rail.querySelector<HTMLButtonElement>('[data-act="dismiss"]')?.click();
    expect(rail.querySelector(`#${SAVE_WARNING_ID}`)).toBeNull();
  });

  it("clears only the notice", () => {
    showSaveWarning(rail, "text", vi.fn());
    clearSaveWarning(rail);
    expect(rail.querySelector(`#${SAVE_WARNING_ID}`)).toBeNull();
    expect(rail.children).toHaveLength(1);
    clearSaveWarning(rail); // nothing up: no throw
  });
});
