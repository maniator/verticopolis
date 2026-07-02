import type { Simulation } from "../engine/Simulation";

/**
 * First-run experience — splash/title screen + a non-blocking "Getting Started"
 * checklist with device-aware hints. Pure DOM chrome: it READS the simulation to
 * detect real progress but never mutates it (no engine coupling, no new save
 * state), preserving the diegesis split. Once-only, skippable, re-openable from
 * Help. See the design docs under _bmad-output/planning-artifacts/design/.
 */

const FLAG = "tt.onboarded";
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

export function isOnboarded(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}
export function markOnboarded(): void {
  try {
    localStorage.setItem(FLAG, "1");
  } catch {
    /* private-mode / disabled storage — onboarding just re-shows, harmless */
  }
}
export function clearOnboarded(): void {
  try {
    localStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
}

export interface OnboardStep {
  id: string;
  title: string;
  sub: string;
  hintDesktop: string;
  hintMobile: string;
  /** CSS selector(s) for the control(s) to pulse while this step is active. */
  pulse: string;
  /** True once the player has genuinely done this — read from live sim state. */
  done: (sim: Simulation) => boolean;
}

/** The four steps: empty-ish lot (a ground lobby is pre-seeded) → first office
 *  earning rent. Advance on real game state, not scripted clicks. */
export const ONBOARD_STEPS: OnboardStep[] = [
  {
    id: "floor",
    title: "Add a floor",
    sub: "Every room needs a floor under it. Lay one just above your lobby.",
    hintDesktop: "Pick Floor in the palette, then drag across the row above your lobby. (To pan, use the Inspect tool or hold Space.)",
    hintMobile: "Tap Floor, then tap the row just above your lobby to lay floor tiles.",
    pulse: '.pal-item[data-kind="floor"]',
    done: (sim) => sim.tower.units.some((u) => u.kind === "floor" && u.floor >= 2),
  },
  {
    id: "office",
    title: "Lease an office",
    sub: "Offices pay the rent. Drop one on your new floor.",
    hintDesktop: "Pick Office, then click your new floor to place it.",
    hintMobile: "Tap Office, then tap your new floor to place it.",
    pulse: '.pal-item[data-kind="office"]',
    done: (sim) => sim.tower.units.some((u) => u.kind === "office"),
  },
  {
    id: "connect",
    title: "Connect it",
    sub: "No one can reach a floor without transport. Run a stairway or elevator down to the ground lobby.",
    hintDesktop:
      "Pick Standard Elevator and drag vertically from the lobby to your office's floor — or pick Stairway and just click the lobby (a flight always links two floors).",
    hintMobile:
      "Tap Elevator, then touch-and-drag vertically to size the shaft — or tap Stairway once on the lobby (a flight always links two floors).",
    pulse: '.pal-item[data-kind="elevatorStandard"], .pal-item[data-kind="stairs"]',
    done: (sim) => sim.tower.units.some((u) => u.kind === "office" && sim.tower.isFloorServed(u.floor)),
  },
  {
    id: "play",
    title: "Press Play & wait",
    sub: "Hit ▶ Play. A tenant moves in within a day or two — rent lands each quarter.",
    hintDesktop: "Press ▶ Play in the top bar and let time run.",
    hintMobile: "Tap ▶ Play in the top bar and let time run.",
    pulse: '#speed button[data-speed="1"]',
    done: (sim) => sim.tower.units.some((u) => u.kind === "office" && u.state === "occupied"),
  },
];

/** Index of the first not-yet-satisfied step; === ONBOARD_STEPS.length when all done. */
export function firstIncompleteStep(sim: Simulation): number {
  for (let i = 0; i < ONBOARD_STEPS.length; i++) if (!ONBOARD_STEPS[i].done(sim)) return i;
  return ONBOARD_STEPS.length;
}

/** Whether onboarding should arm now: only when the player explicitly starts a
 *  New Tower on a browser that has never completed it. */
export function shouldArm(pressedNewTower: boolean): boolean {
  return pressedNewTower && !isOnboarded();
}

const DEFAULT_HINT_DESKTOP = "Drag to pan · Scroll to zoom · Click to build · Inspect tool to edit a room";
const DEFAULT_HINT_MOBILE = "Tap to build · Drag to pan · Pinch to zoom · Tap a room to inspect";

export interface OnboardingOpts {
  mq: MediaQueryList;
  showHelp: () => void;
  /** Pause/resume the engine while the splash is up. */
  pauseForSplash: (paused: boolean) => void;
  /** A small chime on step advance (optional flourish). */
  chime: () => void;
}

export class OnboardingController {
  static isOnboarded = isOnboarded;
  static markOnboarded = markOnboarded;
  static clearOnboarded = clearOnboarded;

  private sim: Simulation | null = null;
  private active = false;
  private step = 0;
  private splashEl: HTMLElement | null = null;
  private splashKey: ((e: KeyboardEvent) => void) | null = null;
  private panelEl: HTMLElement | null = null;
  private sendOff: ReturnType<typeof setTimeout> | null = null;
  private readonly onMq = () => (this.active ? this.applyHintAndPulse() : this.setDefaultHint());

  constructor(private opts: OnboardingOpts) {
    // The controller is the single owner of the #hint bar: seed a device-aware
    // default immediately (so mobile never shows the hard-coded desktop line) and
    // keep it correct across rotate/resize. ONE listener for the controller's
    // life — no per-session add/remove to leak.
    this.setDefaultHint();
    this.opts.mq.addEventListener("change", this.onMq);
  }

  private setDefaultHint(): void {
    if (this.hintEl) this.hintEl.textContent = this.opts.mq.matches ? DEFAULT_HINT_MOBILE : DEFAULT_HINT_DESKTOP;
  }

  private get hintEl(): HTMLElement | null {
    return document.getElementById("hint");
  }

  // ---- Splash -------------------------------------------------------------

  showSplash(o: { hasSave: boolean; onContinue: () => void; onNewTower: (dismiss: () => void) => void }): void {
    this.opts.pauseForSplash(true);
    const mobile = this.opts.mq.matches;
    const el = document.createElement("div");
    el.id = "splash";
    el.className = mobile ? "splash--mobile" : "";
    // Modal-dialog semantics so screen readers treat the full-screen overlay as
    // a modal surface (like the in-game <dialog id="modal">).
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Verticopolis — start a game");
    const premise = mobile
      ? "Raise a high-rise floor by floor and climb to the TOWER."
      : "Raise a living high-rise floor by floor — lease offices, open shops, run hotels, and thread the elevators that keep the city moving. Climb from 1★ to the legendary TOWER.";
    const continueBtn = o.hasSave
      ? `<button class="splash-btn primary" data-splash="continue">▶ Continue</button>`
      : "";
    // "Metropolis Dusk" title screen: an art-deco skyline + setting sun under an
    // indigo→coral dusk sky, with the Verticopolis wordmark. The wordmark/tagline
    // are SVG <text> with `textLength` so they always fit any screen (no clipping,
    // no web-font download — offline-safe for the PWA).
    el.innerHTML =
      `<div class="splash-stars" aria-hidden="true"></div>` +
      `<div class="splash-sun" aria-hidden="true"></div>` +
      `<svg class="splash-skyline" aria-hidden="true" viewBox="0 0 460 200" preserveAspectRatio="xMidYMax slice">` +
      `<g fill="#201643" stroke="#0d0d10" stroke-width="1">` +
      `<path d="M-5 200 V120 h34 V98 h16 V120 h40 V200 z"/>` +
      `<path d="M95 200 V80 h26 V56 h12 V80 h26 V200 z"/>` +
      `<path d="M200 200 V54 h20 V30 h9 V10 h9 V30 h9 V54 h20 V200 z"/>` +
      `<path d="M310 200 V92 h30 V68 h15 V92 h30 V200 z"/>` +
      `<path d="M410 200 V60 h20 V36 h11 V60 h34 V200 z"/>` +
      `</g>` +
      `<g fill="#ffdca0">` +
      `<rect x="8" y="130" width="3" height="4"/><rect x="8" y="146" width="3" height="4"/>` +
      `<rect x="104" y="92" width="3" height="4"/><rect x="104" y="112" width="3" height="4"/>` +
      `<rect x="214" y="66" width="3" height="4"/><rect x="214" y="90" width="3" height="4"/>` +
      `<rect x="320" y="100" width="3" height="4"/><rect x="424" y="72" width="3" height="4"/>` +
      `</g></svg>` +
      `<div class="splash-brand">` +
      `<svg class="splash-word" viewBox="0 0 400 66" role="img" aria-label="Verticopolis">` +
      `<text x="200" y="52" text-anchor="middle" textLength="392" lengthAdjust="spacingAndGlyphs">` +
      `<tspan class="a">VERTICO</tspan><tspan class="b">POLIS</tspan></text></svg>` +
      `<svg class="splash-tag" viewBox="0 0 360 20" role="img" aria-label="the vertical metropolis">` +
      `<text x="180" y="15" text-anchor="middle" textLength="330" lengthAdjust="spacingAndGlyphs">THE VERTICAL METROPOLIS</text></svg>` +
      `<p class="splash-premise">${premise}</p>` +
      `</div>` +
      `<div class="splash-actions">` +
      continueBtn +
      `<button class="splash-btn ${o.hasSave ? "" : "primary"}" data-splash="new">＋ New Tower</button>` +
      `<button class="splash-btn ghost" data-splash="help">？ How to Play</button>` +
      `</div>` +
      `<p class="splash-attrib">An unofficial, from-scratch homage to SimTower (1994). Original code and art — no ripped assets. Not affiliated with or endorsed by Maxis / OPeNBooK / Vivarium.</p>` +
      `<p class="splash-version">v${APP_VERSION}</p>`;
    document.body.appendChild(el);
    this.splashEl = el;

    const q = (sel: string) => el.querySelector<HTMLElement>(sel);
    q('[data-splash="continue"]')?.addEventListener("click", () => {
      this.teardownSplash();
      o.onContinue();
    });
    q('[data-splash="new"]')?.addEventListener("click", () => {
      // Keep the splash mounted + the engine paused; the host dismisses only
      // once the (possibly-confirmed) new game is actually starting, so a
      // cancelled confirmation leaves the title screen in place and time frozen.
      o.onNewTower(() => this.teardownSplash());
    });
    // Help stacks over the splash (its own modal); the splash stays behind it.
    q('[data-splash="help"]')?.addEventListener("click", () => this.opts.showHelp());
    // Move initial focus into the overlay, then TRAP Tab within it so keyboard
    // users can't reach the game behind the modal (its buttons are the only
    // focusable controls, so Tab just cycles among them).
    (q('[data-splash="continue"]') ?? q('[data-splash="new"]'))?.focus();
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const items = Array.from(el.querySelectorAll<HTMLElement>("button:not([disabled])"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!el.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Esc / backdrop resolve to the SAFE default: Continue if a save exists,
    // otherwise no-op (New Tower must be an explicit press so intent is never
    // wiped). Backdrop = a click on the overlay outside the card.
    const safeDismiss = () => {
      if (!o.hasSave) return;
      this.teardownSplash();
      o.onContinue();
    };
    el.addEventListener("click", (e) => {
      if (e.target === el) safeDismiss();
    });
    this.splashKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") safeDismiss();
    };
    document.addEventListener("keydown", this.splashKey);
  }

  private teardownSplash(): void {
    if (this.splashKey) document.removeEventListener("keydown", this.splashKey);
    this.splashKey = null;
    this.splashEl?.remove();
    this.splashEl = null;
    this.opts.pauseForSplash(false);
  }

  // ---- Checklist / onboarding --------------------------------------------

  /** Begin (or resume) onboarding on `sim`. Idempotent — tears down any live
   *  session first so a re-arm (e.g. Replay) can't stack panels. No-ops (returns
   *  false) if already onboarded or if there's nothing left to teach. */
  arm(sim: Simulation): boolean {
    if (isOnboarded()) return false;
    this.clearSession(); // re-entrancy guard: never leave a second panel behind
    this.sim = sim;
    this.step = firstIncompleteStep(sim);
    if (this.step >= ONBOARD_STEPS.length) {
      // Nothing left to teach (e.g. replay on an already-built tower).
      markOnboarded();
      this.setDefaultHint();
      return false;
    }
    this.active = true;
    this.mountPanel();
    this.render();
    this.applyHintAndPulse();
    return true;
  }

  /** Called from the host's throttled update loop (~6 Hz). Advances on real progress. */
  tick(): void {
    if (!this.active || !this.sim) return;
    const s = firstIncompleteStep(this.sim);
    if (s === this.step) return;
    this.step = s;
    this.opts.chime();
    if (s >= ONBOARD_STEPS.length) {
      this.finish();
      return;
    }
    this.render();
    this.applyHintAndPulse();
  }

  private mountPanel(): void {
    const el = document.createElement("div");
    el.id = "onboard";
    el.className = `win${this.opts.mq.matches ? " onboard--mobile" : ""}`;
    document.body.appendChild(el);
    this.panelEl = el;
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).dataset.onboard === "skip") this.dismiss();
    });
  }

  private render(): void {
    if (!this.panelEl) return;
    const items = ONBOARD_STEPS.map((st, i) => {
      const state = i < this.step ? "done" : i === this.step ? "cur" : "todo";
      const mark = state === "done" ? "✓" : i === this.step ? "▸" : "·";
      return (
        `<li class="ob-step ob-${state}"><span class="ob-mark">${mark}</span>` +
        `<span class="ob-text"><b>${st.title}</b>${i === this.step ? `<span class="ob-sub">${st.sub}</span>` : ""}</span></li>`
      );
    }).join("");
    this.panelEl.innerHTML =
      `<div class="win-title">Getting Started<button class="btn xs" data-onboard="skip">Skip</button></div>` +
      `<ol class="ob-list">${items}</ol>`;
  }

  private applyHintAndPulse(): void {
    const st = ONBOARD_STEPS[this.step];
    if (!st) return;
    if (this.hintEl) this.hintEl.textContent = this.opts.mq.matches ? st.hintMobile : st.hintDesktop;
    document.querySelectorAll(".tt-pulse").forEach((n) => n.classList.remove("tt-pulse"));
    document.querySelectorAll(st.pulse).forEach((n) => n.classList.add("tt-pulse"));
  }

  private finish(): void {
    markOnboarded();
    this.active = false;
    document.querySelectorAll(".tt-pulse").forEach((n) => n.classList.remove("tt-pulse"));
    this.setDefaultHint();
    if (this.panelEl) {
      this.panelEl.innerHTML = `<div class="win-title">Nice — you're a landlord.</div><p class="ob-sendoff">The rest is in Help (？). Build up!</p>`;
      this.panelEl.addEventListener("click", () => this.clearSession(), { once: true });
    }
    if (this.sendOff) clearTimeout(this.sendOff);
    this.sendOff = setTimeout(() => this.clearSession(), 6000);
  }

  /** Skip / early-dismiss — marks done so it never nags again. */
  private dismiss(): void {
    markOnboarded();
    this.clearSession();
  }

  /** Tear down a live onboarding session (panel + pulse + timer), leaving the
   *  persistent hint listener in place. Safe to call when nothing is mounted. */
  private clearSession(): void {
    if (this.sendOff) clearTimeout(this.sendOff);
    this.sendOff = null;
    this.active = false;
    this.panelEl?.remove();
    this.panelEl = null;
    document.querySelectorAll(".tt-pulse").forEach((n) => n.classList.remove("tt-pulse"));
    this.setDefaultHint();
  }
}
