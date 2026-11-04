/**
 * The overview MAP window (#343): a small DOM window inside `#stage` with two
 * stacked canvases, the tower (repainted only when the model rebuilds) and the
 * view mark (repainted only when the camera moved), plus the Map button that
 * opens it. The world canvas never sees the window's pointers, so building,
 * panning and pinching there work the same with the window open.
 *
 * The app calls `frame()` once per rendered frame. A closed window returns at
 * once; an open one does constant work unless the tower, the theme, the box
 * or the camera changed (see `OverviewMapModel`). Everything it shows comes
 * from the view, the bound world and the camera; moves go through the
 * renderer's own clamp (`moveCamera`).
 */
import type { FacilityKind } from "../engine/types";
import { SKY_HEADROOM_FLOORS } from "../render/cameraBounds";
import type { ViewPlacement } from "../render/overviewMap/extent";
import { dragCenter, mapPointToCenter, rectContains, type MapCamera, type MapCameraCenter, type MapLayout, type MapRect, type MapWorld } from "../render/overviewMap/geometry";
import { CLASSIC_SHAFT_LINE_CSS, OverviewMapModel, type MapFrameInput, type MapViewInput } from "../render/overviewMap/model";
import { createPatternSource, paintMapMarks, type PatternSource } from "../render/overviewMap/paint";
import type { MapTheme } from "../render/overviewMap/style";
import { MAP_BACKDROP, groundShare, paintViewMark, viewMarkBand } from "../render/overviewMap/viewMark";
import { buildMapDom } from "./overviewMapDom";
import { MapKeyKeeper, PointerFocusClaim } from "./overviewMapKeys";
import { WorldPress } from "./overviewMapWorldPress";
import { cameraCenter, clientToMap, grabRect, isKeyboardClick, isPrimaryPress, keyTarget, MAP_KEY, MAP_MOUSE_TARGET_CSS, MAP_TAP_SLOP_CSS, MAP_TOUCH_TARGET_CSS, noButtonHeld, passesMapKey } from "./overviewMapInput";
import { mapStartsOpen, rememberMapOpen, type MapLayoutClass } from "./overviewMapPrefs";
import { mapSummary } from "./overviewMapText";

/** What the window draws each frame. */
export interface OverviewMapSource {
  readonly view: MapViewInput;
  readonly world: MapWorld;
  readonly theme: MapTheme;
}

/** The camera fields the window reads, filled in place each frame. */
export type MutableMapCamera = { -readonly [K in keyof MapCamera]: MapCamera[K] };

export interface OverviewMapDeps {
  /** The element the window and its button go in (`#stage`). */
  readonly stage: HTMLElement;
  /** The tower to draw, or null while there is none. */
  source(): OverviewMapSource | null;
  /** Fill `out` with the camera as the renderer holds it. */
  readCamera(out: MutableMapCamera): void;
  /** Move the camera's center at its current zoom; the renderer clamps it. */
  moveCamera(center: MapCameraCenter): void;
  /** A kind's height in floors (the catalog the view binds). */
  floorsOf(kind: FacilityKind): number;
  /** Whether the phone layout applies now. */
  isPhone(): boolean;
  /** Where the open or closed choice is kept, or null without storage. */
  readonly storage: Storage | null;
}

export { WORLD_PRESS_CLASS } from "./overviewMapWorldPress";

export { MAP_DOM_ID } from "./overviewMapDom";

/** A press on the map. Past the tap slop, one on the view mark drags the view
 *  by its travel and one elsewhere keeps the view centered under it; one that
 *  never travels is a tap that centers the view where it lifts. */
interface Press {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly onMark: boolean;
  start: { x: number; y: number };
  last: { x: number; y: number };
  /** The layout `start` and `last` are measured on; a rebuilt layout rebases
   *  both. */
  layout: MapLayout;
  traveled: boolean;
}

