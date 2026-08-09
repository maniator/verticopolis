import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { render, type TemplateResult } from "lit-html";
import { showDesktopAnalyticsNotice, wireDesktopAnalyticsToggle } from "./uiDesktopAnalytics";
import { settingsTemplate } from "./templates/settings";
import { renderToFragment, change } from "./testing/litTestUtils";
import {
  desktopAnalyticsAllowed,
  desktopConsentState,
  heldEventCount,
  holdWhilePending,
  resetDesktopConsentForTests,
  setDesktopConsent,
} from "../desktopConsent";

/**
 * The two desktop consent surfaces (issue #781): the first-run notice and the
 * Settings switch.
 *
 * `DesktopConsentHost` is structural, so the notice drives against a three-member
 * fake rather than a live `UI`. The fake's `el.modal` is a REAL `<dialog>`, so
 * the dismissal paths (backdrop click, the cancel event the title-bar x and Esc
 * both dispatch) are exercised for real rather than simulated.
 */
function makeHost(): {
  host: { el: { modal: HTMLElement }; openModalTemplate: (r: TemplateResult) => HTMLElement; closeModal: () => void };
  dialog: HTMLDialogElement;
  box: HTMLElement;
  closes: number;
  opened: () => number;
} {
  const dialog = document.createElement("dialog");
  document.body.appendChild(dialog);
  const box = document.createElement("div");
  let opens = 0;
  const state = { closes: 0 };
  const host = {
    el: { modal: dialog as HTMLElement },
    openModalTemplate: (r: TemplateResult): HTMLElement => {
      opens++;
      dialog.appendChild(box);
      render(r, box);
      return box;
    },
    closeModal: (): void => {
      state.closes++;
    },
  };
  return {
    host,
    dialog,
    box,
    get closes() {
      return state.closes;
    },
    opened: () => opens,
  };
}

describe("showDesktopAnalyticsNotice", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDesktopConsentForTests();
    document.body.replaceChildren();
  });
  afterEach(() => {
    resetDesktopConsentForTests();
    localStorage.clear();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("opens on a pending desktop build", () => {
    const h = makeHost();
    showDesktopAnalyticsNotice(h.host, "desktop");
    expect(h.opened()).toBe(1);
    expect(h.box.querySelector('[data-act="accept"]')).not.toBeNull();
    expect(h.box.querySelector('[data-act="decline"]')).not.toBeNull();
  });

  it("opens on no other build, whatever the stored state", () => {
    for (const mode of ["production", "development", "test", "native"]) {
      const h = makeHost();
      showDesktopAnalyticsNotice(h.host, mode);
      expect(h.opened(), `${mode} must not be asked`).toBe(0);
    }
  });

  it("opens once and never again, on either answer", () => {
    for (const act of ["accept", "decline"]) {
      resetDesktopConsentForTests();
      localStorage.clear();
      const first = makeHost();
      showDesktopAnalyticsNotice(first.host, "desktop");
      first.box.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!.click();
      const second = makeHost();
      showDesktopAnalyticsNotice(second.host, "desktop");
      expect(second.opened(), `an answered ${act} must not be asked again`).toBe(0);
    }
  });

  it("emits NOTHING before the notice resolves, then flushes in order on accept", () => {
    // The whole point of the first-run hold: a desktop session is dark until the
    // player answers, and answering yes does not cost them the boot snapshot.
    const sent: string[] = [];
    const h = makeHost();
    showDesktopAnalyticsNotice(h.host, "desktop");
    for (const name of ["boot", "game_started", "first_build"]) {
      holdWhilePending(() => sent.push(name), "desktop");
    }
    expect(sent, "nothing may leave while the notice is open").toEqual([]);
    expect(desktopAnalyticsAllowed("desktop"), "and the gate is shut too").toBe(false);
    expect(heldEventCount()).toBe(3);
    h.box.querySelector<HTMLButtonElement>('[data-act="accept"]')!.click();
    expect(desktopConsentState()).toBe("granted");
    expect(sent).toEqual(["boot", "game_started", "first_build"]);
  });

  it("discards everything held when the player says No thanks", () => {
    const sent: string[] = [];
    const h = makeHost();
    showDesktopAnalyticsNotice(h.host, "desktop");
    holdWhilePending(() => sent.push("boot"), "desktop");
    h.box.querySelector<HTMLButtonElement>('[data-act="decline"]')!.click();
    expect(desktopConsentState()).toBe("declined");
    expect(sent).toEqual([]);
    expect(heldEventCount()).toBe(0);
    expect(desktopAnalyticsAllowed("desktop")).toBe(false);
  });

  it("grants when the notice is dismissed by the backdrop", () => {
    const h = makeHost();
    showDesktopAnalyticsNotice(h.host, "desktop");
    h.dialog.dispatchEvent(new Event("click", { bubbles: true })); // target IS the dialog
    expect(desktopConsentState()).toBe("granted");
  });

  it("grants when the notice is dismissed by Esc or the title-bar x", () => {
    // The x dispatches the same cancel event Esc does (see finishModal), so one
    // override covers both.
    const h = makeHost();
    showDesktopAnalyticsNotice(h.host, "desktop");
    h.dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(desktopConsentState()).toBe("granted");
  });

  it("records the answer exactly once however many times it is dismissed", () => {
    const sent: string[] = [];
    const h = makeHost();
    showDesktopAnalyticsNotice(h.host, "desktop");
    holdWhilePending(() => sent.push("boot"), "desktop");
    h.box.querySelector<HTMLButtonElement>('[data-act="accept"]')!.click();
    h.dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    h.box.querySelector<HTMLButtonElement>('[data-act="decline"]')!.click();
    expect(desktopConsentState(), "a later decline must not overturn the recorded answer").toBe("granted");
    expect(sent, "and the queue must not flush twice").toEqual(["boot"]);
    expect(h.closes, "the modal is closed once").toBe(1);
  });
});

describe("wireDesktopAnalyticsToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDesktopConsentForTests();
  });
  afterEach(() => {
    resetDesktopConsentForTests();
    localStorage.clear();
  });

  /** The real Settings body, rendered with the desktop row on. */
  function openSettings(): HTMLInputElement {
    const frag = renderToFragment(settingsTemplate("1.2.3", false, true));
    const box = document.createElement("div");
    box.appendChild(frag);
    wireDesktopAnalyticsToggle(box, true);
    return box.querySelector<HTMLInputElement>("#set-analytics")!;
  }

  it("shows the live state on open", () => {
    setDesktopConsent("granted");
    expect(openSettings().checked).toBe(true);
    setDesktopConsent("declined");
    expect(openSettings().checked).toBe(false);
  });

  it("turns telemetry off on the very next gate call, with no reload", () => {
    setDesktopConsent("granted");
    const sw = openSettings();
    expect(desktopAnalyticsAllowed("desktop")).toBe(true);
    change(sw);
    expect(desktopAnalyticsAllowed("desktop"), "off must bite immediately").toBe(false);
    expect(sw.checked).toBe(false);
  });

  it("turns it back on, and re-reads the callback's return rather than the checkbox", () => {
    setDesktopConsent("declined");
    const sw = openSettings();
    change(sw);
    expect(desktopAnalyticsAllowed("desktop")).toBe(true);
    expect(sw.checked, "the switch shows what the toggle RETURNED").toBe(true);
  });

  it("survives a reload: the answer is read back from storage", () => {
    const sw = openSettings();
    change(sw); // pending reads as off, so this grants
    expect(desktopConsentState()).toBe("granted");
    // A relaunch: the module memo is gone, storage is not.
    const stored = localStorage.getItem("vc.desktop-analytics");
    resetDesktopConsentForTests();
    if (stored !== null) localStorage.setItem("vc.desktop-analytics", stored);
    expect(desktopAnalyticsAllowed("desktop"), "the answer must outlive the session").toBe(true);
    expect(openSettings().checked).toBe(true);
  });

  it("wires nothing when the row was not rendered", () => {
    const box = document.createElement("div");
    box.appendChild(renderToFragment(settingsTemplate("1.2.3")));
    expect(() => wireDesktopAnalyticsToggle(box, false)).not.toThrow();
    expect(box.querySelector("#set-analytics")).toBeNull();
  });
});

describe("the surfaces are actually reached, checked in the source", () => {
  // Both call sites sit behind `IS_DESKTOP_BUILD`, which folds to false under
  // vitest, so neither can be driven from here: a boot flow that never opens the
  // notice, or a Settings dialog that never wires the switch, would leave every
  // test above green while no desktop player was ever asked anything. The same
  // technique platform.test.ts and analyticsEnrichment.test.ts use.
  const HERE = dirname(fileURLToPath(import.meta.url));

  it("the boot flow opens the notice, behind the desktop build gate", () => {
    const source = readFileSync(resolve(HERE, "../game/appBoot.ts"), "utf8");
    expect(source, "the source file could not be read, so this test proves nothing").toContain("runBootFlow");
    expect(source).toContain("if (IS_DESKTOP_BUILD) showDesktopAnalyticsNotice(app.ui);");
  });

  it("the Settings dialog renders and wires the switch, behind the same gate", () => {
    const source = readFileSync(resolve(HERE, "./uiSettings.ts"), "utf8");
    expect(source, "the source file could not be read, so this test proves nothing").toContain("showSettings");
    expect(source, "the row must be rendered for a desktop build").toContain(
      "settingsTemplate(version, modern, IS_DESKTOP_BUILD)",
    );
    expect(source, "and wired with the same flag it was rendered with").toContain(
      "wireDesktopAnalyticsToggle(box, IS_DESKTOP_BUILD)",
    );
  });
});
