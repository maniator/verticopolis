/**
 * The 4.0 launch fireworks: a short, one-time celebration the first time a
 * player opens version 4 or any later build (owner, 2026-11-14: every
 * release from 4.0 on, for good). Presentation only; nothing
 * here touches the tower or the engine.
 *
 * It plays until the player closes it, then never again on that browser
 * profile, latched in localStorage like the Founder welcome (`src/founder.ts`).
 * Only a close the player makes sets the latch (OK, the ✕, Escape or a click on
 * the backdrop; owner, 2026-11-14): a reload, a closed tab, or another dialog
 * replacing the welcome leaves it unset, so the next load shows it again. When
 * storage is blocked it never plays, because without the latch it would replay
 * on every boot. Browser automation
 * (`navigator.webdriver`: the e2e suites, the screenshot gallery, the visual
 * baselines) never sees it, so a release branch renders the same pixels as
 * `main`. `?debug=fireworks` plays it anywhere, any version, without touching
 * the latch, so it can be previewed.
 *
 * The show: pixel fireworks (a low-resolution canvas scaled up without
 * smoothing, the 1990s look) behind the game's own modal, which carries the
 * welcome and a few first-time help links (`src/ui/templates/welcome.ts`).
 * The fireworks end on their own; the window never closes by itself (owner
 * and the player panel, 2026-11-14,
 * `_bmad-output/party-mode/welcome-window-close-party-findings-2026-11-14.md`)
 * and closes as every dialog does: OK, its ✕, Escape, or a click on the
 * backdrop. With reduced motion on, one still frame of bursts and nothing
 * animates.
 */

import { APP_VERSION } from "../appVersion";
import { PREVIEW_DEPLOY } from "../deployTarget";
import { DEBUG_FLAG, debugFlagOn } from "../debugFlags";
import type { TemplateResult } from "lit-html";
import { WELCOME_LINKS, welcomeModalTemplate } from "./templates/welcome";
import { trackAppAction } from "../analytics";

/** The localStorage latch, set once the player has closed the welcome here. */
export const LAUNCH_FIREWORKS_SEEN_KEY = "vc-launch-fireworks-4";
/** The first major version the celebration plays on; every later one plays it too. */
export const LAUNCH_FIREWORKS_FROM_MAJOR = 4;
/** New rockets go up only during this opening stretch, so the sky clears
 *  before the window closes. */
export const LAUNCH_WINDOW_MS = 5_500;
/** One canvas pixel is this many CSS pixels: the chunky 1990s pixel. */
export const PIXEL = 4;
/** Live sparks never exceed this, however long a frame stalls. */
export const MAX_SPARKS = 480;
/** Sparks per burst. */
export const SPARKS_PER_BURST = 40;
/** Gravity, in canvas pixels per second squared. */
const GRAVITY = 42;
/** Time between rockets, in milliseconds. */
const LAUNCH_EVERY_MS = 300;
/** A frame step never exceeds this, so a stalled tab does not jump. */
const MAX_STEP_S = 0.05;

/** The burst colors: the splash's amber and cream plus four period brights. */
export const FIREWORK_COLORS = ["#ffc94a", "#e6dcc0", "#ff5050", "#50e0ff", "#ff6ad5", "#7cff6a"] as const;

/** The major number of a version string, or NaN for "dev" and the like. */
export function majorOf(version: string): number {
  return Number.parseInt(version.split(".")[0] ?? "", 10);
}

/** Where the decision to play comes from. */
export interface LaunchFireworksGate {
  /** The build's version (`APP_VERSION`). */
  version: string;
  /** True under browser automation (`navigator.webdriver`). */
  automated: boolean;
  /** True when `?debug=fireworks` asks for a preview. */
  forced: boolean;
  /** True on a Vercel preview deployment. A preview still carries the last
   *  released version (the release PR raises it), so there the show plays
   *  whatever the version, latched as usual. */
  previewDeploy: boolean;
  /** The profile's storage; a getter that throws counts as blocked. */
  storage: () => Pick<Storage, "getItem">;
}

/**
 * Whether the celebration plays on this boot. A forced preview always plays.
 * Otherwise it plays only on version 4 or later (or any build on a preview
 * deployment, whose version is not raised yet), never under automation, and
 * only while the latch is unset. It only reads the latch: closing the welcome
 * sets it ({@link latchLaunchFireworks}), so a boot that ends before the
 * player closes it plays again next time.
 */
