import type { Simulation } from "../engine/Simulation";
import type { Transport, Unit } from "../engine/types";
import { isOperational, isTenanted } from "../engine/types";
import { FACILITIES, isCommercialKind, isElevatorKind, isHotelKind, isOpenAt, maxCarsFor, residentCount } from "../engine/facilities";
import { householdPrice } from "../engine/gameRules";
import { rentConfig, rentOf, resaleRefund } from "../engine/econConfig";
import { facilityDiagnostics, hasAccessDiagnostic, transportDiagnostics } from "../game/facilityDiagnostics";
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

/** The shared editor-card frame: title bar + stat grid + an optional full-width
 *  block (the mobile diagnostics fold-in) + action rows. */
const editorShell = (name: string, rows: string[], actions: string[], extra = ""): string =>
  editorTitleBar(name) + `<div class="ed-stats kv">${rows.join("")}</div>` + extra + actions.join("");

export function unitEditorVolatile(sim: Simulation, u: Unit, mobile = false): Record<string, string> {
  const f = FACILITIES[u.kind];
  const served = sim.tower.isFloorServed(u.floor);
  const evalPct = Math.round(u.satisfaction * 100);
  const vol: Record<string, string> = {
    status: u.state,
    served: `<span style="color:${served ? "var(--good)" : "var(--bad)"}">${served ? "Yes" : "No"}</span>`,
    eval: `<span class="evalbar"><span style="width:${evalPct}%"></span></span> ${evalPct}%`,
  };
  // Mobile shows one panel, not a card plus editor, so the editor folds in the
  // inspector card's diagnostics (access reachability, placement warnings,
  // on-notice countdown, retail patronage) as a live-patched block. Desktop
  // leaves them to the hover card, so the field is only computed on mobile.
  if (mobile) vol.diagnostics = facilityDiagnostics(sim, u);
  // Capacity denominator is the unit's real occupancy (a Modern condo's household,
  // the flat catalog value for everything else) — never a bare `5/3` for a big family.
  // Commercial venues show their LIVE customer count instead (that is what they
  // contribute to the population census); a static "N/25" would read as a flat,
  // always-full population.
  if (isCommercialKind(u.kind) && f.population > 0) {
    // "(closed)" only for a tenanted venue outside business hours; a vacant or
    // under-construction unit already tells that story in its Status row.
    const closed = isTenanted(u) && !isOpenAt(u.kind, sim.clock.hour);
    vol.customers = `${u.customersIn ?? 0}${closed ? " (closed)" : ""}`;
  } else if (f.population) {
    vol.occupants = `${u.occupants}/${residentCount(u)}`;
  }
  if (rentConfig(u.kind)) {
    // For a SOLD condo the "Sale price" is what it actually fetched — the
    // household-scaled amount (and exactly what the buy-back will reclaim), not
    // the base asking. Unsold condos (residents undefined) and every other kind
    // read the plain asking price. householdPrice falls back to the base when
    // there's no household, so Classic and unsold condos are unchanged.
    if (u.noRate) {
      // Off the market: reads "No Rate" where the price normally shows. Display
      // only here; the full rate dropdown that can set it is deferred.
      vol.rent = "No Rate";
    } else {
      const price = u.kind === "condo" ? householdPrice(rentOf(u), u.residents) : rentOf(u);
      vol.rent = `$${price.toLocaleString()}${isHotelKind(u.kind) ? "/night" : ""}`;
    }
  }
  if (u.kind === "cinema") {
    // A mid-build / burning / gutted cinema books no film — show "—", not a fake feature.
    vol.showing = !isOperational(u) ? "—" : sim.isShowingBlockbuster(u.id) ? "Blockbuster" : "Feature";
  }
  return vol;
}

