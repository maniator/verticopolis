import { html, render } from "lit-html";
import { FACILITIES } from "../engine/facilities";
import { catalogFacility, type Catalog, type CatalogFacility } from "../engine/catalogTypes";
import type { FacilityCategory, FacilityKind } from "../engine/types";
import type { Tool, UI } from "./UI";
import { shortMoney } from "./format";
import { iconTemplate } from "./icons";

/**
 * Build-palette construction for {@link UI}, as friend functions taking the UI
 * instance. The palette is built once at construction ({@link buildPalette}) and
 * its labels are redrawn when the tower's catalog changes ({@link relabelPalette});
 * each item routes back through `ui.selectTool`. Lock/afford state is a per-tick class
 * scan in `uiStatus`, which also calls {@link syncPaletteTabs} to keep the mobile
 * category tabs (and their "new" pips) in step with what is unlocked.
 *
 * Layout: Inspect/Bulldoze live in a pinned cluster (always visible); every build
 * category is a `.pal-group` section. On desktop all sections stack in a vertical
 * scroll with sticky headers; on a phone a category tab bar shows exactly one
 * section at a time, so reaching a far venue is a tab tap, not a long sideways
 * scroll. Commercial and Leisure carry a labeled "Modern" sub-band.
 */

const GROUPS: { title: string; cats: FacilityCategory[] }[] = [
  { title: "Structure", cats: ["structure"] },
  { title: "Transport", cats: ["transport"] },
  { title: "Commercial", cats: ["office", "retail", "food"] },
  { title: "Living", cats: ["residential", "hotel"] },
  { title: "Leisure", cats: ["entertainment"] },
  { title: "Services", cats: ["service"] },
  { title: "Special", cats: ["special"] },
];

export function buildPalette(ui: UI): void {
  const catalog = ui.cb.getCatalog();
  ui.paletteCatalog = catalog;
  // Pinned tools cluster: Inspect + Bulldoze, always visible (never behind a tab).
  const pinned = document.createElement("div");
  pinned.className = "pal-pinned";
  pinned.appendChild(groupTitle("Tools", undefined));
  pinned.appendChild(toolButton(ui, "inspect", "Inspect", "#9aa6bd"));
  pinned.appendChild(toolButton(ui, "bulldoze", "Bulldoze", "#ff6b6b"));

  // One section per build category.
  const groups = document.createElement("div");
  groups.className = "pal-groups";
  for (const group of GROUPS) {
    const section = document.createElement("section");
    section.className = "pal-group";
    section.dataset.group = group.title;
    section.appendChild(groupTitle(group.title, group.title));
    // The catalog lists every kind in the engine's order, both modes' kinds
    // included, and these fields read the same in both modes, so a palette
    // built once from the first tower serves a tower of either mode. It is
    // built before any WASM host attaches, from the TypeScript tables: the
    // names and prices are redrawn from the tower's catalog by the status pump
    // (relabelPalette), and the layout (kinds, groups, the Modern sub-band)
    // relies on the catalog digests holding the two engines' catalogs equal.
    const kinds = catalog.facilities.filter((f) => group.cats.includes(f.category));
    const classic = kinds.filter((f) => !f.modernOnly).map((f) => f.key);
    const modern = kinds.filter((f) => f.modernOnly).map((f) => f.key);
    for (const kind of classic) section.appendChild(facilityButton(ui, catalog, kind, group.title));
    // Modern venues sit under their own labeled sub-band (the 1.83 Sprite Gallery
    // idea), hidden by the scan when none are unlocked (Classic, or below 3 stars).
    if (modern.length > 0) {
      const sub = groupTitle("Modern", undefined);
      sub.classList.add("pal-sub");
      sub.dataset.subGroup = group.title;
      section.appendChild(sub);
      for (const kind of modern) section.appendChild(facilityButton(ui, catalog, kind, group.title, true));
    }
    groups.appendChild(section);
  }

  ui.el.palette.append(pinned, groups);
  if (ui.el.paletteTabs) {
    buildTabs(ui, ui.el.paletteTabs);
    // Select a category up front so the mobile content row is never blank between
    // construction and the first lock scan. Structure is always unlocked; the scan
    // re-validates on its first pass.
    selectGroup(ui, GROUPS[0].title);
  }
}

