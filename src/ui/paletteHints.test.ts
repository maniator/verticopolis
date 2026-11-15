import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { descriptionId, wirePaletteHints } from "./paletteHints";

/** A Tools window with one facility button, and the status bar's two cells. */
beforeEach(() => {
  document.body.innerHTML = `
    <div id="pal">
      <div class="pal-item" id="office" tabindex="0" aria-describedby="${descriptionId("office")}">
        <span class="pal-name">Office</span><span class="pal-desc" id="${descriptionId("office")}" hidden>Rents to a company.</span>
      </div>
      <div id="gap"></div>
    </div>
    <div id="sb-hint" hidden></div><div id="tool-info">Lobby</div>`;
  wirePaletteHints(document.getElementById("pal")!);
});
afterEach(() => {
  document.body.innerHTML = "";
});

const $ = (id: string) => document.getElementById(id)!;
const pointer = (type: string, target: HTMLElement, pointerType: string, relatedTarget: Element | null = null) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, relatedTarget }));

describe("the Tools window's status bar help", () => {
  it("names the tool under the mouse and says what it does, then gives the cell back on leave", () => {
    pointer("pointerover", $("office").querySelector(".pal-name")!, "mouse");
    expect($("sb-hint").hidden).toBe(false);
    expect($("sb-hint").textContent).toBe("Office: Rents to a company.");
    pointer("pointerout", $("office"), "mouse", $("office").querySelector(".pal-name"));
    expect($("sb-hint").hidden).toBe(false); // still inside the same button
    pointer("pointerout", $("office"), "mouse", $("gap"));
    expect($("sb-hint").hidden).toBe(true);
  });

  it("follows the keyboard focus the same way, and ignores a finger", () => {
    $("office").focus();
    expect($("sb-hint").textContent).toBe("Office: Rents to a company.");
    $("office").blur();
    expect($("sb-hint").hidden).toBe(true);
    pointer("pointerover", $("office"), "touch");
    expect($("sb-hint").hidden).toBe(true);
  });

  it("points each button's accessible description at its text", () => {
    const id = $("office").getAttribute("aria-describedby")!;
    expect(document.getElementById(id)!.textContent).toBe("Rents to a company.");
  });
});
