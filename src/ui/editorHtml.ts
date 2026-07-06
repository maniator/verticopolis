import type { Simulation } from "../engine/Simulation";
import type { Transport, Unit } from "../engine/types";
import { isOperational } from "../engine/types";
import { FACILITIES, isElevatorKind, isHotelKind, maxCarsFor, residentCount } from "../engine/facilities";
import { householdPrice } from "../engine/gameRules";
import { rentConfig, rentOf, resaleRefund } from "../engine/econConfig";
import { escapeHtml } from "./escape";
import { floorTag } from "./format";

/**
 * The editor card's HTML — pure functions of (sim, entity), split out of the
 * GameApp class so the card can be unit-tested without a DOM game shell.
 * The `*Volatile` maps carry the per-tick values; the editor patches only
 * those `data-field` spans between full rebuilds (see UI.renderEditor).
 */

/** The editor card's title bar — one template so the two editors can't drift. */
const editorTitleBar = (name: string): string =>
  `<h4 class="win-title">${escapeHtml(name)}<button type="button" class="ed-close btn xs" aria-label="Close">✕</button></h4>`;

/** One key/value stat row. `field` marks the value for volatile patching. */
const kvRow = (label: string, value: string, field?: string): string =>
  `<span class="k">${label}</span><span class="v"${field ? ` data-field="${field}"` : ""}>${value}</span>`;

/** One action row of the editor card. */
const edRow = (inner: string): string => `<div class="ed-row">${inner}</div>`;

/** The shared editor-card frame: title bar + stat grid + action rows. */
const editorShell = (name: string, rows: string[], actions: string[]): string =>
  editorTitleBar(name) + `<div class="ed-stats kv">${rows.join("")}</div>` + actions.join("");

export function unitEditorVolatile(sim: Simulation, u: Unit): Record<string, string> {
  const f = FACILITIES[u.kind];
  const served = sim.tower.isFloorServed(u.floor);
  const evalPct = Math.round(u.satisfaction * 100);
  const vol: Record<string, string> = {
    status: u.state,
    served: `<span style="color:${served ? "var(--good)" : "var(--bad)"}">${served ? "Yes" : "No"}</span>`,
    eval: `<span class="evalbar"><span style="width:${evalPct}%"></span></span> ${evalPct}%`,
  };
  // Capacity denominator is the unit's real occupancy (a Modern condo's household,
  // the flat catalog value for everything else) — never a bare `5/3` for a big family.
  if (f.population) vol.occupants = `${u.occupants}/${residentCount(u)}`;
  if (rentConfig(u.kind)) {
    // For a SOLD condo the "Sale price" is what it actually fetched — the
    // household-scaled amount (and exactly what the buy-back will reclaim), not
    // the base asking. Unsold condos (residents undefined) and every other kind
    // read the plain asking price. householdPrice falls back to the base when
    // there's no household, so Classic and unsold condos are unchanged.
    const price = u.kind === "condo" ? householdPrice(rentOf(u), u.residents) : rentOf(u);
    vol.rent = `$${price.toLocaleString()}${isHotelKind(u.kind) ? "/night" : ""}`;
  }
  if (u.kind === "cinema") {
    // A mid-build / burning / gutted cinema books no film — show "—", not a fake feature.
    vol.showing = !isOperational(u) ? "—" : sim.isShowingBlockbuster(u.id) ? "Blockbuster" : "Feature";
  }
  return vol;
}