/** A group / sub-group divider. `dataGroup` lets the lock scan hide a group whose
 *  members are all still locked (no dangling section title). */
function groupTitle(text: string, dataGroup: string | undefined): HTMLElement {
  const el = document.createElement("div");
  el.className = "pal-group-title";
  if (dataGroup !== undefined) el.dataset.group = dataGroup;
  el.textContent = text;
  return el;
}

/** The phone-only category tab bar: one tab per build group, tapping it shows that
 *  group's section (mobile) via a `.tab-active` class the CSS keys off. Selection
 *  is sticky, so laying a row of the same room never reopens a menu. */
function buildTabs(ui: UI, bar: HTMLElement): void {
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", "Build categories");
  for (const group of GROUPS) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "pal-tab";
    tab.dataset.group = group.title;
    tab.dataset.ucount = "-1"; // set on the first scan so the initial unlock never pips
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    tab.textContent = group.title;
    tab.addEventListener("click", () => selectGroup(ui, group.title));
    bar.appendChild(tab);
  }
}

/** Make the named group the visible one on mobile: mark its section `.tab-active`,
 *  select its tab, and clear that tab's "new" pip. No-op if the group has no tab. */
export function selectGroup(ui: UI, title: string): void {
  const bar = ui.el.paletteTabs;
  const tab = bar?.querySelector<HTMLElement>(`.pal-tab[data-group="${title}"]`);
  if (!tab) return;
  bar!.querySelectorAll<HTMLElement>(".pal-tab").forEach((t) => {
    t.setAttribute("aria-selected", t === tab ? "true" : "false");
  });
  ui.el.palette.querySelectorAll<HTMLElement>(".pal-group").forEach((sec) => {
    sec.classList.toggle("tab-active", sec.dataset.group === title);
  });
  tab.classList.remove("has-new"); // opening a category clears its unlock nudge
  tab.dataset.ucount = String(countUnlocked(ui, title));
  // Start the newly opened category at its first tile: the horizontal scroll lives
  // on the `.pal-groups` container (mobile), not the section itself.
  const scroller = ui.el.palette.querySelector<HTMLElement>(".pal-groups");
  if (scroller) scroller.scrollLeft = 0;
}

/** Unlocked (visible) facility count in a group, read from the classes the lock
 *  scan just wrote, so this needs no engine access. */
function countUnlocked(ui: UI, title: string): number {
  return ui.el.palette.querySelectorAll(`.pal-group[data-group="${title}"] .pal-item[data-kind]:not(.locked)`).length;
}

/**
 * Keep the category tabs in step with the lock scan (called from `uiStatus` right
 * after it toggles item `.locked`): hide a tab and its section when the group has
 * no unlocked tools, hide the Modern sub-band when no Modern venue is unlocked yet,
 * raise a "new" pip on a tab whose unlocked count just grew (a star unlocked fresh
 * tools) unless it is the open tab, and keep a valid tab selected. Reads only the
 * DOM the scan wrote; draws no engine data of its own.
 */