export function shouldPlayLaunchFireworks(gate: LaunchFireworksGate): boolean {
  if (gate.forced) return true;
  if (gate.automated) return false;
  if (!gate.previewDeploy && !(majorOf(gate.version) >= LAUNCH_FIREWORKS_FROM_MAJOR)) return false; // NaN (a dev build) fails too
  try {
    return gate.storage().getItem(LAUNCH_FIREWORKS_SEEN_KEY) !== "1";
  } catch {
    return false; // storage blocked: it would replay on every boot, so skip it
  }
}

/** Set the latch, so the welcome never plays again on this profile. Called
 *  when the player closes it; a storage failure only means it plays again. */
export function latchLaunchFireworks(storage: () => Pick<Storage, "setItem">): void {
  try {
    storage().setItem(LAUNCH_FIREWORKS_SEEN_KEY, "1");
  } catch {
    /* it shows once more next boot, which is harmless */
  }
}

/** A rocket on its way up. */
interface Rocket {
  x: number;
  y: number;
  vy: number;
  /** The height it bursts at. */
  burstY: number;
  color: string;
}

/** One spark of a burst. */
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds left; it starts near 1.4. */
  life: number;
  color: string;
}

/** The whole sky at one moment. */
export interface Sky {
  width: number;
  height: number;
  /** Milliseconds since the show began. */
  elapsedMs: number;
  /** Milliseconds since the last rocket went up. */
  sinceLaunchMs: number;
  rockets: Rocket[];
  sparks: Spark[];
}

/** An empty sky of `width` by `height` canvas pixels, ready for the first rocket. */
export function newSky(width: number, height: number): Sky {
  return { width, height, elapsedMs: 0, sinceLaunchMs: LAUNCH_EVERY_MS, rockets: [], sparks: [] };
}

/** Add one burst of sparks at (x, y), up to {@link MAX_SPARKS} live. */
export function burst(sky: Sky, x: number, y: number, color: string, rand: () => number): void {
  const room = Math.min(SPARKS_PER_BURST, MAX_SPARKS - sky.sparks.length);
  const speed = Math.min(sky.width, sky.height) * 0.3;
  for (let i = 0; i < room; i++) {
    const angle = (i / SPARKS_PER_BURST) * Math.PI * 2;
    // A spread of speeds fills the burst in, a chrysanthemum rather than a ring.
    const v = speed * (0.3 + rand() * 0.7);
    sky.sparks.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, life: 1.1 + rand() * 0.4, color });
  }
}

/**
 * Advance the sky by `dtMs` (clamped, so a stalled tab does not jump): launch
 * a rocket on schedule during the launch window, lift rockets until they
 * burst, and age, move and drop sparks. The work per frame is bounded by
 * {@link MAX_SPARKS} and the few rockets in the air.
 */
export function stepSky(sky: Sky, dtMs: number, rand: () => number): void {
  const dt = Math.min(dtMs / 1000, MAX_STEP_S);
  sky.elapsedMs += dt * 1000;
  sky.sinceLaunchMs += dt * 1000;
  if (sky.elapsedMs <= LAUNCH_WINDOW_MS && sky.sinceLaunchMs >= LAUNCH_EVERY_MS) {
    sky.sinceLaunchMs = 0;
    sky.rockets.push({
      x: sky.width * (0.15 + rand() * 0.7),
      y: sky.height,
      vy: -sky.height * (0.85 + rand() * 0.2),
      burstY: sky.height * (0.15 + rand() * 0.35),
      color: FIREWORK_COLORS[Math.floor(rand() * FIREWORK_COLORS.length)] ?? FIREWORK_COLORS[0],
    });
  }
  // Both lists compact in place (a write index), so a frame allocates only
  // the sparks a burst adds.
  let keptRockets = 0;
  for (const r of sky.rockets) {
    r.y += r.vy * dt;
    if (r.y <= r.burstY) burst(sky, r.x, r.y, r.color, rand);
    else sky.rockets[keptRockets++] = r;
  }
  sky.rockets.length = keptRockets;
  let keptSparks = 0;
  for (const s of sky.sparks) {
    s.life -= dt;
    if (s.life <= 0) continue;
    s.vy += GRAVITY * dt;
    s.vx *= 0.985;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    sky.sparks[keptSparks++] = s;
  }
  sky.sparks.length = keptSparks;
}

