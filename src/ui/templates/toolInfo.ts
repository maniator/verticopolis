import { html, nothing, type TemplateResult } from "lit-html";
import { catalogBuildKind, catalogFacility, catalogTileCost, type Catalog } from "../../catalog/catalogTypes";
import { isCommercialKind } from "../../presentation/viewKinds";
import { facilityDescription } from "../../presentation/facilityPresentation";
import type { FacilityKind } from "../../shared/types";
import { groupDigits } from "../format";
import type { DragClears } from "../../game/bulldozeDrag";

/**
 * The tool-info panel bodies (E5-S2). `UI.selectTool` renders one of these
 * into `#tool-info` when the player picks a tool, and the status pump redraws
 * a build tool's card when the tower's catalog changes (#921). Authored to match `buildToolInfoHtml` / `BULLDOZE_TOOL_INFO_HTML` /
 * `INSPECT_TOOL_INFO_HTML` structurally (proven by
 * transitional guards, retired with the string builders). The facility `name`/`description` copy is trusted
 * static text and now auto-escapes through lit; the conditional
 * capacity/customers row uses lit's `nothing` in place of the legacy `""`.
 * `#tool-info` is lit's container exclusively after the constructor clears its
 * static placeholder (one container, one renderer).
 */
export function toolInfoTemplate(
  f: { name: string; cost: number; population: number; description: string },
  isCommercial: boolean,
  // When set, the tool lays a lobby at this price on the ground floor (level 1).
  // Passed for the Floor tool so a player learns up front that floor 1 is
  // lobby-only and priced accordingly, before they drop the cheaper floor tile.
  groundFloorLobbyCost?: number,
  // When set, a tile of this kind placed where there is no floor yet costs
  // this, since it pays for the floor too. Passed for the Lobby tool, whose
  // `Cost` line is the price over a floor tile.
  noFloorYetCost?: number,
): TemplateResult {
  // Commercial venues never hold a flat population: they add however many
  // customers are eating right now, up to the catalog value. "Capacity"
  // stays for the kinds where it is literally the head count.
  return html`<div class="ti-name">${f.name}</div><div>Cost: $${groupDigits(f.cost)}</div>${
    noFloorYetCost !== undefined
      ? html`<div>Where there is no floor yet: $${groupDigits(noFloorYetCost)} per tile, floor included</div>`
      : nothing
  }${
    f.population
      ? html`<div>${isCommercial ? `Customers: up to ${f.population}` : `Capacity: ${f.population}`}</div>`
      : nothing
  }<p style="margin-top:6px;color:var(--muted)">${f.description}</p>${
    groundFloorLobbyCost !== undefined
      ? html`<p style="margin-top:6px;color:var(--muted)">On the ground floor (level 1) this lays a lobby, $${groupDigits(groundFloorLobbyCost)} per tile.</p>`
      : nothing
  }`;
}

/** The info card for a build tool: the name, price and capacity from the
 *  tower's catalog (#921), and the description from the presentation table.
 *  The Floor tool lays the ground-floor structure (a lobby) on the ground
 *  floor, so its card carries that price too (see catalogBuildKind). */
export function toolInfoFor(catalog: Catalog, kind: FacilityKind, lobby?: LobbyHeightPicker): TemplateResult {
  // The description is display copy, which the catalog leaves to the UI.
  const f = { ...catalogFacility(catalog, kind), description: facilityDescription(kind, catalog.world) };
  const card = toolInfoTemplate(f, isCommercialKind(kind), groundFloorCost(catalog, kind), noFloorYetCost(catalog, kind));
  return kind === "lobby" && lobby ? html`${card}${lobbyHeightTemplate(catalog, lobby)}` : card;
}

/** The lobby tool card's height choice (#308): the height picked, and the
 *  pick itself, which redraws the card. */
export interface LobbyHeightPicker {
  readonly picked: number;
  pick(height: number): void;
}

/** The Lobby card's height picker (#308): one to the catalog's
 *  `maxLobbyHeight` stories, which floors may rise (the catalog's
 *  `tallSkyLobbies`), the price per story, and the original's keys. */