export function syncPaletteTabs(ui: UI): void {
  const bar = ui.el.paletteTabs;
  if (!bar) return;
  for (const tab of bar.querySelectorAll<HTMLElement>(".pal-tab")) {
    const title = tab.dataset.group ?? "";
    const section = ui.el.palette.querySelector<HTMLElement>(`.pal-group[data-group="${title}"]`);
    const count = countUnlocked(ui, title);
    const empty = count === 0;
    tab.hidden = empty;
    if (section) section.hidden = empty;
    // Modern sub-band divider: visible only once a Modern venue in the group unlocks.
    const sub = section?.querySelector<HTMLElement>(".pal-sub");
    if (sub) sub.hidden = ui.el.palette.querySelectorAll(`.pal-group[data-group="${title}"] .pal-item.pal-mod:not(.locked)`).length === 0;
    // "New" pip: the count grew since the last scan and this is not the open tab.
    const prev = Number(tab.dataset.ucount);
    if (prev >= 0 && count > prev && tab.getAttribute("aria-selected") !== "true") tab.classList.add("has-new");
    tab.dataset.ucount = String(count);
  }
  // Keep a valid, visible tab selected: none yet, or the selected one just emptied.
  const selected = bar.querySelector<HTMLElement>('.pal-tab[aria-selected="true"]');
  if (!selected || selected.hidden) {
    const first = bar.querySelector<HTMLElement>(".pal-tab:not([hidden])");
    if (first) selectGroup(ui, first.dataset.group ?? "");
  }
}

/** Make a palette div behave like a button for mouse AND keyboard users:
 * focusable, role=button, and activatable with Enter/Space (a keyboard-only
 * play path). */
function makeActivatable(item: HTMLElement, label: string, onActivate: () => void): void {
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("aria-label", label);
  item.addEventListener("click", onActivate);
  item.addEventListener("keydown", (e) => {
    if (e.repeat) return; // a held key must not fire repeatedly (native button semantics)
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      e.stopPropagation(); // don't also reach the global build-cursor handler
      onActivate();
    }
  });
}

function toolButton(ui: UI, type: "inspect" | "bulldoze", label: string, color: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "pal-item";
  item.dataset.tool = type;
  // lit render for the inner swatch/label (built once at construction, from
  // trusted catalog constants); the container's a11y wiring stays imperative in
  // makeActivatable so a future re-render can't drop its listeners.
  render(
    html`<span class="pal-swatch" style="background:${color}"></span><span class="pal-name">${iconTemplate(type, { size: 14, className: "pal-ic" })}${label}</span>`,
    item,
  );
  makeActivatable(item, label, () => ui.selectTool({ type } as Tool));
  return item;
}

/** A facility button's swatch, name and price, and its spoken label. */
function labelFacility(item: HTMLElement, kind: FacilityKind, f: CatalogFacility): void {
  render(
    html`<span class="pal-swatch" style="background:${FACILITIES[kind].color}"></span><span class="pal-name">${f.name}</span><span class="pal-cost">$${shortMoney(f.cost)}</span>`,
    item,
  );
  item.setAttribute("aria-label", `${f.name}, $${shortMoney(f.cost)}`);
}

/** Redraw every facility button's name and price from `catalog`: the status
 *  pump calls this when the tower's catalog changes (a WASM host attached or
 *  let go, or a tower was swapped in), so the palette never shows another
 *  engine's values (#921). */
export function relabelPalette(ui: UI, catalog: Catalog): void {
  ui.paletteCatalog = catalog;
  ui.el.palette.querySelectorAll<HTMLElement>(".pal-item[data-kind]").forEach((item) => {
    const kind = item.dataset.kind as FacilityKind;
    labelFacility(item, kind, catalogFacility(catalog, kind));
  });
}

function facilityButton(ui: UI, catalog: Catalog, kind: FacilityKind, group: string, modern = false): HTMLElement {
  const f = catalogFacility(catalog, kind);
  const item = document.createElement("div");
  item.className = modern ? "pal-item pal-mod" : "pal-item";
  item.dataset.kind = kind;
  item.dataset.group = group;
  labelFacility(item, kind, f);
  // Locked facilities are hidden from the palette entirely (parity with the
  // original), so a visible button is never locked, no locked toast path.
  // (A visible button may still be unaffordable; the engine build guard, not
  // this palette, rejects a placement the player can't pay for.)
  // labelFacility wrote the spoken label; makeActivatable keeps it.
  makeActivatable(item, item.getAttribute("aria-label") ?? f.name, () => {
    ui.selectTool({ type: "build", kind });
  });
  return item;
}
