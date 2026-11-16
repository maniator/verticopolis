import { afterEach, describe, expect, it } from "vitest";
import { GRAPHICS_RECOVERY_ID, showGraphicsRecovery } from "./graphicsRecovery";
import { isRecoveringGraphics } from "../game/interactionState";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the graphics-recovery card (#321)", () => {
  it("holds the page as a modal dialog until the recovery ends, and Esc cannot close it", () => {
    const end = showGraphicsRecovery();
    const card = document.getElementById(GRAPHICS_RECOVERY_ID) as HTMLDialogElement;
    expect(card.tagName).toBe("DIALOG");
    expect(card.open).toBe(true);
    expect(card.textContent).toContain("Recovering graphics");
    expect(isRecoveringGraphics()).toBe(true);
    const esc = new Event("cancel", { cancelable: true });
    card.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    end();
    expect(document.getElementById(GRAPHICS_RECOVERY_ID)).toBeNull();
    expect(isRecoveringGraphics()).toBe(false);
  });

  it("over the title screen it speaks of the saved towers, not a tower in play", () => {
    const end = showGraphicsRecovery(true);
    const text = document.getElementById(GRAPHICS_RECOVERY_ID)?.textContent ?? "";
    expect(text).toContain("Your saved towers are untouched.");
    expect(text).not.toContain("Your tower is safe.");
    end();
    showGraphicsRecovery();
    expect(document.getElementById(GRAPHICS_RECOVERY_ID)?.textContent).toContain("Your tower is safe.");
  });

  it("keeps one card when a second loss puts it up again", () => {
    showGraphicsRecovery();
    const end = showGraphicsRecovery();
    expect(document.querySelectorAll(`#${GRAPHICS_RECOVERY_ID}`)).toHaveLength(1);
    end();
    expect(isRecoveringGraphics()).toBe(false);
  });
});
