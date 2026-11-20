import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { html } from "lit-html";
import { mountPage } from "../ui/testing/litTestUtils";
import { drawMenuBar, drawnBar, setMenuState } from "./menuBarHost";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

describe("setMenuState", () => {
  beforeEach(() => {
    mountPage(html`<div id="menubar-host"></div>`);
    drawMenuBar();
  });
  afterEach(() => document.body.replaceChildren());

  it("checks, grays and hides items by drawing the bar again", () => {
    setMenuState({ "mb-sound": { checked: false }, "mb-undo": { disabled: true }, "mb-replay": { hidden: true } });
    expect($("mb-sound").getAttribute("aria-checked")).toBe("false");
    expect($("mb-undo").getAttribute("aria-disabled")).toBe("true");
    expect($("mb-replay").hidden).toBe(true);
    setMenuState({ "mb-sound": { checked: true }, "mb-undo": { disabled: false }, "mb-replay": { hidden: false } });
    expect($("mb-sound").getAttribute("aria-checked")).toBe("true");
    expect($("mb-undo").hasAttribute("aria-disabled")).toBe(false);
    expect($("mb-replay").hidden).toBe(false);
  });

  it("keeps the fields a change leaves out", () => {
    setMenuState({ "mb-quick-save": { hidden: true } });
    setMenuState({ "mb-quick-save": { disabled: true } });
    expect($("mb-quick-save").hidden).toBe(true);
    expect($("mb-quick-save").getAttribute("aria-disabled")).toBe("true");
  });

  it("hides a whole menu by its title's id, and a separator or a submenu by its own", () => {
    setMenuState({
      "mb-tower": { hidden: true },
      "mb-install-sep": { hidden: false },
      "mb-recent": { disabled: true },
    });
    expect($("mb-tower").closest<HTMLElement>(".mb-menu")!.hidden).toBe(true);
    expect($("mb-install-sep").hidden).toBe(false);
    expect($("mb-recent").getAttribute("aria-disabled")).toBe("true");
  });

  it("does not run a grayed item's action, and runs it again once lit", () => {
    let runs = 0;
    drawnBar()!.actions.set("mb-rules", [() => runs++]);
    setMenuState({ "mb-rules": { disabled: true } });
    $("mb-rules").click();
    expect(runs).toBe(0);
    setMenuState({ "mb-rules": { disabled: false } });
    $("mb-rules").click();
    expect(runs).toBe(1);
  });

  it("does nothing on a page without the bar", () => {
    document.body.replaceChildren();
    expect(() => setMenuState({ "mb-sound": { checked: true } })).not.toThrow();
  });
});
