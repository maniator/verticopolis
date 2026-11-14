import { html } from "lit-html";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hideToolTip, noteUndoDepth, showToolTip } from "./toolTipStrip";

beforeEach(() => {
  document.body.innerHTML = `<div id="tool-tip" hidden></div>`;
});
afterEach(() => {
  document.body.innerHTML = "";
});

const tip = () => document.getElementById("tool-tip")!;
const card = (name: string) => html`<div class="ti-name">${name}</div><p>What it does.</p>`;

describe("the phone's tool card", () => {
  it("shows the picked tool's card, and the next pick replaces it", () => {
    showToolTip(card("Office"));
    expect(tip().hidden).toBe(false);
    expect(tip().querySelector(".tt-body")!.textContent).toBe("OfficeWhat it does.");
    showToolTip(card("Condo"));
    expect(tip().querySelector(".ti-name")!.textContent).toBe("Condo");
  });

  it("folds away on the first placement: the undo depth moving from where the first pump saw it", () => {
    showToolTip(card("Office"));
    noteUndoDepth(4); // the pump after the pick
    noteUndoDepth(4);
    expect(tip().hidden).toBe(false);
    noteUndoDepth(5); // placed
    expect(tip().hidden).toBe(true);
    // A new pick starts over from that depth.
    showToolTip(card("Condo"));
    noteUndoDepth(5);
    expect(tip().hidden).toBe(false);
  });

  it("folds away from its close button, and hideToolTip folds it too", () => {
    showToolTip(card("Office"));
    tip().querySelector<HTMLButtonElement>(".tt-close")!.click();
    expect(tip().hidden).toBe(true);
    showToolTip(card("Office"));
    hideToolTip();
    expect(tip().hidden).toBe(true);
  });

  it("does nothing on a page without it", () => {
    document.body.innerHTML = "";
    expect(() => {
      showToolTip(card("Office"));
      noteUndoDepth(1);
      hideToolTip();
    }).not.toThrow();
  });
});