export function unitEditorHtml(sim: Simulation, u: Unit, mobile = false): string {
  const f = FACILITIES[u.kind];
  const floorLabel = u.floor >= 1 ? `Floor ${u.floor}` : `Basement ${1 - u.floor}`;
  const canRename = u.kind === "office" || u.kind === "condo";
  const rcfg = rentConfig(u.kind);
  const vol = unitEditorVolatile(sim, u, mobile);
  const rows: string[] = [kvRow("Location", floorLabel), kvRow("Status", vol.status, "status")];
  if (isCommercialKind(u.kind) && f.population > 0) rows.push(kvRow("Customers", vol.customers, "customers"));
  else if (f.population) rows.push(kvRow("Occupants", vol.occupants, "occupants"));
  // On mobile the folded-in diagnostics carry the richer access reachability
  // line, so the plain Yes/No row would duplicate it: drop it there. But keep
  // it for a zero-population service kind (security/medical/housekeeping/metro),
  // whose diagnostics emit NO access line, so its connectivity still shows.
  if (!mobile || !hasAccessDiagnostic(u)) rows.push(kvRow("Elevator access", vol.served, "served"));
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
    rows.push(kvRow("⚠", "Gutted: bulldoze and rebuild."));
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
  // Canon retail reroll: only offer on shop / fastFood / restaurant. Legacy
  // retail units without a subtype still get the button so a player can opt
  // into a variant. Kinds without a canon list are gated out at the action
  // handler (rerollSubtype returns undefined), but the button belongs off
  // their card to avoid a visible no-op affordance.
  if (u.kind === "shop" || u.kind === "fastFood" || u.kind === "restaurant") {
    actions.push(edRow(`<button class="btn" data-edit="changeVariety">Change variety ▸</button>`));
  }
  actions.push(edRow(`<button class="btn danger" data-edit="sell">Sell / Bulldoze</button>`));

  // On mobile, fold the inspector card's diagnostics in as a live-patched
  // block between the stats and the controls (one panel, no separate card).
  const extra = mobile ? `<div class="ed-diagnostics" data-field="diagnostics">${vol.diagnostics ?? ""}</div>` : "";
  // Canon retail variant titles the editor card too, matching the inspector.
  return editorShell(u.subtype ?? f.name, rows, actions, extra);
}

export function transportEditorVolatile(sim: Simulation, t: Transport, mobile = false): Record<string, string> {
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
    // An express is locked to (sky) lobbies (1994 parity), so it reads a fixed
    // policy line rather than a free per-floor skip count. A legacy/forged save
    // may still carry a deliberately skipped lobby (coerceExpressStops preserves
    // those), so surface that count honestly instead of overstating the policy.
    // Standard/service keep their configurable stop readout.
    if (t.kind === "elevatorExpress") {
      const skippedLobbies = (t.skipFloors ?? []).filter((fl) => sim.tower.floorHasLobby(fl)).length;
      vol.stops = skippedLobbies ? `lobbies and sky lobbies (${skippedLobbies} skipped)` : "lobbies and sky lobbies";
    } else {
      vol.stops = skipped ? `express · skips ${skipped}` : "all floors";
    }
  }
  // Mobile shows one panel, so the editor folds in the card's avg-load line
  // (empty for stairs/escalators and staff-only service elevators).
  if (mobile) vol.diagnostics = transportDiagnostics(sim, t);
  return vol;
}

export function transportEditorHtml(sim: Simulation, t: Transport, mobile = false): string {
  const f = FACILITIES[t.kind];
  const isEl = isElevatorKind(t.kind);
  const maxCars = maxCarsFor(t.kind);
  const vol = transportEditorVolatile(sim, t, mobile);
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
    // Standard/service keep the free per-floor stop config and All stops
    // (real-game feature). An express is locked to (sky) lobbies, so it offers
    // no stop-config buttons, just the fixed policy in the Stops row above.
    if (t.kind !== "elevatorExpress") {
      actions.push(edRow(`<button class="btn" data-edit="stops">Configure stops…</button>`));
      actions.push(edRow(`<button class="btn" data-edit="express">Express (lobbies)</button><button class="btn" data-edit="allstops">All stops</button>`));
    }
    // Extend arrows are an elevator affordance: stairs/escalators are a
    // fixed two-floor flight by rule and never reach this branch.
    actions.push(edRow(`<button class="btn" data-edit="extendDown">▼ Extend down</button><button class="btn" data-edit="extendUp">▲ Extend up</button>`));
  }
  actions.push(edRow(`<button class="btn danger" data-edit="sell">Sell / Bulldoze</button>`));

  const extra = mobile ? `<div class="ed-diagnostics" data-field="diagnostics">${vol.diagnostics ?? ""}</div>` : "";
  return editorShell(f.name, rows, actions, extra);
}
