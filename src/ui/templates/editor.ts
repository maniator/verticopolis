import { html, nothing, type TemplateResult } from "lit-html";
import { keyed } from "lit-html/directives/keyed.js";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import type { Simulation } from "../../engine/Simulation";
import type { Transport, Unit } from "../../engine/types";
import { isOperational, isTenanted } from "../../engine/types";
import {
  FACILITIES,
  isCommercialKind,
  isElevatorKind,
  isHotelKind,
  isOpenAt,
  maxCarsFor,
  residentCount,
} from "../../engine/facilities";
import { householdPrice } from "../../engine/gameRules";
import { rentConfig, rentOf, resaleRefund } from "../../engine/econConfig";
import { facilityDiagnostics, hasAccessDiagnostic, transportDiagnostics } from "../../game/facilityDiagnostics";
import { floorTag } from "../format";

/**
 * The editor card bodies (E6-S1), pure functions of (sim, entity, mobile).
 * Authored to match `unitEditorHtml` / `transportEditorHtml` structurally
 * (proven by the transitional `assertDomEquivalent` tests) but rendered every
 * pump: lit's binding diff patches only the values that changed, so the
 * buttons and the rename input keep their element identity across refreshes.
 * That diff is what replaces the old `key`/`patchVolatile` protocol, a refresh
 * can never recreate a button mid-click (the "+ rent sometimes does nothing"
 * bug). The `data-field` attributes stay on the value cells: tests and tooling
 * read them, and they document which cells carry live values.
 *
 * The mobile diagnostics block folds in `facilityDiagnostics` /
 * `transportDiagnostics`, which still emit trusted internal HTML strings
 * (shared with the desktop inspector card, migrating in E6-S2). `unsafeHTML`
 * bridges them for now; it re-parses only when the string actually changes.
 */

/** The editor card's title bar, one template so the two editors can't drift. */
const titleBar = (name: string): TemplateResult =>
  html`<h4 class="win-title">${name}<button type="button" class="ed-close btn xs" aria-label="Close">✕</button></h4>`;

/** One key/value stat row. `field` marks the cells that carry live values. */
const kv = (label: string, value: unknown, field?: string): TemplateResult =>
  html`<span class="k">${label}</span><span class="v" data-field=${field ?? nothing}>${value}</span>`;

/** One action row of the editor card. */
const edRow = (inner: TemplateResult): TemplateResult => html`<div class="ed-row">${inner}</div>`;

/** The shared editor-card frame: title bar + stat grid + an optional full-width
 *  block (the mobile diagnostics fold-in) + action rows. `key` is the selected
 *  entity's identity ("unit:7" / "transport:3"): `keyed` clears and rebuilds
 *  the card when the SELECTION changes, exactly the legacy id-keyed rebuild.
 *  Without it, lit would reuse the rename input across entities, and a dirty
 *  (mid-edit) input's live value survives attribute updates, so half-typed
 *  text from unit A would show, and commit, on unit B. Within one entity the
 *  key is constant and lit's diff patches values in place as usual. */
const editorShell = (
  key: string,
  name: string,
  rows: TemplateResult[],
  actions: TemplateResult[],
  diagnostics: unknown = nothing,
): TemplateResult =>
  html`${keyed(key, html`${titleBar(name)}<div class="ed-stats kv">${rows}</div>${diagnostics}${actions}`)}`;

