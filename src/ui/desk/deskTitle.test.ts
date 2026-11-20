import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../analyticsActions", () => ({ trackAppAction: vi.fn(), trackAppActionOnce: vi.fn() }));

import { trackAppAction, trackAppActionOnce } from "../../analyticsActions";
import { DESK_TITLE_CLASS, DeskTitle } from "./deskTitle";

beforeEach(() => {
  document.body.innerHTML = `<div id="splash"><button class="splash-btn">Open</button><button class="splash-btn primary">New</button></div><button id="btn-about">About</button><button id="mb-close" hidden>Close</button>`;
  document.body.className = "";
  vi.mocked(trackAppAction).mockClear();
  vi.mocked(trackAppActionOnce).mockClear();
});

describe("DeskTitle", () => {
  it("puts the title screen in a Verticopolis window with its own taskbar, once", () => {
    const title = new DeskTitle(document);
    title.show();
    title.show();
    expect(title.up).toBe(true);
    expect(document.body.classList.contains(DESK_TITLE_CLASS)).toBe(true);
    expect(document.querySelectorAll(".desk-title-bar")).toHaveLength(1);
    expect(document.querySelectorAll(".desk-taskbar-title")).toHaveLength(1);
    expect([...document.querySelectorAll(".desk-task")].map((b) => b.textContent)).toEqual(["Verticopolis"]);
    // The title screen has no Control Panel.
    expect(document.querySelector(".desk-tray-display")).toBeNull();
    title.hide();
  });

  it("focuses the title screen's first button from its taskbar button", () => {
    const title = new DeskTitle(document);
    title.show();
    document.querySelector<HTMLElement>(".desk-task")!.click();
    expect(document.activeElement).toBe(document.querySelector("#splash .primary"));
    title.hide();
  });

  it("runs a Verticopolis menu item and counts it", () => {
    const title = new DeskTitle(document);
    title.show();
    const about = vi.fn();
    document.getElementById("btn-about")!.addEventListener("click", about);
    document.querySelector<HTMLElement>('.desk-start-menu [data-item="btn-about"]')!.click();
    expect(about).toHaveBeenCalledTimes(1);
    expect(trackAppAction).toHaveBeenCalledWith("desk_start", "btn-about");
    title.hide();
  });

  it("leaves Close Verticopolis out of its menu, since the title screen has no tower to close", () => {
    const title = new DeskTitle(document);
    title.show();
    document.querySelector<HTMLElement>(".desk-start")!.click();
    const close = document.querySelector<HTMLElement>('.desk-start-menu [data-item="mb-close"]')!;
    expect(close.hidden).toBe(true);
    // Nor does the menu end on the separator that stood above it.
    expect(close.previousElementSibling!.tagName).toBe("HR");
    expect((close.previousElementSibling as HTMLElement).hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('.desk-start-menu [data-item="btn-about"]')!.hidden).toBe(false);
    // The arrow keys skip it: up from the first item wraps to the last one shown.
    document
      .getElementById("desk-start-menu")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(document.activeElement).not.toBe(close);
    expect((document.activeElement as HTMLElement).dataset.item).toBe("btn-about");
    title.hide();
  });

  it("takes the window and the taskbar away again", () => {
    const title = new DeskTitle(document);
    title.hide();
    title.show();
    title.hide();
    expect(title.up).toBe(false);
    expect(document.body.classList.contains(DESK_TITLE_CLASS)).toBe(false);
    expect(document.querySelector(".desk-title-bar")).toBeNull();
    expect(document.querySelector(".desk-taskbar-title")).toBeNull();
  });
});

describe("DeskTitle analytics", () => {
  it("counts the title window showing once, its taskbar button, the Verticopolis menu opening and the tray's sound", () => {
    const title = new DeskTitle(document);
    title.show();
    expect(trackAppActionOnce).toHaveBeenCalledWith("desk_title_shown");
    document.querySelector<HTMLElement>(".desk-task")!.click();
    expect(trackAppAction).toHaveBeenCalledWith("desk_task", "title_front");
    document.querySelector<HTMLElement>(".desk-start")!.click();
    expect(trackAppAction).toHaveBeenCalledWith("desk_start_open", "title");
    document.querySelector<HTMLElement>(".desk-tray-sound")!.click();
    expect(trackAppAction).toHaveBeenCalledWith("desk_tray", "sound");
    title.hide();
  });
});
