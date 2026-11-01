import { html, nothing, type TemplateResult } from "lit-html";
import { keyed } from "lit-html/directives/keyed.js";
import { isOperational, isTenanted } from "../../engine/types";
import { isCommercialKind, isHotelKind } from "../../presentation/viewKinds";
import { catalogFacility, catalogHouseholdPrice, catalogOpenAt, catalogResidents, rungFor, type Catalog } from "../../engine/catalogTypes";
import type { TransportDetail, UnitDetail } from "../../simport/panels";
import { priceOptionsFor } from "../catalogPricing";
import { isRentalKind } from "../../engine/residentialRentals";
import { hasAccessDiagnostic } from "../../game/facilityDiagnostics";
import { rungPickerTemplate, type RungChoice } from "./rungPicker";
import { floorTag } from "../format";

/**
 * The editor card bodies (E6-S1), pure functions of (card, catalog, mobile).
 * Authored to match `unitEditorHtml` / `transportEditorHtml` structurally
 * (proven by transitional guards, retired with the string builders) but rendered every
 * pump: lit's binding diff patches only the values that changed, so the
 * buttons and the rename input keep their element identity across refreshes.
 * That diff is what replaces the old `key`/`patchVolatile` protocol, a refresh
 * can never recreate a button mid-click (the "+ rent sometimes does nothing"
 * bug). The `data-field` attributes stay on the value cells: tests and tooling
 * read them, and they document which cells carry live values.
 *
 * The mobile diagnostics block folds in `facilityDiagnostics` /
 * `transportDiagnostics` (shared with the desktop inspector card). The caller
 * builds those lit `TemplateResult` lines (on mobile only) and hands them over
 * as `diagnostics`, so the block interpolates them directly; the
 * wrapper renders only when there is at least one line (an empty array leaves no
 * `.ed-diagnostics` box, matching the old empty `:empty { display:none }` div).
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

export function unitEditorTemplate(
  u: UnitDetail,
  catalog: Catalog,
  hour: number,
  mobile = false,
  diag: TemplateResult[] = [],
): TemplateResult {
  const f = catalogFacility(catalog, u.kind);
  const floorLabel = u.floor >= 1 ? `Floor ${u.floor}` : `Basement ${1 - u.floor}`;
  const canRename = u.kind === "office" || u.kind === "condo";
  const rcfg = f.rent;
  const rows: TemplateResult[] = [kv("Location", floorLabel), kv("Status", u.state, "status")];
  // Commercial venues show their LIVE customer count (that is what they
  // contribute to the population census); "(closed)" only for a tenanted venue
  // outside business hours, a vacant or under-construction unit already tells
  // that story in its Status row. Everything else reads occupants against the
  // unit's real occupancy (a Modern condo's household, the flat catalog value
  // for the rest), never a bare `5/3` for a big family.
  if (isCommercialKind(u.kind) && f.population > 0) {
    const closed = isTenanted(u) && !catalogOpenAt(f, hour);
    rows.push(kv("Customers", `${u.customersIn ?? 0}${closed ? " (closed)" : ""}`, "customers"));
  } else if (f.population) {
    rows.push(kv("Occupants", `${u.occupants}/${catalogResidents(f, u.residents)}`, "occupants"));
  }
  // On mobile the folded-in diagnostics carry the richer access reachability
  // line, so the plain Yes/No row would duplicate it: drop it there. But keep
  // it for a zero-population service kind (security/medical/housekeeping/metro),
  // whose diagnostics emit NO access line, so its connectivity still shows.
  if (!mobile || !hasAccessDiagnostic(catalog, u)) {
    const served = u.served;
    // The third state (#370): the floor is CONNECTED to the lobby (served) yet no
    // commuter completes the trip, so "Yes" would lie. Reachability is uncapped
    // now (#503), so this happens only in Classic, when the sole path is a
    // stair/escalator climb past the walk budget. Only kinds that draw
    // commuters/visitors read it (hasAccessDiagnostic, the same predicate the
    // diagnostics line uses); zero-population service kinds keep plain Yes/No.
    // "No route" echoes the inspector sentence and the stats footnote.
    const cutOff = served && hasAccessDiagnostic(catalog, u) && !u.reachable;
    let text = "Yes";
    if (!served) text = "No";
    else if (cutOff) text = "No route";
    rows.push(
      kv(
        "Elevator access",
        html`<span style="color:${served && !cutOff ? "var(--good)" : "var(--bad)"}">${text}</span>`,
        "served",
      ),
    );
  }
  const evalPct = Math.round(u.satisfaction * 100);
  rows.push(
    kv("Eval", html`<span class="evalbar"><span style="width:${evalPct}%"></span></span> ${evalPct}%`, "eval"),
  );
  if (rcfg) {
    let label = "Quarterly rent";
    if (u.kind === "condo") label = "Sale price";
    else if (isHotelKind(u.kind)) label = "Room rate";
    else if (isRentalKind(u.kind)) label = "Monthly rent";
    // For a SOLD condo the "Sale price" is what it actually fetched, the
    // household-scaled amount (and exactly what the buy-back will reclaim), not
    // the base asking. householdPrice falls back to the base when there's no
    // household, so Classic and unsold condos are unchanged. "No Rate" reads
    // where the price normally shows for a unit taken off the market.
    const rent = u.noRate
      ? "No Rate"
      : `$${(u.kind === "condo" ? catalogHouseholdPrice(catalog, u.price, u.residents) : u.price).toLocaleString()}${isHotelKind(u.kind) ? "/night" : ""}`;
    rows.push(kv(label, rent, "rent"));
  }
  if (u.kind === "cinema" && isOperational(u)) {
    // A gutted/burning/under-construction cinema books no film, omit the row.
    rows.push(kv("Now showing", u.blockbuster ? "Blockbuster" : "Feature", "showing"));
  }
  if (u.state === "gutted") {
    rows.push(kv("Scrap value", "$0"));
    rows.push(kv("⚠", "Gutted: bulldoze and rebuild."));
  } else {
    rows.push(kv("Resale value", `$${f.resaleRefund.toLocaleString()}`));
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
  // Price control, chosen off the SHAPE of priceOptions(), never the mode
  // string: a ladder renders the 1994 rung picker; a band keeps the existing
  // nudge steppers. A SOLD condo is price-locked: the ladder shows the picker
  // DISABLED at the locked rung (the design system's "show why a thing cannot
  // be pressed"); the band keeps today's hidden-row behavior.
  const priceShape = priceOptionsFor(catalog, u.kind);
  if (priceShape?.shape === "ladder") {
    const locked = u.kind === "condo" && u.everOccupied;
    const current: RungChoice = u.noRate ? "noRate" : rungFor(priceShape.rungs, u.price).level;
    let ariaLabel = "Rent level";
    if (u.kind === "condo") ariaLabel = "Sale price level";
    else if (isHotelKind(u.kind)) ariaLabel = "Room rate level";
    actions.push(
      edRow(
        rungPickerTemplate({
          id: "ed-rung",
          rungs: priceShape.rungs,
          current,
          ariaLabel,
          disabled: locked,
          dataEditSelect: "rung",
        }),
      ),
    );
    // Batch-price every unit of this kind at once (no per-room grind); a sold
    // condo keeps only its locked picker.
    if (!locked) {
      actions.push(edRow(html`<button class="btn" data-edit="batchKind">Set all ${f.name.toLowerCase()}s…</button>`));
    }
  } else if (rcfg && !(u.kind === "condo" && u.everOccupied)) {
    // Price adjuster: offices/hotels any time, condos only while still unsold.
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
  // Only the mobile fold-in shows the diagnostics, so only the mobile caller
  // pays for computing them (facilityDiagnostics can run a parking flood-fill
  // etc.); desktop leaves the block to the hover card.
  const diagnostics = diag.length ? html`<div class="ed-diagnostics" data-field="diagnostics">${diag}</div>` : nothing;
  // Canon retail variant titles the editor card too, matching the inspector.
  return editorShell(`unit:${u.id}`, u.subtype ?? f.name, rows, actions, diagnostics);
}

export function transportEditorTemplate(t: TransportDetail, catalog: Catalog, tdiag: TemplateResult[] = []): TemplateResult {
  const f = catalogFacility(catalog, t.kind);
  // The catalog lists a car limit for elevators and no other kind.
  const maxCars = f.maxCars;
  const isEl = maxCars !== null;
  const rows: TemplateResult[] = [
    kv("Serves floors", `${floorTag(t.bottom)} – ${floorTag(t.top)}`, "serves"),
    kv("Height", `${t.top - t.bottom + 1} floors`, "height"),
  ];
  if (isEl) {
    rows.push(kv("Cars", `${t.cars} / ${maxCars} max`, "cars"));
    rows.push(kv("Capacity", `${t.capacity} riders/trip`, "capacity"));
    // An express is locked to (sky) lobbies (1994 parity), so it reads a fixed
    // policy line rather than a free per-floor skip count. A legacy/forged save
    // may still carry a deliberately skipped lobby (coerceExpressStops preserves
    // those), so surface that count honestly instead of overstating the policy.
    // Standard/service keep their configurable stop readout.
    let stops: string;
    if (t.kind === "elevatorExpress") {
      const skippedLobbies = t.stops.filter((row) => !row.served && row.lobby).length;
      stops = skippedLobbies ? `lobbies and sky lobbies (${skippedLobbies} skipped)` : "lobbies and sky lobbies";
    } else {
      const skipped = t.stops.filter((row) => !row.served).length;
      stops = skipped ? `skips ${skipped} floor${skipped === 1 ? "" : "s"}` : "all floors";
    }
    rows.push(kv("Stops", stops, "stops"));
  }
  rows.push(kv("Resale value", `$${f.resaleRefund.toLocaleString()}`));

  const actions: TemplateResult[] = [];
  if (isEl) {
    actions.push(
      edRow(
        html`<button class="btn" data-edit="removecar" ?disabled=${t.cars <= 1}>– Car</button><button class="btn" data-edit="addcar" ?disabled=${t.cars >= maxCars}>+ Car</button>`,
      ),
    );
    // Per-shaft configuration (elevator-scheduling #305, floors fold-in #464):
    // ONE surface for stops, staging, and scheduling. The old Configure stops…
    // dialog and the Express (lobbies) / All stops card rows retired into the
    // Schedule dialog's floors grid, matching the 1994 one-window layout.
    // Available on every elevator kind (standard, service, express).
    actions.push(edRow(html`<button class="btn" data-edit="schedule">Schedule…</button>`));
    // Extend arrows are an elevator affordance: stairs/escalators are a
    // fixed two-floor flight by rule and never reach this branch.
    actions.push(
      edRow(
        html`<button class="btn" data-edit="extendDown">▼ Extend down</button><button class="btn" data-edit="extendUp">▲ Extend up</button>`,
      ),
    );
  }
  actions.push(edRow(html`<button class="btn danger" data-edit="sell">Sell / Bulldoze</button>`));

  // Desktop leaves the diagnostics to the hover card; its caller passes none.
  const diagnostics = tdiag.length ? html`<div class="ed-diagnostics" data-field="diagnostics">${tdiag}</div>` : nothing;
  return editorShell(`transport:${t.id}`, f.name, rows, actions, diagnostics);
}