export function lobbyHeightTemplate(catalog: Catalog, lobby: LobbyHeightPicker): TemplateResult {
  const where = catalog.rules.tallSkyLobbies ? "The ground lobby and sky lobbies can rise." : "Only the ground lobby can rise.";
  const per = groupDigits(catalogFacility(catalog, "lobby").cost);
  return html`<div class="ti-lobby-height" role="group" aria-label="Lobby height">Height: ${lobbyHeightButtons(catalog, lobby)}</div><p style="margin-top:6px;color:var(--muted)">${where} A floor's first lobby sets its height, and it never changes after. Each story costs $${per} a tile. On a keyboard, hold Ctrl for 2 stories or Ctrl+Shift for 3 as you place it.</p>`;
}

/** One button per height, one to the catalog's `maxLobbyHeight` stories, the
 *  picked one pressed. Shared by the Lobby card and the phone's strip. */
export function lobbyHeightButtons(catalog: Catalog, lobby: LobbyHeightPicker): TemplateResult[] {
  const heights = Array.from({ length: catalog.rules.maxLobbyHeight }, (_, i) => i + 1);
  const label = (h: number) => (h === 1 ? "1 story" : `${h} stories`);
  return heights.map(
    (h) =>
      html`<button type="button" class="btn${lobby.picked === h ? " es-on" : ""}" aria-pressed=${lobby.picked === h} @click=${() => lobby.pick(h)}>${label(h)}</button>`,
  );
}

/** The Bulldoze card's "Drag clears" choice: one kind (#644), or everything. */
export interface BulldozeDragPicker {
  readonly clears: DragClears;
  pick(clears: DragClears): void;
}

/** The Bulldoze card: what a click sells, and what a drag clears. */
export function bulldozeToolInfo(drag: BulldozeDragPicker): TemplateResult {
  const hint =
    drag.clears === "one kind"
      ? "A drag removes only the kind of thing it starts on, so a sweep along a floor leaves the elevators and rooms it crosses."
      : "A drag removes everything it crosses that can come out.";
  return html`<div class="ti-name">Bulldoze</div><p style="color:var(--muted)">Click a room or shaft to sell it for half its cost.</p><div class="ti-drag-clears" role="group" aria-label="Drag clears">Drag clears: ${bulldozeDragButtons(drag)}</div><p style="margin-top:6px;color:var(--muted)">${hint}</p>`;
}

/** The two "Drag clears" buttons, the picked one pressed. Shared by the
 *  Bulldoze card and the phone's strip. */
export function bulldozeDragButtons(drag: BulldozeDragPicker): TemplateResult[] {
  const choices: readonly [DragClears, string][] = [
    ["one kind", "One kind"],
    ["everything", "Everything"],
  ];
  return choices.map(
    ([clears, label]) =>
      html`<button type="button" class="btn${drag.clears === clears ? " es-on" : ""}" aria-pressed=${drag.clears === clears} @click=${() => drag.pick(clears)}>${label}</button>`,
  );
}

export const INSPECT_TOOL_INFO: TemplateResult = html`<div class="ti-name">Inspect</div><p style="color:var(--muted)">Hover the tower to read a facility's status.</p>`;

/** The ground-floor price on the card: what the tool lays on the ground floor
 *  when that differs from the tool's own kind (the Floor tool lays a lobby).
 *  A current game has no plain floor there, so the tile pays for its floor
 *  too (catalogTileCost). */
function groundFloorCost(catalog: Catalog, kind: FacilityKind): number | undefined {
  const laid = catalogBuildKind(catalog, kind, catalog.world.groundFloor);
  return laid === kind ? undefined : catalogTileCost(catalog, laid, "no floor yet");
}

/** The price of the tool's own tile where there is no floor yet, when that
 *  differs from its `Cost` line (a lobby pays for the floor it lays). */
function noFloorYetCost(catalog: Catalog, kind: FacilityKind): number | undefined {
  const bare = catalogTileCost(catalog, kind, "no floor yet");
  return bare === catalogFacility(catalog, kind).cost ? undefined : bare;
}