export function unitEditorHtml(sim: Simulation, u: Unit): string {
  const f = FACILITIES[u.kind];
  const floorLabel = u.floor >= 1 ? `Floor ${u.floor}` : `Basement ${1 - u.floor}`;
  const canRename = u.kind === "office" || u.kind === "condo";
  const rcfg = rentConfig(u.kind);
  const vol = unitEditorVolatile(sim, u);
  const rows: string[] = [kvRow("Location", floorLabel), kvRow("Status", vol.status, "status")];
  if (f.population) rows.push(kvRow("Occupants", vol.occupants, "occupants"));
  rows.push(kvRow("Elevator access", vol.served, "served"));
  rows.push(kvRow("Eval", vol.eval, "eval"));
  if (rcfg) {
    const label = u.kind === "condo" ? "Sale price" : isHotelKind(u.kind) ? "Room rate" : "Quarterly rent";
    rows.push(kvRow(label, vol.rent, "rent"));
  }
  if (u.kind === "cinema" && isOperational(u)) {
    // A gutted/burning/under-construction cinema books no film — omit the row.
    rows.push(kvRow("Now showing", vol.showing, "showing"));
  }
  if (u.state === "gutted") {
    rows.push(kvRow("Scrap value", "$0"));
    rows.push(kvRow("⚠", "Gutted — bulldoze and rebuild."));
  } else {
    rows.push(kvRow("Resale value", `$${resaleRefund(f.kind).toLocaleString()}`));
  }

  const actions: string[] = [];
  if (canRename) {
    actions.push(
      edRow(
        `<input class="field" data-edit="noop" id="ed-name" value="${escapeHtml(u.label)}" /><button class="btn" data-edit="rename">Rename</button>`,
      ),
    );
  }
  // Price adjuster: offices/hotels any time, condos only while still unsold.
  if (rcfg && !(u.kind === "condo" && u.everOccupied)) {
    const what = u.kind === "condo" ? "price" : "rent";
    actions.push(edRow(`<button class="btn" data-edit="rentDown">– ${what}</button><button class="btn" data-edit="rentUp">+ ${what}</button>`));
    // Batch-price every unit of this kind at once (no per-room grind).
    actions.push(edRow(`<button class="btn" data-edit="batchKind">Set all ${FACILITIES[u.kind].name.toLowerCase()}s…</button>`));
  }
  if (u.kind === "cinema") {
    const pol = { auto: "Auto", feature: "Feature", blockbuster: "Blockbuster" }[u.filmPolicy ?? "auto"];
    actions.push(edRow(`<button class="btn" data-edit="filmPolicy">Booking: ${pol} ▸</button>`));
  }
  actions.push(edRow(`<button class="btn danger" data-edit="sell">Sell / Bulldoze</button>`));

  return editorShell(f.name, rows, actions);
}

export function transportEditorVolatile(sim: Simulation, t: Transport): Record<string, string> {
  const isEl = isElevatorKind(t.kind);
  const maxCars = maxCarsFor(t.kind);
  const skipped = t.skipFloors?.length ?? 0;
  const vol: Record<string, string> = {
    serves: `${floorTag(t.bottom)} – ${floorTag(t.top)}`,
    height: `${t.top - t.bottom + 1} floors`,
  };
  if (isEl) {
    vol.cars = `${t.cars} / ${maxCars} max`;
    vol.capacity = `${sim.transportCapacity(t)} riders/trip`;
    vol.stops = skipped ? `express · skips ${skipped}` : "all floors";
  }
  return vol;
}

export function transportEditorHtml(sim: Simulation, t: Transport): string {
  const f = FACILITIES[t.kind];
  const isEl = isElevatorKind(t.kind);
  const maxCars = maxCarsFor(t.kind);
  const vol = transportEditorVolatile(sim, t);
  const rows: string[] = [kvRow("Serves floors", vol.serves, "serves"), kvRow("Height", vol.height, "height")];
  if (isEl) {
    rows.push(kvRow("Cars", vol.cars, "cars"));
    rows.push(kvRow("Capacity", vol.capacity, "capacity"));
    rows.push(kvRow("Stops", vol.stops, "stops"));
  }
  rows.push(kvRow("Resale value", `$${resaleRefund(f.kind).toLocaleString()}`));

  const actions: string[] = [];
  if (isEl) {
    actions.push(
      edRow(
        `<button class="btn" data-edit="removecar"${t.cars <= 1 ? " disabled" : ""}>– Car</button><button class="btn" data-edit="addcar"${t.cars >= maxCars ? " disabled" : ""}>+ Car</button>`,
      ),
    );
    actions.push(edRow(`<button class="btn" data-edit="stops">Configure stops…</button>`));
    actions.push(edRow(`<button class="btn" data-edit="express">Express (lobbies)</button><button class="btn" data-edit="allstops">All stops</button>`));
    // Extend arrows are an elevator affordance: stairs/escalators are a
    // fixed two-floor flight by rule and never reach this branch.
    actions.push(edRow(`<button class="btn" data-edit="extendDown">▼ Extend down</button><button class="btn" data-edit="extendUp">▲ Extend up</button>`));
  }
  actions.push(edRow(`<button class="btn danger" data-edit="sell">Sell / Bulldoze</button>`));

  return editorShell(f.name, rows, actions);
}
