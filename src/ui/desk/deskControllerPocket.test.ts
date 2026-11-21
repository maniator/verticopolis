import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { html } from "lit-html";
import { mountPage } from "../testing/litTestUtils";
import { drawMenuBar, onMenuItem } from "../../game/menuBarHost";

vi.mock("../../analyticsActions", () => ({ trackAppAction: vi.fn(), trackAppActionOnce: vi.fn() }));

import { trackAppActionOnce } from "../../analyticsActions";
import { DESK_MINIMIZED_CLASS } from "@verticopolis/components/windows/desk/deskWindow";
import { DESK_ANY_SCREEN_MQ, DESK_CLASS, DESK_KEY, DESK_MQ, DeskController } from "./deskController";
import {
  DESK_POCKET_CLASS,
  DESK_TOUCH_CLASS,
  POCKET_BODY_CLASS,
  TOUCH_DESK_MQ,
  TOUCH_MQ,
} from "@verticopolis/components/windows/desk/deskPocket";

/** The game's own elements, in their usual places; the game opened the Bulletin. */
const PAGE = html`
  <div id="app">
    <div id="topbar">Info</div>
    <div id="menubar-host"></div>
    <div id="stage"><section id="overview-map" class="win" hidden><div class="win-title">Map<button class="btn xs overview-map-close">x</button></div></section></div>
    <div id="statusbar"><span id="sb-tower">Skyline · Classic</span></div>
    <aside id="palette" class="win"><div class="win-title">Tools</div></aside>
    <section id="bulletin-win" class="win"><div class="win-title">Bulletin<button class="btn xs" data-close="bulletin-win">x</button></div></section>
    <section id="tower-win" class="win" hidden><div class="win-title">Tower Info</div></section>
  </div>`;

let matching = new Set<string>();
let doc: Document;

beforeEach(() => {
  doc = document.implementation.createHTMLDocument("Verticopolis");
  mountPage(PAGE, doc);
  drawMenuBar(doc);
  Object.defineProperty(doc, "location", { value: new URL("http://localhost/"), configurable: true });
  // The game's Map item opens the Map, as the game does.
  const map = doc.getElementById("overview-map")!;
  onMenuItem("mb-win-map", () => (map.hidden = !map.hidden), doc);
  const bulletin = doc.getElementById("bulletin-win")!;
  onMenuItem("mb-win-bulletin", () => (bulletin.hidden = false), doc);
  localStorage.clear();
  matching = new Set([TOUCH_MQ]);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return matching.has(query);
      },
      addEventListener: () => {},
    })),
  );
  vi.mocked(trackAppActionOnce).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const parent = (id: string) => doc.getElementById(id)?.parentElement;
const tasks = () => [...doc.querySelectorAll<HTMLElement>(".desk-task")].map((t) => t.textContent);

