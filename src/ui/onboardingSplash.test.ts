import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { OnboardingController } from "./Onboarding";

const STYLES_CSS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "styles.css");

/**
 * Splash-mute contract (SPEC-splash-mute, `_bmad-output/specs/spec-splash-mute/`):
 * the splash renders a mute toggle from its first frame (CAP-1) as a second
 * view of the ONE persisted master mute (CAP-2). These drive the REAL
 * showSplash against happy-dom; the persisted-silent-boot half (CAP-3) is
 * pinned at the facade in audioFacade.test.ts and at the command in
 * audioPrefs.test.ts (glyph agreement).
 */

function makeController() {
  const opts = {
    mq: { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList,
    showHelp: vi.fn(),
    pauseForSplash: vi.fn(),
    chime: vi.fn(),
    setMusicProgram: vi.fn(),
  };
  return { ctl: new OnboardingController(opts), opts };
}

function mountSplash(o: {
  hasSave?: boolean;
  muted?: boolean;
  onToggleMute?: () => boolean;
  installOffered?: boolean;
  onInstall?: () => void;
  founder?: boolean;
}) {
  const { ctl } = makeController();
  ctl.showSplash({
    hasSave: o.hasSave ?? false,
    onContinue: vi.fn(),
    onLoadTower: vi.fn(), onNewTower: vi.fn(),
    muted: () => o.muted ?? false,
    onToggleMute: o.onToggleMute,
    installOffered: o.installOffered === undefined ? undefined : () => o.installOffered!,
    onInstall: o.onInstall,
    founder: o.founder === undefined ? undefined : () => o.founder!,
  });
  return document.getElementById("splash")!;
}

afterEach(() => {
  document.getElementById("splash")?.remove();
  document.body.innerHTML = "";
});

/**
 * The Load Tower action (SPEC-splash-load-tower CAP-1). The picker it opens is
 * pinned in `./templates/towerPicker.test.ts`; the dismissal contract lives in
 * the onboarding integration tests.
 */
describe("splash Load Tower action (SPEC-splash-load-tower CAP-1)", () => {
  const order = (el: HTMLElement) =>
    Array.from(el.querySelectorAll<HTMLElement>(".splash-actions button")).map((b) =>
      b.getAttribute("data-splash"),
    );

  it("renders for a returning player, between Continue and New Tower", () => {
    // New Tower sits AFTER it because New Tower is the only action here that
    // can cost the player something, so it stays furthest from the default
    // focus and from the Esc/backdrop safe dismiss.
    expect(order(mountSplash({ hasSave: true }))).toEqual(["continue", "load", "new", "help"]);
  });

  it("renders on a first run too, when there is nothing saved yet", () => {
    // Not gated on hasSave: hasSave reads the autosave keys alone, so it says
    // nothing about the manual slots, and the picker's file row is how a fresh
    // install or a new device gets its towers back.
    expect(order(mountSplash({ hasSave: false }))).toEqual(["load", "new", "help"]);
  });

  it("never takes the primary plate, in either state", () => {
    // Exactly one amber plate is on screen at a time: Continue when a save
    // exists, New Tower when none does. Two would leave no default.
    for (const hasSave of [true, false]) {
      const el = mountSplash({ hasSave });
      expect(el.querySelector('[data-splash="load"]')!.classList.contains("primary")).toBe(false);
      expect(el.querySelectorAll(".splash-actions .primary")).toHaveLength(1);
      el.remove();
    }
  });

  it("does not steal the trap's initial focus from Continue or New Tower", () => {
    expect(document.activeElement?.getAttribute("data-splash")).not.toBe("load");
    mountSplash({ hasSave: true });
    expect(document.activeElement?.getAttribute("data-splash")).toBe("continue");
  });
});

describe("splash mute toggle (CAP-1)", () => {
  it("renders the corner toggle with unmuted state and does not steal initial focus", () => {
    const el = mountSplash({});
    const btn = el.querySelector<HTMLButtonElement>('button.splash-mute[data-splash="mute"]');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe("🔊");
    expect(btn!.getAttribute("aria-pressed")).toBe("false");
    expect(btn!.getAttribute("aria-label")).toBe("Mute sound");
    // Initial focus belongs to the action stack (New Tower on a first run),
    // never the corner toggle.
    expect(document.activeElement?.getAttribute("data-splash")).toBe("new");
  });

  it("mounts already-muted for a returning player who muted last session", () => {
    const el = mountSplash({ muted: true });
    const btn = el.querySelector<HTMLButtonElement>('[data-splash="mute"]')!;
    expect(btn.textContent).toBe("🔇");
    // Toggle-button pattern: the name is STABLE; aria-pressed carries state.
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.getAttribute("aria-label")).toBe("Mute sound");
  });

  it("carries a comfortable touch target: the .splash-mute rule floors both dimensions at >= 44px (CAP-1)", () => {
    // happy-dom applies no stylesheet, so read the shipped CSS rule directly:
    // the 44px WCAG floor is the spec requirement, and no unit DOM can measure
    // layout. Pins the rule against a future value trim below the floor.
    const css = readFileSync(STYLES_CSS, "utf8");
    const rule = css.match(/\.splash-mute\s*\{([^}]*)\}/)?.[1] ?? "";
    const px = (prop: string) => Number(rule.match(new RegExp(`${prop}\\s*:\\s*(\\d+)px`))?.[1] ?? "0");
    expect(px("min-width")).toBeGreaterThanOrEqual(44);
    expect(px("min-height")).toBeGreaterThanOrEqual(44);
  });

  it("joins the focus trap's button cycle, LAST in reading order (title -> actions -> utility)", () => {
    const el = mountSplash({ hasSave: true });
    const items = Array.from(el.querySelectorAll<HTMLElement>("button:not([disabled])"));
    // Rendered last so AT reads the primary actions before the corner utility.
    expect(items[items.length - 1].getAttribute("data-splash")).toBe("mute");
    // Tab from the last button (mute) wraps to the first (the trap's own logic).
    items[items.length - 1].focus();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items[0]);
    expect(items[0].getAttribute("data-splash")).not.toBe("mute");
  });
});