export class OverviewMapWindow {
  readonly root: HTMLElement;
  readonly toggle: HTMLButtonElement;
  private readonly body: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly towerCanvas: HTMLCanvasElement;
  private readonly viewCanvas: HTMLCanvasElement;
  private readonly summary: HTMLElement;
  private readonly towerCtx: CanvasRenderingContext2D | null;
  private readonly viewCtx: CanvasRenderingContext2D | null;
  private readonly patterns: PatternSource | null;
  private readonly model = new OverviewMapModel();
  private readonly cam: MutableMapCamera = { posX: 0, posY: 0, zoom: 1, viewWidth: 0, viewHeight: 0 };
  private layoutClass: MapLayoutClass;
  private open = false;
  private sizeDirty = true;
  private px = 1;
  private summaryText = "";
  private press: Press | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly worldPress: WorldPress;
  /** The last press began on the close button (see `pageUp`). */
  private closePressed = false;
  /** Touches down outside the window: while any is, a touch on the map is
   *  the other half of a world pinch and moves nothing. */
  private readonly outsideTouches = new Set<number>();
  private readonly onDocPointerDown = (e: PointerEvent) => this.pageDown(e);
  private readonly onDocPointerUp = (e: PointerEvent) => this.pageUp(e);
  private readonly keys: MapKeyKeeper;
  private readonly pointerFocus: PointerFocusClaim;
  /** The one frame input, refilled in place each frame. */
  private readonly input: { -readonly [K in keyof MapFrameInput]: MapFrameInput[K] };
  /** The page lost focus: any press or key still held was let go elsewhere. */
  private readonly onWindowBlur = () => {
    this.worldPress.set(false);
    // A press held while the page lost focus never gets its release, and
    // focus the browser restores on return is not a pointer's.
    this.press = null;
    this.pointerFocus.forget();
    this.keys.clear();
  };