export function unitEditorTemplate(sim: Simulation, u: Unit, mobile = false): TemplateResult {
  const f = FACILITIES[u.kind];
  const floorLabel = u.floor >= 1 ? `Floor ${u.floor}` : `Basement ${1 - u.floor}`;
  const canRename = u.kind === "office" || u.kind === "condo";
  const rcfg = rentConfig(u.kind);
  const rows: TemplateResult[] = [kv("Location", floorLabel), kv("Status", u.state, "status")];
  // Commercial venues show their LIVE customer count (that is what they
  // contribute to the population census); "(closed)" only for a tenanted venue
  // outside business hours, a vacant or under-construction unit already tells
  // that story in its Status row. Everything else reads occupants against the
  // unit's real occupancy (a Modern condo's household, the flat catalog value
  // for the rest), never a bare `5/3` for a big family.
  if (isCommercialKind(u.kind) && f.population > 0) {
    const closed = isTenanted(u) && !isOpenAt(u.kind, sim.clock.hour);
    rows.push(kv("Customers", `${u.customersIn ?? 0}${closed ? " (closed)" : ""}`, "customers"));
  } else if (f.population) {
    rows.push(kv("Occupants", `${u.occupants}/${residentCount(u)}`, "occupants"));
  }
  // On mobile the folded-in diagnostics carry the richer access reachability
  // line, so the plain Yes/No row would duplicate it: drop it there. But keep
  // it for a zero-population service kind (security/medical/housekeeping/metro),
  // whose diagnostics emit NO access line, so its connectivity still shows.
  if (!mobile || !hasAccessDiagnostic(u)) {
    const served = sim.tower.isFloorServed(u.floor);
    rows.push(
      kv(
        "Elevator access",
        html`<span style="color:${served ? "var(--good)" : "var(--bad)"}">${served ? "Yes" : "No"}</span>`,
        "served",
      ),
    );
  }
  const evalPct = Math.round(u.satisfaction * 100);
  rows.push(
    kv("Eval", html`<span class="evalbar"><span style="width:${evalPct}%"></span></span> ${evalPct}%`, "eval"),
  );
  if (rcfg) {
    const label = u.kind === "condo" ? "Sale price" : isHotelKind(u.kind) ? "Room rate" : "Quarterly rent";
    // For a SOLD condo the "Sale price" is what it actually fetched, the
    // household-scaled amount (and exactly what the buy-back will reclaim), not
    // the base asking. householdPrice falls back to the base when there's no
    // household, so Classic and unsold condos are unchanged. "No Rate" reads
    // where the price normally shows for a unit taken off the market.
    const rent = u.noRate
      ? "No Rate"
      : `$${(u.kind === "condo" ? householdPrice(rentOf(u), u.residents) : rentOf(u)).toLocaleString()}${isHotelKind(u.kind) ? "/night" : ""}`;
    rows.push(kv(label, rent, "rent"));
  }
  if (u.kind === "cinema" && isOperational(u)) {
    // A gutted/burning/under-construction cinema books no film, omit the row.
    rows.push(kv("Now showing", sim.isShowingBlockbuster(u.id) ? "Blockbuster" : "Feature", "showing"));
  }
  if (u.state === "gutted") {
    rows.push(kv("Scrap value", "$0"));
    rows.push(kv("⚠", "Gutted: bulldoze and rebuild."));
  } else {
    rows.push(kv("Resale value", `$${resaleRefund(f.kind).toLocaleString()}`));
  }

  const actions: TemplateResult[] = [];
  if (canRename) {
    // The `value` binding is an ATTRIBUTE (sets the input's default), so a
    // re-render while the player is typing never clobbers the live text or
    // caret; the label only changes when a rename commits.
    actions.push(
      edRow(
        html`<input class="field" data-edit="noop" id="ed-name" value=${u.label} /><button class="btn" data-edit="rename">Rename</button>`,
      ),
    );
  }
  // Price adjuster: offices/hotels any time, condos only while still unsold.
  if (rcfg && !(u.kind === "condo" && u.everOccupied)) {
    const what = u.kind === "condo" ? "price" : "rent";
    actions.push(
      edRow(
        html`<button class="btn" data-edit="rentDown">– ${what}</button><button class="btn" data-edit="rentUp">+ ${what}</button>`,
      ),
    );
    // Batch-price every unit of this kind at once (no per-room grind).
    actions.push(
      edRow(html`<button class="btn" data-edit="batchKind">Set all ${f.name.toLowerCase()}s…</button>`),
    );
  }
  if (u.kind === "cinema") {
    const pol = { auto: "Auto", feature: "Feature", blockbuster: "Blockbuster" }[u.filmPolicy ?? "auto"];
    actions.push(edRow(html`<button class="btn" data-edit="filmPolicy">Booking: ${pol} ▸</button>`));
  }
  // Canon retail reroll: only offer on shop / fastFood / restaurant. Legacy
  // retail units without a subtype still get the button so a player can opt
  // into a variant. Kinds without a canon list are gated out at the action
  // handler (rerollSubtype returns undefined), but the button belongs off
  // their card to avoid a visible no-op affordance.
  if (u.kind === "shop" || u.kind === "fastFood" || u.kind === "restaurant") {
    actions.push(edRow(html`<button class="btn" data-edit="changeVariety">Change variety ▸</button>`));
  }
  actions.push(edRow(html`<button class="btn danger" data-edit="sell">Sell / Bulldoze</button>`));

  // On mobile, fold the inspector card's diagnostics in as a live block between
  // the stats and the controls (one panel, no separate card). Desktop leaves
  // them to the hover card, so the block only exists on mobile.
  const diagnostics = mobile
    ? html`<div class="ed-diagnostics" data-field="diagnostics">${unsafeHTML(facilityDiagnostics(sim, u))}</div>`
    : nothing;
  // Canon retail variant titles the editor card too, matching the inspector.
  return editorShell(`unit:${u.id}`, u.subtype ?? f.name, rows, actions, diagnostics);
}