/** A small fixed-seed generator, so the still frame is the same every time. */
function steadyRand(seed: number): () => number {
  let state = seed * 2_654_435_761;
  return () => {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** The still frame reduced motion shows: four bursts, laid out by hand. */
export function stillSky(width: number, height: number): Sky {
  const sky = newSky(width, height);
  const spots: Array<[number, number]> = [[0.2, 0.3], [0.45, 0.18], [0.7, 0.32], [0.86, 0.16]];
  spots.forEach(([fx, fy], i) => {
    const color = FIREWORK_COLORS[i % FIREWORK_COLORS.length] ?? FIREWORK_COLORS[0];
    burst(sky, width * fx, height * fy, color, steadyRand(i + 1));
  });
  // Spread each burst into its ring, as it looks a moment after it pops.
  for (const s of sky.sparks) {
    s.x += s.vx * 0.35;
    s.y += s.vy * 0.35;
  }
  return sky;
}

/** Paint the sky: one canvas pixel per spark (a dim trail pixel behind each
 *  rocket), fading to half strength as the spark dies. */
export function drawSky(ctx: CanvasRenderingContext2D, sky: Sky): void {
  ctx.clearRect(0, 0, sky.width, sky.height);
  for (const r of sky.rockets) {
    ctx.fillStyle = r.color;
    ctx.fillRect(Math.round(r.x), Math.round(r.y), 1, 2);
  }
  for (const s of sky.sparks) {
    ctx.globalAlpha = s.life > 0.5 ? 1 : 0.5;
    ctx.fillStyle = s.color;
    ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
  }
  ctx.globalAlpha = 1;
}

/** The two modal primitives of `UI` the welcome opens through, so it wears
 *  the same window grammar as every other dialog (title bar, ✕, Escape, a
 *  click on the backdrop, the OK button). */
export interface WelcomeModalPort {
  openModalTemplate(result: TemplateResult, opts?: { displaceable?: boolean; onDisplaced?: () => void }): HTMLElement;
  wireActions(box: HTMLElement): void;
}

/** What the show needs from the page, injectable for tests. */
export interface ShowDeps {
  ui: WelcomeModalPort;
  reducedMotion: boolean;
  /** Runs once when the player closes the welcome themselves (OK, the ✕,
   *  Escape or the backdrop), never when another dialog replaces it. */
  onClosed?: () => void;
  rand?: () => number;
  raf?: (cb: FrameRequestCallback) => number;
}

/**
 * Open the welcome in the shared modal and set the fireworks off behind it.
 * The window is the game's own dialog (`welcomeModalTemplate`), so it closes
 * the way every dialog does and never by itself (owner and the player panel,
 * 2026-11-14). The fireworks canvas sits inside the dialog element, under its
 * box and over its dimmed backdrop, so closing the dialog (which empties it)
 * takes the fireworks with it; the frame loop stops when its canvas leaves
 * the page or the sky empties.
 *
 * Every one of the player's closes goes through the dialog's `close` event
 * (`UI.closeModal`), while a dialog that replaces the welcome swaps the
 * content of a dialog that stays open and reports it through `onDisplaced`.
 * So `onClosed` runs on a `close` unless the welcome was displaced first.
 */
/** The welcome's analytics: `welcome_shown` now, then one `welcome_close`
 *  naming how it closed (OK, the ✕, Escape or a backdrop click; a
 *  displacement reports itself), and a `welcome_link` per help link. Returns
 *  the call that stops listening. */
function trackWelcome(dialog: HTMLDialogElement): () => void {
  trackAppAction("welcome_shown");
  let how = "other";
  const onClick = (e: MouseEvent) => {
    if (e.target === dialog) how = "backdrop";
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest("[data-act='close']")) how = "ok";
    const href = el?.closest("a")?.getAttribute("href") ?? "";
    if (href.startsWith(WELCOME_LINKS.firstTower.href)) trackAppAction("welcome_link", "first_tower");
    else if (href.startsWith(WELCOME_LINKS.modes.href)) trackAppAction("welcome_link", "modes");
    else if (href.startsWith(WELCOME_LINKS.whatsNew.href)) trackAppAction("welcome_link", "whats_new");
  };
  // Escape reaches the dialog as a keydown, then its cancel; the ✕ sends a
  // cancel alone.
  let escape = false;
  const onKey = (e: KeyboardEvent) => {
    escape = e.key === "Escape";
  };
  const onCancel = () => {
    how = escape ? "escape" : "x";
  };
  const onClose = () => {
    stop();
    trackAppAction("welcome_close", how);
  };
  // The dialog element outlives the welcome when another dialog displaces
  // it, so a displacement stops listening at once.
  const stop = () => {
    dialog.removeEventListener("click", onClick, true);
    dialog.removeEventListener("keydown", onKey, true);
    dialog.removeEventListener("cancel", onCancel, true);
    dialog.removeEventListener("close", onClose);
  };
  dialog.addEventListener("click", onClick, true);
  dialog.addEventListener("keydown", onKey, true);
  dialog.addEventListener("cancel", onCancel, true);
  dialog.addEventListener("close", onClose);
  return stop;
}

export function showLaunchFireworks(deps: ShowDeps): void {
  const rand = deps.rand ?? Math.random;
  const raf = deps.raf ?? ((cb: FrameRequestCallback) => requestAnimationFrame(cb));
  let displaced = false;
  let stopTracking = (): void => {};
  const box = deps.ui.openModalTemplate(welcomeModalTemplate(), {
    displaceable: true,
    onDisplaced: () => {
      displaced = true;
      stopTracking();
      trackAppAction("welcome_close", "displaced");
    },
  });
  deps.ui.wireActions(box);
  const dialog = box.closest("dialog");
  if (!dialog) return;
  stopTracking = trackWelcome(dialog);
  const onClosed = deps.onClosed;
  if (onClosed) dialog.addEventListener("close", () => !displaced && onClosed(), { once: true });

  const canvas = document.createElement("canvas");
  canvas.className = "launch-fireworks-sky";
  canvas.setAttribute("aria-hidden", "true");
  const width = Math.max(1, Math.ceil(window.innerWidth / PIXEL));
  const height = Math.max(1, Math.ceil(window.innerHeight / PIXEL));
  canvas.width = width;
  canvas.height = height;
  dialog.prepend(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  if (deps.reducedMotion) {
    drawSky(ctx, stillSky(width, height));
    return;
  }
  const sky = newSky(width, height);
  let last = -1;
  const tick = (now: number): void => {
    if (!canvas.isConnected) return; // the dialog closed and took the canvas
    stepSky(sky, last < 0 ? 0 : now - last, rand);
    last = now;
    drawSky(ctx, sky);
    // Once the last spark is gone the sky stays empty, so the loop stops.
    const done = sky.elapsedMs > LAUNCH_WINDOW_MS && !sky.rockets.length && !sky.sparks.length;
    if (!done) raf(tick);
  };
  raf(tick);
}

/**
 * The boot's one call: play the show when {@link shouldPlayLaunchFireworks}
 * says so for this build, page and profile. `reducedMotion` is read only when
 * the show plays. Closing the welcome sets the latch, except for a forced
 * preview, which never touches it. A boot that could not read the player's
 * save skips it, leaving the latch for a later boot. Reads the page once;
 * never throws.
 */
export function maybeLaunchFireworks(ui: WelcomeModalPort, reducedMotion: () => boolean, saveWasUnreadable = false): void {
  // Never on top of the unreadable-save warning; a later boot plays it.
  if (saveWasUnreadable) return;
  try {
    const forced = debugFlagOn(location.search, DEBUG_FLAG.fireworks);
    const storage = () => localStorage;
    const play = shouldPlayLaunchFireworks({
      version: APP_VERSION,
      automated: navigator.webdriver === true,
      forced,
      previewDeploy: PREVIEW_DEPLOY,
      storage,
    });
    if (!play) return;
    const onClosed = forced ? undefined : () => latchLaunchFireworks(storage);
    showLaunchFireworks({ ui, reducedMotion: reducedMotion(), onClosed });
  } catch {
    /* a celebration must never break boot */
  }
}
