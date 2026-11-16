import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../analyticsActions", () => ({ trackAppAction: vi.fn() }));

import { trackAppAction } from "../analyticsActions";
import { reportTitlePick, titlePickOf, wireTitlePicks } from "./titlePicks";

beforeEach(() => {
  document.body.innerHTML = `
    <div id="splash">
      <button data-splash="continue">Continue</button>
      <button data-splash="load"><svg></svg>Open Tower…</button>
      <button data-splash="new">New Tower</button>
      <button data-splash="help">How to Play</button>
      <button data-splash="mute">Mute</button>
      <button data-splash="install">Install</button>
      <a data-splash="sponsor" href="#">Sponsor</a>
    </div>
    <button id="elsewhere" data-splash="new">Not the title screen</button>`;
  delete document.body.dataset.titlePicks;
  vi.mocked(trackAppAction).mockClear();
});

const at = (code: string) => document.querySelector(`#splash [data-splash="${code}"]`)!;

describe("title screen button picks", () => {
  it("names each title-screen button by its own code", () => {
    expect(titlePickOf(at("load"))).toBe("open");
    expect(titlePickOf(at("load").querySelector("svg"))).toBe("open");
    expect(titlePickOf(at("new"))).toBe("new");
    expect(titlePickOf(at("help"))).toBe("help");
    expect(titlePickOf(at("mute"))).toBe("mute");
    expect(titlePickOf(at("install"))).toBe("install");
    expect(titlePickOf(at("sponsor"))).toBe("sponsor");
  });

  it("leaves Continue to the title screen, and ignores buttons outside it", () => {
    expect(titlePickOf(at("continue"))).toBeNull();
    expect(titlePickOf(document.getElementById("elsewhere"))).toBeNull();
    expect(titlePickOf(null)).toBeNull();
  });

  it("reports a player's press and never a script's click", () => {
    reportTitlePick({ isTrusted: true, target: at("new") });
    expect(trackAppAction).toHaveBeenCalledWith("title_pick", "new");
    vi.mocked(trackAppAction).mockClear();
    reportTitlePick({ isTrusted: false, target: at("new") });
    expect(trackAppAction).not.toHaveBeenCalled();
  });

  it("listens once for the page life, and a menu's scripted click on a title button sends nothing", () => {
    const add = vi.spyOn(document, "addEventListener");
    wireTitlePicks(document);
    wireTitlePicks(document);
    expect(add.mock.calls.filter(([type]) => type === "click")).toHaveLength(1);
    add.mockRestore();
    // menuWiring presses the title screen's New Tower from a script.
    (at("new") as HTMLElement).click();
    expect(trackAppAction).not.toHaveBeenCalled();
  });
});
