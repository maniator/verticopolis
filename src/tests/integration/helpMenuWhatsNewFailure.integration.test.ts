// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountAppDom, makeUI } from "../uiFixture";

/**
 * What's new when its notes chunk fails to load (src/ui/uiHelpMenu.ts): the
 * menu stays up with the pause held and says so in the menu. A file of its
 * own because the notes module is mocked to fail for every test here.
 */

vi.mock("../../ui/standalone", () => ({ isInstalledStandalone: () => false }));
vi.mock("../../whatsNewData", () => {
  throw new Error("chunk failed to load");
});

describe("What's new that cannot load", () => {
  beforeEach(() => mountAppDom());
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("keeps the menu open and the tower paused, and says it could not load", async () => {
    let speed = 2;
    const { cb } = makeUI({ getSpeed: () => speed, onSpeed: vi.fn((s: number) => (speed = s)) });
    (document.getElementById("btn-about") as HTMLButtonElement).click();
    const dialog = document.getElementById("modal") as HTMLDialogElement;
    dialog.querySelector<HTMLButtonElement>('[data-act="whats-new"]')!.click();
    await vi.waitFor(() => expect(dialog.textContent).toContain("What's new could not load. Try again in a moment."));
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[data-act="whats-new"]')).not.toBeNull();
    expect(speed).toBe(0);
    dialog.querySelector<HTMLButtonElement>('[data-act="close"]')!.click();
    expect(speed).toBe(2);
    expect(cb.onSpeed).toHaveBeenCalledTimes(2);
  });
});
