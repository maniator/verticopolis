import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { render, type TemplateResult } from "lit-html";
import { showDesktopAnalyticsNotice, wireDesktopAnalyticsToggle } from "./uiDesktopAnalytics";
import { settingsTemplate } from "./templates/settings";
import { renderToFragment, change } from "./testing/litTestUtils";
import type { ModalOpts } from "./modalPrecedence";
import { gameplaySession, startGameplaySession } from "../analytics";
import { setAnalyticsAdapter, type AnalyticsAdapter, type EventProps } from "../analyticsAdapter";
import {
  desktopAnalyticsAllowed,
  desktopConsentState,
  heldEventCount,
  holdWhilePending,
  resetDesktopConsentForTests,
  setDesktopConsent,
} from "../desktopConsent";

/**
 * Answer the telemetry gate from the DESKTOP CONSENT rather than from the
 * hostname, which is what the live gate does for a wrapped build
 * (`telemetryHostAllowed` hands every wrapped mode to `desktopAnalyticsAllowed`).
 * Under vitest the build mode is always "test", so the unmocked gate would read
 * a hostname and the consent state could never open or shut it, which is exactly
 * the coupling the session-arming tests below are about.
 */
vi.mock("../telemetry", async (importOriginal) => {
  const real = await importOriginal<typeof import("../telemetry")>();
  const consent = await import("../desktopConsent");
  return { ...real, telemetryHostAllowed: () => consent.desktopAnalyticsAllowed("desktop") };
});

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
  host: {
    el: { modal: HTMLElement };
    openModalTemplate: (r: TemplateResult, opts?: ModalOpts) => HTMLElement;
    closeModal: () => void;
  };
  dialog: HTMLDialogElement;
  box: HTMLElement;
  closes: number;
  opened: () => number;
  opts: () => ModalOpts | undefined;
  displace: () => void;
} {
  const dialog = document.createElement("dialog");
  document.body.appendChild(dialog);
  const box = document.createElement("div");
  let opens = 0;
  let opts: ModalOpts | undefined;
  const state = { closes: 0 };
  const host = {
    el: { modal: dialog as HTMLElement },
    openModalTemplate: (r: TemplateResult, o?: ModalOpts): HTMLElement => {
      opens++;
      opts = o;
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
    opts: () => opts,
    // What another opener does to the incumbent: the shared dialog's contents
    // are replaced and the incumbent's goodbye runs (`ModalPrecedence.opening`).
    displace: (): void => {
      dialog.replaceChildren();
      opts?.onDisplaced?.();
    },
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
    // player answers, and answering yes does not cost them the run-up to it.
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

  it("records nothing when the notice never mounted into the shared dialog", () => {
    // A host that hands back a box it did not mount stands in for an open that
    // did not take. Both overrides GRANT, so installing them against a dialog
    // the notice is not inside would record a yes for a question nobody saw.
    const dialog = document.createElement("dialog");
    document.body.appendChild(dialog);
    const orphan = document.createElement("div");
    let closes = 0;
    showDesktopAnalyticsNotice(
      {
        el: { modal: dialog as HTMLElement },
        openModalTemplate: (): HTMLElement => orphan,
        closeModal: (): void => void closes++,
      },
      "desktop",
    );
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    dialog.dispatchEvent(new Event("click", { bubbles: true }));
    expect(desktopConsentState(), "an unmounted notice is not an answer").toBe("pending");
    expect(closes, "and nothing was closed on its behalf either").toBe(0);
  });

  it("leaves the answer pending when another modal displaces the notice", () => {
    // `hasBlockingModal` (the emergency choice's gate in frameLoop.ts) does not
    // read the dialog, so the notice can genuinely be replaced mid-question. The
    // player saw a privacy question flash past, which is not a yes.
    const sent: string[] = [];
    const h = makeHost();
    showDesktopAnalyticsNotice(h.host, "desktop");
    holdWhilePending(() => sent.push("boot"), "desktop");
    h.displace();
    // Whatever took the dialog is dismissed: that must not answer for us.
    h.dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    h.dialog.dispatchEvent(new Event("click", { bubbles: true }));
    expect(desktopConsentState(), "the question died with the dialog; ask again next launch").toBe("pending");
    expect(sent, "and nothing may be flushed on a question that was never answered").toEqual([]);
    expect(desktopAnalyticsAllowed("desktop")).toBe(false);
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

describe("a grant starts the gameplay session boot could not", () => {
  /**
   * `bootstrap.ts` calls `startGameplaySession` once, before the notice
   * resolves, so on a first launch it meets a shut gate and attaches no
   * `pagehide` or `visibilitychange` listener. Nothing re-ran it, so the whole
   * first desktop session, the acquisition session, reported no session summary
   * at all however long the player played after saying yes. The held queue could
   * not cover for it: those events were never emitted in the first place.
   */
  const sent: { event: string; props: EventProps }[] = [];
  let restore: AnalyticsAdapter | undefined;

  beforeEach(() => {
    localStorage.clear();
    resetDesktopConsentForTests();
    document.body.replaceChildren();
    gameplaySession.reset();
    sent.length = 0;
    restore = setAnalyticsAdapter({
      send: (event, props) => void sent.push({ event, props }),
      injectPageTelemetry: () => {},
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (restore) setAnalyticsAdapter(restore);
    gameplaySession.reset();
    resetDesktopConsentForTests();
    localStorage.clear();
    document.body.replaceChildren();
  });

  it("a first launch that says yes still reports its session summary", () => {
    vi.setSystemTime(0);
    startGameplaySession(); // boot, consent pending: the gate is shut
    const h = makeHost();
    showDesktopAnalyticsNotice(h.host, "desktop");
    // The probe that makes the assertion after it mean something: had boot
    // armed the listeners, this page-hide would report a four second session.
    vi.setSystemTime(4000);
    window.dispatchEvent(new Event("pagehide"));
    expect(sent, "a pending first run is dark, its session listeners included").toEqual([]);
    h.box.querySelector<HTMLButtonElement>('[data-act="accept"]')!.click();
    vi.setSystemTime(7000);
    window.dispatchEvent(new Event("pagehide"));
    expect(sent, "the session that follows the yes has to end somewhere").toEqual([
      { event: "session_end", props: { seconds: 3 } },
    ]);
  });

  it("turning it back on from Settings arms the session too", () => {
    setDesktopConsent("declined");
    startGameplaySession(); // a declined launch is just as unarmed
    const box = document.createElement("div");
    box.appendChild(renderToFragment(settingsTemplate("1.2.3", false, true)));
    wireDesktopAnalyticsToggle(box, true);
    change(box.querySelector<HTMLInputElement>("#set-analytics")!);
    expect(desktopConsentState()).toBe("granted");
    // `arm` is the claim `startGameplaySession` stakes before wiring its
    // listeners: true once, false forever after. False here means the grant
    // already took it, so the listeners are attached.
    expect(gameplaySession.arm(), "the Settings grant must have armed the session").toBe(false);
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