  constructor(private readonly deps: OverviewMapDeps) {
    const doc = deps.stage.ownerDocument;
    const dom = buildMapDom(doc);
    this.root = dom.root;
    this.body = dom.body;
    this.closeButton = dom.close;
    this.towerCanvas = dom.towerCanvas;
    this.viewCanvas = dom.viewCanvas;
    this.summary = dom.summary;
    this.toggle = dom.toggle;
    this.worldPress = new WorldPress([this.root, this.toggle]);
    this.input = {
      view: { structure: [], rooms: [], tower: { lowestFloor: 1, highestFloor: 1, transports: [] } },
      world: { lotWidth: 1, minFloor: 0, maxFloor: 0 },
      theme: "classic",
      skyFloors: SKY_HEADROOM_FLOORS,
      boxWidth: 1,
      boxHeight: 1,
      classicShaftLine: CLASSIC_SHAFT_LINE_CSS,
      floorsOf: deps.floorsOf,
    };
    // First in the stage: positioned, it still paints over the world canvas,
    // and the inspector and editor cards after it paint over it.
    deps.stage.prepend(this.root, this.toggle);

    this.towerCtx = this.towerCanvas.getContext("2d");
    this.viewCtx = this.viewCanvas.getContext("2d");
    const ctx = this.towerCtx;
    this.patterns = ctx ? createPatternSource(() => doc.createElement("canvas"), ctx) : null;

    this.toggle.addEventListener("click", (e) => {
      this.setOpen(true, true);
      // The button hides while the map is open. A keyboard press moves focus
      // onto the map; a mouse user keeps the game's keys for the world.
      if (isKeyboardClick(e)) this.focusMap();
    });
    dom.close.addEventListener("click", (e) => this.closeFromWindow(isKeyboardClick(e)));
    this.root.addEventListener("keydown", (e) => this.onKey(e));
    this.root.addEventListener("contextmenu", (e) => e.preventDefault());
    // A mouse press never focuses the map, so a click on it leaves the game's
    // keys with the world. Buttons keep their default (a mouse close blurs the
    // close button), so their pressed look still shows in every browser.
    this.root.addEventListener("mousedown", (e) => e.target instanceof HTMLButtonElement || e.preventDefault());
    // A pinch or Ctrl+wheel over the window never zooms the page.
    this.root.addEventListener("wheel", (e) => e.ctrlKey && e.preventDefault(), { passive: false });
    this.viewCanvas.addEventListener("focus", () => {
      // A pointer press never focuses the map (a browser that focuses on a
      // canceled pointerdown, or on the tap's click, included), so the game
      // keeps its keys. Any other focus (Tab, the Map button from the
      // keyboard or assistive tech, a dialog giving focus back) stays.
      if (this.pointerFocus.claimsNow()) this.viewCanvas.blur();
      else this.summary.setAttribute("aria-live", "polite");
    });
    this.viewCanvas.addEventListener("blur", () => this.summary.setAttribute("aria-live", "off"));
    this.viewCanvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.viewCanvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.viewCanvas.addEventListener("pointerup", (e) => this.endPress(e, true));
    for (const end of ["pointercancel", "lostpointercapture"] as const) {
      this.viewCanvas.addEventListener(end, (e) => this.endPress(e, false));
    }
    doc.addEventListener("pointerdown", this.onDocPointerDown, true);
    doc.addEventListener("pointerup", this.onDocPointerUp, true);
    doc.addEventListener("pointercancel", this.onDocPointerUp, true);
    this.keys = new MapKeyKeeper(this.root);
    this.pointerFocus = new PointerFocusClaim(this.keys);
    doc.defaultView?.addEventListener("blur", this.onWindowBlur);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => (this.sizeDirty = true));
      this.resizeObserver.observe(this.body);
    }

    this.layoutClass = deps.isPhone() ? "phone" : "desktop";
    this.setOpen(mapStartsOpen(deps.storage, this.layoutClass), false);
  }

  /** Whether the window is open. */
  isOpen(): boolean {
    return this.open;
  }

  /** The layout class changed (the phone breakpoint was crossed): take that
   *  layout's stored choice, or its default. The window moves and resizes, so
   *  a press in progress ends. */
  layoutChanged(): void {
    const next: MapLayoutClass = this.deps.isPhone() ? "phone" : "desktop";
    if (next === this.layoutClass) return;
    this.layoutClass = next;
    this.press = null;
    this.sizeDirty = true;
    // A breakpoint change that opens the window hides the focused button, so
    // focus moves onto the map. Only this path does it: a click on the button
    // focuses the button first in some browsers, and a mouse user keeps the
    // game's keys.
    const toggleHadFocus = this.root.ownerDocument.activeElement === this.toggle;
    this.setOpen(mapStartsOpen(this.deps.storage, next), false);
    if (toggleHadFocus && this.open) this.focusMap();
  }

  /** Focus the map on the window's own account, ending any pointer claim. */
  private focusMap(): void {
    this.pointerFocus.forget();
    this.viewCanvas.focus({ preventScroll: true });
  }

  /** Open or close the window. `remember` stores the choice for this layout
   *  class, which only an explicit open or close does. */
  setOpen(open: boolean, remember: boolean): void {
    if (remember) rememberMapOpen(this.deps.storage, this.layoutClass, open);
    if (open === this.open && this.root.hidden === !open) return;
    // Focus inside a window about to hide goes back to the button, so it is
    // not lost to the page.
    const hadFocus = !open && this.root.contains(this.root.ownerDocument.activeElement);
    this.open = open;
    this.root.hidden = !open;
    this.toggle.hidden = open;
    this.press = null;
    // A reopened window has missed every change while it was closed.
    this.sizeDirty = true;
    this.model.reset();
    if (hadFocus) this.toggle.focus();
    if (open) this.frame();
  }

  /** Close from the window's own controls. A keyboard close (Escape, or the
   *  close button pressed from the keyboard) gives focus to the Map button; a
   *  mouse close leaves it with the page, so the next Space or Enter is the
   *  game's and never reopens the map. */
  private closeFromWindow(keyboard: boolean): void {
    this.setOpen(false, true);
    const active = this.root.ownerDocument.activeElement;
    if (keyboard) this.toggle.focus();
    else if (active === this.toggle) this.toggle.blur();
  }

  /** Bring the window up to date for this frame. Constant work unless the
   *  tower, the theme, the box or the camera changed. */
  frame(): void {
    if (!this.open) return;
    const src = this.deps.source();
    if (!src) return;
    // A ResizeObserver does not fire when only the pixel ratio changes (a
    // window dragged to another screen), so the ratio is compared each frame.
    if (this.sizeDirty || this.ratio() !== this.px) this.resize();
    const input = this.input;
    input.view = src.view;
    input.world = src.world;
    input.theme = src.theme;
    input.boxWidth = this.towerCanvas.width;
    input.boxHeight = this.towerCanvas.height;
    input.classicShaftLine = CLASSIC_SHAFT_LINE_CSS * this.px;
    const rebuilt = this.model.sync(input);
    const layout = this.model.layout;
    if (!layout) return;
    if (rebuilt) {
      if (this.towerCtx && this.patterns) paintMapMarks(this.towerCtx, layout.width, layout.height, this.model.marks, src.theme, this.patterns);
      const backdrop = MAP_BACKDROP[src.theme] ?? MAP_BACKDROP.modern;
      const ground = `${(groundShare(layout) * 100).toFixed(2)}%`;
      this.body.style.background = `linear-gradient(to bottom, ${backdrop.sky} ${ground}, ${backdrop.ground} ${ground})`;
      // The CSS keys Classic's inverting pen on this.
      this.root.dataset.mapTheme = src.theme;
    }
    this.deps.readCamera(this.cam);
    const placement = this.model.syncCamera(this.cam);
    if (placement) {
      if (this.viewCtx) paintViewMark(this.viewCtx, layout, placement, src.theme, this.px);
      this.writeSummary(mapSummary(src.view.tower, placement));
    }
  }

  /** Size both backing stores to the body's CSS box times the pixel ratio.
   *  Setting a canvas's size clears it, so it is set only when it changes. */
  private resize(): void {
    this.sizeDirty = false;
    const ratio = this.ratio();
    this.px = ratio;
    const w = Math.max(1, Math.round(this.body.clientWidth * ratio));
    const h = Math.max(1, Math.round(this.body.clientHeight * ratio));
    let cleared = false;
    for (const c of [this.towerCanvas, this.viewCanvas]) {
      if (c.width === w && c.height === h) continue;
      c.width = w;
      c.height = h;
      cleared = true;
    }
    // The pattern tiles stay valid, but cleared canvases need a full paint
    // (the new box alone would rebuild the tower and leave the view mark blank).
    if (cleared) this.model.reset();
  }

  /** The device pixel ratio, or 1 where it is missing or not a positive number. */
  private ratio(): number {
    const ratio = this.deps.stage.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  }

  /** Write the summary only when it changed, so a screen reader is not sent the
   *  same text every time the camera moves within a floor. */
  private writeSummary(text: string): void {
    if (text === this.summaryText) return;
    this.summaryText = text;
    this.summary.textContent = text;
  }

  /** The area that grabs the view: its outline, or the edge band when the view
   *  is past the edge, grown to a touch or mouse target. */
  private grabArea(layout: MapLayout, placement: ViewPlacement, touch: boolean): MapRect | null {
    const side = (touch ? MAP_TOUCH_TARGET_CSS : MAP_MOUSE_TARGET_CSS) * this.px;
    const mark = placement.outside === "none" ? placement.rect : viewMarkBand(layout, placement, this.px);
    return mark ? grabRect(mark, side) : null;
  }

  private mapPoint(e: PointerEvent): { x: number; y: number } {
    return clientToMap(this.viewCanvas.getBoundingClientRect(), this.viewCanvas, e.clientX, e.clientY);
  }

  /** Any press on the page. One outside the window and its button takes
   *  keyboard focus off the map (the world canvas cancels its presses, so the
   *  browser would leave focus here). A mouse or pen press there lets later
   *  pointers through the window and the button until it is released; a
   *  touch there makes a touch press on the map part of a world pinch. */
  private pageDown(e: PointerEvent): void {
    const target = e.target;
    if (target !== this.viewCanvas) this.pointerFocus.forget();
    // Only a mouse or pen press that started on the close button can slide
    // off it and leave it focused (see `pageUp`).
    this.closePressed = e.pointerType !== "touch" && target instanceof Node && this.closeButton.contains(target);
    if (target instanceof Node && (this.root.contains(target) || this.toggle.contains(target))) return;
    const active = this.root.ownerDocument.activeElement;
    if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
    if (e.pointerType === "touch") {
      // A primary touch starts a new gesture: any id left over from a lost
      // release is forgotten.
      if (e.isPrimary) this.outsideTouches.clear();
      this.outsideTouches.add(e.pointerId);
      this.dropStaleTouchPress(e);
    } else {
      // Any button: the world pans on the middle and right buttons too.
      this.worldPress.set(true);
    }
  }

  /** A new touch ends a map press held by another touch (a pinch's other
   *  finger, or a release that was lost); a mouse or pen drag goes on. */
  private dropStaleTouchPress(e: PointerEvent): void {
    if (this.press?.pointerType === "touch" && this.press.pointerId !== e.pointerId) this.press = null;
  }

  /** Any release or cancel on the page. A touch only ends its own count; a
   *  mouse or pen release ends a held world press. */
  private pageUp(e: PointerEvent): void {
    this.pointerFocus.released(e.pointerId);
    if (e.pointerType === "touch") {
      this.outsideTouches.delete(e.pointerId);
      return;
    }
    this.worldPress.set(false);
    // A mouse press on the close button that slid off and never clicked
    // would leave focus (and the game's keys) in the window. A real click
    // still fires after this.
    if (this.closePressed && this.root.ownerDocument.activeElement === this.closeButton) this.closeButton.blur();
    this.closePressed = false;
  }

  private onPointerDown(e: PointerEvent): void {
    this.pointerFocus.pressed(e.pointerId, e.pointerType, e.isPrimary);
    // A touch always reports the primary button; a pen's barrel or eraser
    // button, like a mouse's other buttons, is not the map's.
    if (!isPrimaryPress(e)) return;
    // A primary pointer means no other of its kind is down: a touch id, or a
    // press by another pointer of the same kind, is left over from a lost
    // release (a pen can get a new id per contact).
    if (e.isPrimary && this.press?.pointerType === e.pointerType && this.press.pointerId !== e.pointerId) this.press = null;
    if (e.pointerType === "touch" && e.isPrimary) this.outsideTouches.clear();
    const layout = this.model.layout;
    // A second finger while one is down is not the map's, and neither is a
    // finger while another is down on the world (a pinch); the same pointer
    // pressing again means its release was lost, so it starts over.
    if (!layout || (this.press && this.press.pointerId !== e.pointerId)) return;
    if (e.pointerType === "touch" && this.outsideTouches.size > 0) return;
    e.preventDefault();
    try {
      this.viewCanvas.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic or already-released pointer cannot be captured; the press
      // still follows moves over the canvas.
    }
    const p = this.mapPoint(e);
    const placement = this.model.placement;
    const area = placement ? this.grabArea(layout, placement, e.pointerType !== "mouse") : null;
    this.press = { pointerId: e.pointerId, pointerType: e.pointerType, onMark: !!area && rectContains(area, p.x, p.y), start: p, last: p, layout, traveled: false };
  }

  private onPointerMove(e: PointerEvent): void {
    const press = this.press;
    const layout = this.model.layout;
    // A mouse or pen whose release was lost (no capture, let go outside, or a
    // pen back in range with a new id) is only hovering, so the press ends.
    if (press && e.pointerType === press.pointerType && e.pointerType !== "touch" && noButtonHeld(e)) {
      this.press = null;
      return;
    }
    if (!press || press.pointerId !== e.pointerId || !layout) return;
    e.preventDefault();
    const p = this.mapPoint(e);
    if (press.layout !== layout) {
      // The map was rebuilt under the press (a resize, a new band): measure
      // from here on the new layout instead of jumping by the old scale.
      press.layout = layout;
      press.start = p;
      press.last = p;
      return;
    }
    if (this.traveledFrom(press.start, p)) press.traveled = true;
    // Within the tap slop the press may still be a tap: nothing moves, and
    // `last` stays where it started, so the first drag move catches up.
    if (!press.traveled) return;
    if (press.onMark) {
      // The camera is read again for every move: the renderer clamps it, so
      // the view may stop short of the pointer at an edge and follows it
      // straight back off the edge.
      this.deps.readCamera(this.cam);
      this.deps.moveCamera(dragCenter(layout, cameraCenter(this.cam), press.last, p));
    } else this.deps.moveCamera(mapPointToCenter(layout, p.x, p.y));
    press.last = p;
  }

  /** The press ends. A tap that did not travel, the release included,
   *  centers the view where it lifted, on the view mark too; a cancel never
   *  moves the camera. */
  private endPress(e: PointerEvent, released: boolean): void {
    const press = this.press;
    if (!press || press.pointerId !== e.pointerId) return;
    this.press = null;
    const layout = this.model.layout;
    if (!released || press.traveled || !layout || press.layout !== layout) return;
    const p = this.mapPoint(e);
    if (this.traveledFrom(press.start, p)) return;
    this.deps.moveCamera(mapPointToCenter(layout, p.x, p.y));
  }

  /** Whether a press moved past the tap slop. */
  private traveledFrom(start: { x: number; y: number }, p: { x: number; y: number }): boolean {
    return Math.hypot(p.x - start.x, p.y - start.y) > MAP_TAP_SLOP_CSS * this.px;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === MAP_KEY.close) {
      e.preventDefault();
      this.keys.keep(e);
      this.closeFromWindow(true);
      return;
    }
    if (passesMapKey(e)) return;
    // With focus in the window, every game key but zoom, speed, Tab, Space
    // and the shortcuts (`passesMapKey`) stays out of the world behind it:
    // building, bulldozing and the build cursor do nothing there. Keeping the
    // key never cancels it, so Enter still presses the close button.
    this.keys.keep(e);
    if (e.target !== this.viewCanvas) return;
    const layout = this.model.layout;
    if (!layout) return;
    this.deps.readCamera(this.cam);
    const target = keyTarget(e.key, e.shiftKey, this.cam, layout.extent);
    if (!target) return;
    e.preventDefault();
    this.deps.moveCamera(target);
  }

  /** Remove the window, its button and its page listeners. */
  dispose(): void {
    const doc = this.root.ownerDocument;
    doc.removeEventListener("pointerdown", this.onDocPointerDown, true);
    doc.removeEventListener("pointerup", this.onDocPointerUp, true);
    doc.removeEventListener("pointercancel", this.onDocPointerUp, true);
    this.keys.dispose();
    doc.defaultView?.removeEventListener("blur", this.onWindowBlur);
    this.worldPress.set(false);
    this.resizeObserver?.disconnect();
    this.root.remove();
    this.toggle.remove();
  }
}

