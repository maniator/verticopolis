import type { GameApp } from "../main";
import type { FacilityKind } from "@verticopolis/components/shared/types";
import type { SimView } from "@verticopolis/components/port/view";
import { trackAppAction } from "../analytics";
import { holdTowerFrames } from "@verticopolis/components/render/excalibur/frameHold";
import { reducedMotionActive } from "../storage/Prefs";
import { groupDigits } from "@verticopolis/components/windows/format";
import { openScreenSaverDialog } from "../ui/screenSaver/saverDialog";
import { NO_SAVER, loadSaverPrefs, saveSaverPrefs, type SaverId, type SaverPrefs } from "../ui/screenSaver/saverPrefs";
import type { SaverScene } from "../ui/screenSaver/saverScene";
import { WINDOW } from "../ui/screenSaver/saverScene";
import { showScreenSaver } from "../ui/screenSaver/screenSaver";
import { bulletinMarquee, expressElevators, skylineStarfield } from "../ui/screenSaver/skyScenes";
import { endlessTower, nightShift, type TowerSnapshot } from "../ui/screenSaver/towerScenes";
import { watchForSaver, type SaverTrigger } from "../ui/screenSaver/saverTriggers";
import { isDialogOpen, isEngineStopped, isSplashUp } from "./interactionState";

/**
 * The screen saver in the game (party 2026-11-15): Options > Screen Saver…,
 * the idle and return triggers, and the tower paused while it is up and set
 * back to its speed after. The tower's renderer stops drawing while the saver
 * covers it (`holdTowerFrames`), so a running saver costs only its own small
 * canvas.
 *
 * Night Shift and Bulletin Marquee read the tower once, when the saver
 * starts (`towerSnapshot`, `marqueeLines`); nothing here reads the engine
 * while the saver is down.
 */

/** The menu item that opens the dialog. */
export const SCREEN_SAVER_ITEM_ID = "mb-screensaver";

/** How long a saver was up, as a coarse bucket for analytics. */
export function shownBucket(ms: number): "under_1m" | "1_5m" | "over_5m" {
  if (ms < 60_000) return "under_1m";
  if (ms < 300_000) return "1_5m";
  return "over_5m";
}

const HOME_KINDS: ReadonlySet<FacilityKind> = new Set<FacilityKind>(["condo", "rentalStudio", "rentalApartment"]);
const HOTEL_KINDS: ReadonlySet<FacilityKind> = new Set<FacilityKind>(["hotelSingle", "hotelDouble", "hotelSuite"]);
const ELEVATOR_KINDS: ReadonlySet<FacilityKind> = new Set<FacilityKind>([
  "elevatorStandard",
  "elevatorService",
  "elevatorExpress",
]);

/** The window color a room's kind lights. */
export function windowColor(kind: FacilityKind): string {
  if (kind === "office") return WINDOW.office;
  if (HOME_KINDS.has(kind)) return WINDOW.home;
  if (HOTEL_KINDS.has(kind)) return WINDOW.hotel;
  return WINDOW.shop;
}

/** The tower above ground as Night Shift draws it, read once from the view.
 *  A room is lit when someone is in it. */
export function towerSnapshot(view: Pick<SimView, "rooms" | "structure" | "tower">): TowerSnapshot {
  return {
    structure: view.structure
      .filter((r) => r.floor >= 0)
      .map((r) => ({ floor: r.floor, x: r.x, width: r.width * r.count })),
    rooms: view.rooms
      .filter((r) => r.floor >= 0)
      .map((r) => ({
        floor: r.floor,
        x: r.x,
        width: r.width,
        color: windowColor(r.kind),
        lit: r.state === "occupied" || r.state === "moving_in",
      })),
    shafts: view.tower.transports
      .filter((t) => ELEVATOR_KINDS.has(t.kind) && t.top >= 0)
      .map((t) => ({ x: t.x, width: t.width, bottom: Math.max(0, t.bottom), top: t.top })),
  };
}

/** The marquee's lines: the tower's name and how it stands, in whole
 *  sentences. */
export function marqueeLines(view: Pick<SimView, "header" | "tower">): string[] {
  const h = view.header;
  const name = view.tower.towerName.trim() || "Your tower";
  const rating = h.star >= 6 ? "has the TOWER rating" : `is rated ${h.star} ${h.star === 1 ? "star" : "stars"}`;
  let people = `${groupDigits(h.population)} people live, work or play here.`;
  if (h.population === 0) people = "Nobody lives, works or plays here yet.";
  if (h.population === 1) people = "1 person lives, works or plays here.";
  const money = Math.round(h.money);
  const funds = `Funds on hand: ${money < 0 ? "-" : ""}$${groupDigits(Math.abs(money))}.`;
  return [`${name} ${rating}.`, people, funds, "Thanks for building with Verticopolis."];
}

/** A canvas a scene paints once and copies each frame (null when the page
 *  cannot make one; the scene then paints each frame itself). */
const newLayer = (): CanvasRenderingContext2D | null => document.createElement("canvas").getContext("2d");

/** Wire the screen saver once. */
export function wireScreenSaver(app: GameApp): void {
  const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  let prefs: SaverPrefs = loadSaverPrefs(touch);
  let up = false;
  const still = () => reducedMotionActive(app.prefs, app.reduceMq.matches);

  const makeScene = (id: SaverId, w: number, h: number): SaverScene => {
    switch (id) {
      case "night":
        return nightShift(w, h, towerSnapshot(app.reader), Math.random, newLayer);
      case "stars":
        return skylineStarfield(w, h);
      case "express":
        return expressElevators(w, h);
      case "endless":
        return endlessTower(w, h, Math.random, newLayer);
      case "marquee":
        return bulletinMarquee(w, h, marqueeLines(app.reader));
    }
  };

  const show = (trigger: SaverTrigger, id: SaverId, after?: () => void) => {
    if (up) return;
    up = true;
    const before = app.getSpeed();
    if (before !== 0) app.setSpeed(0);
    trackAppAction("screensaver_start", trigger);
    let releaseFrames = () => {};
    showScreenSaver({
      makeScene: (w, h) => makeScene(id, w, h),
      still: still(),
      onEnd: (ms) => {
        up = false;
        releaseFrames();
        // Set the tower back going only if nothing else changed its speed.
        if (before !== 0 && app.getSpeed() === 0) app.setSpeed(before);
        trackAppAction("screensaver_end", shownBucket(ms));
        watch.touched();
        after?.();
      },
    });
    // The saver is on the page now and covers the tower: stop drawing it.
    if (up) releaseFrames = holdTowerFrames(() => app.engine);
  };

  const watch = watchForSaver({
    prefs: () => prefs,
    canShow: () =>
      !up &&
      navigator.webdriver !== true &&
      !isDialogOpen() &&
      !isSplashUp() &&
      !isEngineStopped() &&
      !app.reader.header.pendingChoice &&
      !app.reader.header.bombSearch,
    paused: () => app.getSpeed() === 0,
    start: (trigger) => {
      if (prefs.saver !== NO_SAVER) show(trigger, prefs.saver);
    },
  });

  document.getElementById(SCREEN_SAVER_ITEM_ID)?.addEventListener("click", () =>
    openScreenSaverDialog(app.ui, prefs, {
      makeScene,
      still,
      save: (p) => {
        prefs = p;
        saveSaverPrefs(p);
        trackAppAction("screensaver_set", p.saver);
        watch.touched();
      },
      preview: (id, back) => show("preview", id, back),
    }),
  );
}