export function transportEditorTemplate(sim: Simulation, t: Transport, mobile = false): TemplateResult {
  const f = FACILITIES[t.kind];
  const isEl = isElevatorKind(t.kind);
  const maxCars = maxCarsFor(t.kind);
  const rows: TemplateResult[] = [
    kv("Serves floors", `${floorTag(t.bottom)} – ${floorTag(t.top)}`, "serves"),
    kv("Height", `${t.top - t.bottom + 1} floors`, "height"),
  ];
  if (isEl) {
    rows.push(kv("Cars", `${t.cars} / ${maxCars} max`, "cars"));
    rows.push(kv("Capacity", `${sim.transportCapacity(t)} riders/trip`, "capacity"));
    // An express is locked to (sky) lobbies (1994 parity), so it reads a fixed
    // policy line rather than a free per-floor skip count. A legacy/forged save
    // may still carry a deliberately skipped lobby (coerceExpressStops preserves
    // those), so surface that count honestly instead of overstating the policy.
    // Standard/service keep their configurable stop readout.
    let stops: string;
    if (t.kind === "elevatorExpress") {
      const skippedLobbies = (t.skipFloors ?? []).filter((fl) => sim.tower.floorHasLobby(fl)).length;
      stops = skippedLobbies ? `lobbies and sky lobbies (${skippedLobbies} skipped)` : "lobbies and sky lobbies";
    } else {
      const skipped = t.skipFloors?.length ?? 0;
      stops = skipped ? `skips ${skipped} floor${skipped === 1 ? "" : "s"}` : "all floors";
    }
    rows.push(kv("Stops", stops, "stops"));
  }
  rows.push(kv("Resale value", `$${resaleRefund(f.kind).toLocaleString()}`));

  const actions: TemplateResult[] = [];
  if (isEl) {
    actions.push(
      edRow(
        html`<button class="btn" data-edit="removecar" ?disabled=${t.cars <= 1}>– Car</button><button class="btn" data-edit="addcar" ?disabled=${t.cars >= maxCars}>+ Car</button>`,
      ),
    );
    // Standard/service keep the free per-floor stop config and All stops
    // (real-game feature). An express is locked to (sky) lobbies, so it offers
    // no stop-config buttons, just the fixed policy in the Stops row above.
    if (t.kind !== "elevatorExpress") {
      actions.push(edRow(html`<button class="btn" data-edit="stops">Configure stops…</button>`));
      actions.push(
        edRow(
          html`<button class="btn" data-edit="express">Express (lobbies)</button><button class="btn" data-edit="allstops">All stops</button>`,
        ),
      );
    }
    // Extend arrows are an elevator affordance: stairs/escalators are a
    // fixed two-floor flight by rule and never reach this branch.
    actions.push(
      edRow(
        html`<button class="btn" data-edit="extendDown">▼ Extend down</button><button class="btn" data-edit="extendUp">▲ Extend up</button>`,
      ),
    );
  }
  actions.push(edRow(html`<button class="btn danger" data-edit="sell">Sell / Bulldoze</button>`));

  const diagnostics = mobile
    ? html`<div class="ed-diagnostics" data-field="diagnostics">${unsafeHTML(transportDiagnostics(sim, t))}</div>`
    : nothing;
  return editorShell(`transport:${t.id}`, f.name, rows, actions, diagnostics);
}