describe("the pocket desk", () => {
  it("puts Info, Tools and the tower in the tower window on a phone, with the Map left in the tower's view", () => {
    new DeskController(doc).start();
    expect(doc.body.classList.contains(DESK_CLASS)).toBe(true);
    expect(doc.body.classList.contains(DESK_POCKET_CLASS)).toBe(true);
    expect(doc.body.classList.contains(DESK_TOUCH_CLASS)).toBe(true);
    const grid = doc.querySelector(`#desk-win-tower .${POCKET_BODY_CLASS}`);
    expect(grid).not.toBeNull();
    for (const id of ["topbar", "palette", "stage"]) expect(parent(id)).toBe(grid);
    expect(parent("overview-map")).toBe(doc.getElementById("stage"));
    expect(doc.getElementById("overview-map")!.classList.contains("desk-win")).toBe(false);
    expect(doc.getElementById("desk-win-info")).toBeNull();
    expect(trackAppActionOnce).toHaveBeenCalledWith("desk_shown", "pocket");
  });

  it("opens the Map over the tower and keeps the game's Bulletin on the taskbar", () => {
    new DeskController(doc).start();
    expect(doc.getElementById("overview-map")!.hidden).toBe(false);
    expect(doc.getElementById("bulletin-win")!.classList.contains(DESK_MINIMIZED_CLASS)).toBe(true);
    expect(tasks()).toEqual(["Skyline", "Bulletin"]);
  });

  it("brings the Bulletin up when the player asks for it", () => {
    new DeskController(doc).start();
    doc.getElementById("mb-dw-bulletin")!.click();
    expect(doc.getElementById("bulletin-win")!.classList.contains(DESK_MINIMIZED_CLASS)).toBe(false);
  });

  it("brings the Bulletin up from the Tower menu too", async () => {
    new DeskController(doc).start();
    const bulletin = doc.getElementById("bulletin-win")!;
    // A value jsdom reports back as the old value (it drops an empty one).
    bulletin.setAttribute("hidden", "hidden");
    await Promise.resolve();
    doc.getElementById("mb-win-bulletin")!.click();
    await Promise.resolve();
    expect(bulletin.hidden).toBe(false);
    expect(bulletin.classList.contains(DESK_MINIMIZED_CLASS)).toBe(false);
  });

  it("opens a closed Map from the Window menu and leaves Info and Tools out of it", async () => {
    new DeskController(doc).start();
    const map = doc.getElementById("overview-map")!;
    map.hidden = true;
    await Promise.resolve();
    expect(doc.getElementById("mb-dw-map")!.getAttribute("aria-checked")).toBe("false");
    doc.getElementById("mb-dw-map")!.click();
    await Promise.resolve();
    expect(map.hidden).toBe(false);
    expect(doc.getElementById("mb-dw-map")!.getAttribute("aria-checked")).toBe("true");
    expect(doc.getElementById("mb-dw-info")!.hidden).toBe(true);
    expect(doc.getElementById("mb-dw-tools")!.hidden).toBe(true);
  });

  it("keeps the tower up when the player taps its taskbar button", () => {
    new DeskController(doc).start();
    doc.querySelector<HTMLElement>('.desk-task[data-win="tower"]')!.click();
    expect(doc.getElementById("desk-win-tower")!.classList.contains(DESK_MINIMIZED_CLASS)).toBe(false);
  });

  it("keeps news the game posts later on the taskbar", async () => {
    new DeskController(doc).start();
    const bulletin = doc.getElementById("bulletin-win")!;
    doc.querySelector<HTMLElement>(".desk-task:last-child")!.click();
    const settle = () => new Promise((done) => setTimeout(done, 0));
    // A value jsdom reports back as the old value (it drops an empty one).
    bulletin.setAttribute("hidden", "hidden");
    await settle();
    bulletin.removeAttribute("hidden");
    await settle();
    expect(bulletin.classList.contains(DESK_MINIMIZED_CLASS)).toBe(true);
  });

  it("gives a sideways tablet the full desk with touch chrome", () => {
    matching = new Set([TOUCH_MQ, TOUCH_DESK_MQ, DESK_ANY_SCREEN_MQ]);
    new DeskController(doc).start();
    expect(doc.body.classList.contains(DESK_POCKET_CLASS)).toBe(false);
    expect(doc.body.classList.contains(DESK_TOUCH_CLASS)).toBe(true);
    expect(parent("topbar")?.closest("#desk-win-info")).not.toBeNull();
  });

  it("lets ?desk=pocket bring the pocket desk to a computer", () => {
    matching = new Set([DESK_MQ, DESK_ANY_SCREEN_MQ]);
    Object.defineProperty(doc, "location", { value: new URL("http://localhost/?desk=pocket") });
    new DeskController(doc).start();
    expect(localStorage.getItem(DESK_KEY.enabled)).toBe("pocket");
    expect(doc.body.classList.contains(DESK_POCKET_CLASS)).toBe(true);
  });
});