describe("splash mute binding (CAP-2)", () => {
  it("clicking drives the shared toggle and mirrors the returned state onto the button", () => {
    let muted = false;
    const onToggleMute = vi.fn(() => {
      muted = !muted;
      return muted;
    });
    const el = mountSplash({ onToggleMute });
    const btn = el.querySelector<HTMLButtonElement>('[data-splash="mute"]')!;

    btn.click();
    expect(onToggleMute).toHaveBeenCalledTimes(1);
    expect(btn.textContent).toBe("🔇");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    // The name never changes across states (toggle-button pattern).
    expect(btn.getAttribute("aria-label")).toBe("Mute sound");

    btn.click();
    expect(onToggleMute).toHaveBeenCalledTimes(2);
    expect(btn.textContent).toBe("🔊");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    expect(btn.getAttribute("aria-label")).toBe("Mute sound");
  });

  it("clicking the toggle never dismisses the splash", () => {
    const el = mountSplash({ onToggleMute: () => true });
    el.querySelector<HTMLButtonElement>('[data-splash="mute"]')!.click();
    expect(document.getElementById("splash")).not.toBeNull();
  });

  it("does not wire a lying click when no toggle handler is given (button stays truthful)", () => {
    // A caller that supplies muted but omits onToggleMute must not get a button
    // that flips its glyph while the real audio state is unchanged: no handler,
    // no flip (Edge Case Hunter, round 1).
    const el = mountSplash({ muted: true }); // onToggleMute omitted
    const btn = el.querySelector<HTMLButtonElement>('[data-splash="mute"]')!;
    btn.click();
    expect(btn.textContent).toBe("🔇"); // unchanged: never lied
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("splash install button (SPEC-pwa-install CAP-5)", () => {
  it("renders the persistent install button when offered, with outcome copy and a stable name", () => {
    const el = mountSplash({ installOffered: true, onInstall: vi.fn() });
    const btn = el.querySelector<HTMLButtonElement>('button.splash-install[data-splash="install"]');
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("aria-label")).toBe("Install Verticopolis");
    // A visible "Install" label, not a lone glyph: recognizable on the wide splash.
    expect(btn!.textContent).toMatch(/Install/);
    // Copy promises an outcome, never "one-tap" or the word PWA (CAP-5 constraint).
    const title = btn!.getAttribute("title") ?? "";
    expect(title).toMatch(/offline/i);
    expect(title).not.toMatch(/one[- ]tap|pwa/i);
  });

  it("omits the install button for a standalone session (not offered)", () => {
    const el = mountSplash({ installOffered: false, onInstall: vi.fn() });
    expect(el.querySelector('[data-splash="install"]')).toBeNull();
  });

  it("omits the install button when no handler is bound, even if offered (never an inert button)", () => {
    const el = mountSplash({ installOffered: true }); // onInstall omitted
    expect(el.querySelector('[data-splash="install"]')).toBeNull();
  });

  it("clicking drives the shared activation and keeps the splash mounted", () => {
    const onInstall = vi.fn();
    const el = mountSplash({ installOffered: true, onInstall });
    el.querySelector<HTMLButtonElement>('[data-splash="install"]')!.click();
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(document.getElementById("splash")).not.toBeNull(); // stacks over, never dismisses
  });

  it("renders after the mute so the utility cluster sits at the tail of the Tab order", () => {
    const el = mountSplash({ hasSave: true, installOffered: true, onInstall: vi.fn() });
    const items = Array.from(el.querySelectorAll<HTMLElement>("button:not([disabled])"));
    expect(items[items.length - 1].getAttribute("data-splash")).toBe("install");
    expect(items[items.length - 2].getAttribute("data-splash")).toBe("mute");
  });

  it("carries a comfortable touch target: the .splash-install rule floors both dimensions at >= 44px", () => {
    const css = readFileSync(STYLES_CSS, "utf8");
    const rule = css.match(/\.splash-install\s*\{([^}]*)\}/)?.[1] ?? "";
    const px = (prop: string) => Number(rule.match(new RegExp(`${prop}\\s*:\\s*(\\d+)px`))?.[1] ?? "0");
    expect(px("min-width")).toBeGreaterThanOrEqual(44);
    expect(px("min-height")).toBeGreaterThanOrEqual(44);
  });
});

describe("splash Ground floor badge (2.0 upgrade recognition)", () => {
  it("shows the badge for a Founder", () => {
    const el = mountSplash({ founder: true });
    const badge = el.querySelector(".splash-founder");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toMatch(/Ground floor/);
  });

  it("hides the badge for a non-founder (new user)", () => {
    const el = mountSplash({ founder: false });
    expect(el.querySelector(".splash-founder")).toBeNull();
  });

  it("hides the badge when no founder check is supplied (default off)", () => {
    const el = mountSplash({});
    expect(el.querySelector(".splash-founder")).toBeNull();
  });
});
