import { html, nothing, type TemplateResult } from "lit-html";
import type { Catalog } from "../../engine/catalogTypes";
import { iconTemplate } from "../icons";
import { LEDGER_CATS, LEDGER_LABELS } from "../../engine/Ledger";
import { MILESTONES } from "../../engine/milestones";
import { floorTag } from "../format";
import { clockOf, rulesOf } from "../../simport/headerClock";
import type { ElevatorStatsRow, NextStarView, StarGateId, StatsReport } from "../../simport/panels";
import type { HeaderView } from "../../simport/view";

/**
 * The Tower Statistics dialog body as a lit template. It was authored to match
 * the retired `buildStatsHtml` string builders structurally, proven by
 * transitional `assertDomEquivalent` guards across many sim configurations
 * before those builders were deleted in the final sweep (see git history).
 *
 * E3-S5 decision (recorded in the backlog): the "worst string-composition case"
 * is migrated FULLY to nested `TemplateResult`s rather than left as an imperative
 * `innerHTML` blob. This keeps a single rendering path (lit everywhere) and
 * avoids any `unsafeHTML`. Every string interpolation that used `escapeHtml`
 * (tower name, elevator labels, milestone label/desc) is auto-escaped by lit;
 * the numbers and static copy carried over verbatim.
 *
 * A pure function of what the engine answered (the `statsReport` query, facade
 * slice 4) plus the view's header and the tower's catalog, so it reads the
 * same numbers whichever engine runs the tower, and unit-tests headlessly.
 */

/** What the stats screen is drawn from. */
export interface StatsScreen {
  readonly report: StatsReport;
  /** The header fields the screen reads: the date and the rule set. */
  readonly header: Pick<HeaderView, "minutes" | "mode" | "modernCalendar">;
  readonly towerName: string;
  readonly catalog: Catalog;
}

/** The screen for a stats report, the port's view and the tower's catalog:
 *  the one place the game (`showStats`) and the tests put it together. */
export function statsScreen(
  report: StatsReport,
  view: { readonly header: StatsScreen["header"]; readonly tower: { readonly towerName: string } },
  catalog: Catalog,
): StatsScreen {
  return { report, header: view.header, towerName: view.tower.towerName, catalog };
}

/** The stats modal shell: the heading, the sim-derived body, and Close. */
export function statsModalTemplate(body: TemplateResult): TemplateResult {
  return html`<h2>Tower Statistics</h2>${body}
      <div class="modal-actions"><button class="btn primary" data-act="close">Close</button></div>`;
}

/** True when the stats modal should offer the "Call exterminator" action:
 *  Modern (an exterminator exists), at least one infested room, and no dispatch
 *  already en route. Shared by the template (to render the button) and `main`
 *  (to wire its handler) so the two can never disagree, which matters because
 *  `wireActions` throws if it binds a handler to a button that was not rendered. */
export function canCallExterminator(report: Pick<StatsReport, "housekeeping" | "exterminationDueDay">, catalog: Catalog): boolean {
  return catalog.economy.exterminator !== null && report.exterminationDueDay === null && report.housekeeping.infested > 0;
}

/** Each star gate's line on the "Next" checklist, keyed by the id the engine
 *  answers (the TypeScript `star.ts` carries the same labels; a test pins the
 *  two together). */
export const STAR_GATE_LABELS: Readonly<Record<StarGateId, string>> = {
  security: "Security office",
  medical: "Medical center",
  recycling: "Recycling meets demand",
  suites: "2+ hotel suites",
  vip: "Favorable VIP review",
  metro: "Metro station",
  weddingHall: "Wedding Hall (floor 100)",
};

/** Each milestone's label and description, keyed by id. */
const MILESTONE_COPY = new Map(MILESTONES.map((m) => [m.id as string, m]));

export function statsTemplate(screen: StatsScreen): TemplateResult {
  const { report, catalog } = screen;
  const s = report.stats;
  const c = clockOf(screen.header);
  const next = report.nextStarThreshold;
  const fmt = (n: number) => n.toLocaleString();
  // Modal-only diagnostics (a full scan and a flood-fill) arrive in the
  // report the modal asks for when it opens, so they never run on the ~6 Hz
  // HUD stats() path.
  const ratingPop = report.ratingPopulation;
  const parkingWorking = report.functionalParking;
  const parkingDemand = report.parkingDemand;
  const hk = report.housekeeping;
  // The "enough housekeeping" verdict keys on what actually happened: rooms
  // that survived yesterday's whole shift dirty (observed shortfall), rooms no
  // crew can reach, and any active infestation, which is an at-risk state and
  // never reads green whatever the throughput math says. The nominal
  // maids-times-anchor comparison stays on as a gross-under-provision floor
  // (it also covers the window between a big hotel build-out and the next
  // morning's latched report); it is an optimistic best case, so it never
  // subtracts the infested rooms out of the workload (that discount is how
  // the old readout said "enough" while a wing rotted).
  const hkReport = report.housekeepingReport;
  const hkShort =
    hk.rooms > 0 &&
    (hk.infested > 0 || hk.outOfReach > 0 || (hkReport?.leftover ?? 0) > 0 || hk.dailyCapacity < hk.rooms);
  const extermRecovery = catalog.economy.exterminator;
  const extermPending = report.exterminationDueDay !== null;
  const extermCost = extermRecovery ? extermRecovery.calloutFee + extermRecovery.perRoomFee * hk.infested : 0;
  const recyclingCap = report.recycling.capacity;
  const recyclingShort = !report.recycling.demandMet;
  const stranded = report.strandedFloors.length;
  // Only when hotels have dropped out of the rating (4★+) and actually diverge.
  const ratingRow =
    s.star >= 4 && ratingPop < s.population
      ? html`<span class="k">Counts toward stars</span><span class="v">${fmt(ratingPop)}</span>`
      : nothing;
  // VIPs start calling at 3★, so the row appears with them (or with any
  // recorded visit, so a loaded late-game tower always shows its history).
  // The review verdict trusts vipFavorable alone (it is what gates 4★), so a
  // favorable flag with no recorded visits (fixtures, tampered saves) still
  // reads "Review earned" in the good color; only the count goes unspoken.
  const { vipVisits, vipFavorable } = report;
  let vipText: string;
  if (vipVisits === 0) vipText = vipFavorable ? "Review earned" : "None yet";
  else vipText = `${fmt(vipVisits)} · review ${vipFavorable ? "earned" : "not yet earned"}`;
  const vipRow =
    vipVisits > 0 || vipFavorable || s.star >= 3
      ? html`<span class="k">VIP visits</span><span class="v" style="color:${vipFavorable ? "var(--good)" : "var(--muted)"}">${vipText}</span>`
      : nothing;
  // En-route beats the call-to-action; with no infestation either way, no row.
  let extermRow: TemplateResult | typeof nothing = nothing;
  if (extermPending)
    extermRow = html`<div class="col kv"><span class="k">Exterminator</span><span class="v" style="color:var(--muted)">en route: the booked rooms clear tomorrow</span></div>`;
  else if (canCallExterminator(report, catalog))
    extermRow = html`<div class="modal-actions"><button type="button" class="btn" data-act="exterminate">Call exterminator: $${fmt(extermCost)} for ${fmt(hk.infested)} room(s)</button></div>`;
  return html`<div class="stats-grid">
      <div class="stats-section win-title sm">Overview</div>
      <div class="col kv">
        <span class="k">Tower name</span><span class="v">${screen.towerName}</span>
        <span class="k">Rating</span><span class="v stars">${s.star >= 6 ? "TOWER" : s.star + "★"}</span>
        <span class="k">Population</span><span class="v">${fmt(s.population)}</span>
        ${ratingRow}
        <span class="k">Next star at</span><span class="v">${next ? fmt(next) : "—"}</span>
        ${vipRow}
        <span class="k">Funds</span><span class="v ${s.money < 0 ? "loss" : "money"}">$${fmt(Math.round(s.money))}</span>
        <span class="k">Date</span><span class="v">${c.dayName}, day ${c.day + 1}</span>
      </div>
      <div class="col kv">
        <span class="k">Floors above</span><span class="v">${s.floors}</span>
        <span class="k">Basements</span><span class="v">${s.basements}</span>
        <span class="k">Elevators</span><span class="v">${s.elevators}</span>
        <span class="k">All transports</span><span class="v">${s.transports}</span>
      </div>
      ${nextStarSection(report.nextStar)}
      <div class="stats-section win-title sm">Tenancy</div>
      <div class="col kv">
        <span class="k">Offices</span><span class="v">${s.occupiedOffices}/${s.offices}</span>
        <span class="k">Condos sold</span><span class="v">${s.soldCondos}/${s.condos}</span>
        <span class="k">Vacancies</span><span class="v">${s.vacant}${s.vacantNoRate ? ` (${s.vacantNoRate} off-market)` : ""}</span>
      </div>
      <div class="col kv">
        <span class="k">Hotel rooms in use</span><span class="v">${s.occupiedHotel}/${s.hotelRooms}</span>
        <span class="k">Rooms to clean</span><span class="v" style="color:${s.dirty ? "var(--bad)" : "var(--good)"}">${s.dirty}</span>
        ${
          hk.rooms > 0
            ? html`<span class="k">Housekeeping</span><span class="v" style="color:${hkShort ? "var(--bad)" : "var(--good)"}">${fmt(hk.crews)} crew${hk.crews === 1 ? "" : "s"} (${fmt(hk.maids)} maid${hk.maids === 1 ? "" : "s"}) for ${fmt(hk.rooms)} room(s)${hkReport && hkReport.leftover > 0 ? `, ${fmt(hkReport.leftover)} unserved yesterday` : ""}${hk.infested > 0 ? `, ${fmt(hk.infested)} infested` : ""}${hk.outOfReach > 0 ? `, ${fmt(hk.outOfReach)} out of reach` : ""}</span>`
            : nothing
        }
        ${
          hk.infested > 0
            ? html`<span class="k">Infested</span><span class="v" style="color:var(--bad)">${fmt(hk.infested)} (${extermRecovery ? "exterminate or bulldoze" : "bulldoze to clear"})</span>`
            : nothing
        }
        <span class="k">Shops / Food</span><span class="v">${s.shops} / ${s.restaurants}</span>
        <span class="k">On fire</span><span class="v" style="color:${s.fires ? "var(--bad)" : "var(--good)"}">${s.fires || "None"}</span>
      </div>
      ${extermRow}
      ${rulesOf(screen.header).hasVariantHouseholds ? householdSection(report.households) : nothing}
      <div class="stats-section win-title sm">Transport &amp; access</div>
      <div class="col kv">
        <span class="k">Stranded floors</span><span class="v" style="color:${stranded ? "var(--bad)" : "var(--good)"}">${stranded || "None"}</span>
        ${
          s.parkingSpaces > 0
            ? html`<span class="k">Parking spaces</span><span class="v" style="color:${parkingWorking < s.parkingSpaces ? "var(--bad)" : "var(--good)"}">${parkingWorking} / ${s.parkingSpaces} working</span>`
            : nothing
        }
        ${
          s.parkingSpaces > 0 || parkingDemand.total > 0
            ? html`<span class="k">Parking demand</span><span class="v" style="color:${parkingWorking < parkingDemand.total ? "var(--bad)" : "var(--good)"}">${fmt(parkingDemand.total)} needed (${fmt(parkingDemand.offices)} offices + ${fmt(parkingDemand.suites)} suites)</span>`
            : nothing
        }
        ${
          recyclingCap > 0 || (s.star >= 3 && recyclingShort)
            ? html`<span class="k">Recycling</span><span class="v" style="color:${recyclingShort ? "var(--bad)" : "var(--good)"}">${
                recyclingCap === 0
                  ? `${fmt(s.population)} population, no center (build one)`
                  : `${fmt(s.population)} / ${fmt(recyclingCap)} processed${recyclingShort ? " (build more)" : ""}`
              }</span>`
            : nothing
        }
      </div>
      ${
        stranded || ratingRow !== nothing
          ? html`<div class="col kv">${
              stranded
                ? html`<span class="k" style="color:var(--muted);grid-column:1/-1">Stranded = leased floors reachable only by a long stair climb no one will make; they earn rating but draw no visitors. Add an elevator that reaches them.</span>`
                : nothing
            }${
              ratingRow !== nothing
                ? html`<span class="k" style="color:var(--muted);grid-column:1/-1">Hotel guests count toward your star rating until you reach 4★; after that, only office and condo occupants and venue customers do (hotel guests stay excluded, even while dining). Your rating won't drop, and hotels still earn income.</span>`
                : nothing
            }</div>`
          : nothing
      }
      ${incomeSection(report.income)}
      ${elevatorSection(report.elevators)}
      ${milestonesSection(report.milestones)}
    </div>`;
}

/** Passenger-elevator utilization, busiest shaft first, mirroring
 *  the retired string builder. */
export function elevatorSection(shafts: StatsReport["elevators"]): TemplateResult | typeof nothing {
  if (shafts.length === 0) return nothing;
  const kindName: Record<string, string> = {
    elevatorStandard: "Standard",
    elevatorExpress: "Express",
  };
  const row = (sh: ElevatorStatsRow): TemplateResult => {
    const pct = Math.round(sh.utilization * 100);
    let color = "var(--good)";
    if (pct > 85) color = "var(--bad)";
    else if (pct < 10) color = "var(--muted)";
    const label = `${kindName[sh.kind] ?? "Elevator"} ${floorTag(sh.bottom)}–${floorTag(sh.top)}`;
    return html`<span class="k">${label} · ${sh.cars} car${sh.cars === 1 ? "" : "s"}</span><span class="v" style="color:${color}">${pct}% full</span>`;
  };
  // Cap the list so a tower packed with shafts doesn't blow out the modal.
  const shown = shafts.slice(0, 8);
  const half = Math.ceil(shown.length / 2);
  const col = (items: typeof shown) => html`<div class="col kv">${items.map(row)}</div>`;
  return html`<div class="stats-section win-title sm">Elevators (avg load, busiest first)</div>${col(shown.slice(0, half))}${col(shown.slice(half))}`;
}

/** The per-category income breakdown, the lone renderer since the string builders retired. */
export function incomeSection({ averages, hasData }: StatsReport["income"]): TemplateResult | typeof nothing {
  if (!hasData) return nothing;
  const money = (n: number) => {
    const r = Math.round(n);
    return `${r < 0 ? "-" : ""}$${Math.abs(r).toLocaleString()}`;
  };
  const rows = LEDGER_CATS.map((cat) => ({ cat, avg: averages[cat] }))
    // Hide lines that never moved (e.g. no condos built), but always show a
    // category that has any activity, positive or negative.
    .filter((r) => Math.round(r.avg) !== 0)
    .sort((a, b) => b.avg - a.avg);
  if (rows.length === 0) return nothing;
  // Net sums only the lines actually shown: a sub-$0.50/day category is hidden
  // from the list AND excluded here, so a near-zero line can't silently nudge
  // Net away from the visible rows.
  const net = rows.reduce((sum, r) => sum + r.avg, 0);
  const line = (label: string, avg: number, bold = false): TemplateResult =>
    html`<span class="k${bold ? " win-title sm" : ""}">${label}</span><span class="v" style="color:${avg < 0 ? "var(--bad)" : "var(--good)"}${bold ? ";font-weight:600" : ""}">${money(avg)}/day</span>`;
  const half = Math.ceil(rows.length / 2);
  const col = (items: typeof rows) => html`<div class="col kv">${items.map((r) => line(LEDGER_LABELS[r.cat], r.avg))}</div>`;
  return html`<div class="stats-section win-title sm">Income (avg / day, last quarter)</div>${col(rows.slice(0, half))}<div class="col kv">${rows.slice(half).map((r) => line(LEDGER_LABELS[r.cat], r.avg))}${line("Net", net, true)}</div>`;
}

/**
 * Modern-only "Households" readout, mirroring `householdSection`. Gated by the
 * caller (only rendered when the rule set has variant households). The engine
 * counts every home actually in residence (a condo or a rental Apartment,
 * sized through the census's own seam); a Studio is a single occupant with no
 * household, so it stays out of the size histogram.
 */
function householdSection({ households, residents, mix: sizes }: StatsReport["households"]): TemplateResult {
  const head = html`<div class="stats-section win-title sm">Households</div>`;
  if (households === 0) {
    return html`${head}<div class="col kv"><span class="k" style="color:var(--muted);grid-column:1/-1">No households yet. Each condo sale or Apartment lease draws a 2–5 person family. (A leased Studio is a single occupant, counted in the population but not here.)</span></div>`;
  }
  const avg = (residents / households).toFixed(1);
  const mix = sizes.map(([sz, n]) => `${sz}p × ${n}`).join(" · ");
  return html`${head}<div class="col kv"><span class="k">People housed</span><span class="v">${residents.toLocaleString()}</span><span class="k">Avg household</span><span class="v">${avg}</span></div><div class="col kv"><span class="k">Size mix</span><span class="v">${mix}</span></div>`;
}

/**
 * The "what is blocking my next star" checklist: the population bar plus the
 * facility gates for the next rung. Driven by the engine's answer (the stats
 * report's `nextStar`), which mirrors the promotion gates, so the checklist can
 * never disagree with an actual star-up. Hidden once the tower is a TOWER
 * (nothing above it).
 */
export function nextStarSection(req: NextStarView | null): TemplateResult | typeof nothing {
  if (!req) return nothing;
  const fmt = (n: number) => n.toLocaleString();
  const goal = req.isTower ? "TOWER" : `${req.star}★`;
  const mark = (met: boolean) => (met ? "✓" : "·");
  // Coloring rides the shared checklist `ms-done` class (green when met, the
  // muted `.col.nsr .v/.k` default otherwise), so there are no inline color
  // overrides to keep in sync with the theme.
  const rows: TemplateResult[] = [
    html`<span class="k${req.popMet ? " ms-done" : ""}">${mark(req.popMet)} Population</span><span class="v${req.popMet ? " ms-done" : ""}">${fmt(req.popHave)} / ${fmt(req.popNeed)}</span>`,
    ...req.gates.map(
      (g) =>
        html`<span class="k${g.met ? " ms-done" : ""}">${mark(g.met)} ${STAR_GATE_LABELS[g.id] ?? g.id}</span><span class="v${g.met ? " ms-done" : ""}">${g.met ? "Ready" : "Needed"}</span>`,
    ),
  ];
  const head = html`<div class="stats-section win-title sm">Next: ${goal}${
    req.allMet ? html`<span class="nsr-ready"> · ready</span>` : nothing
  }</div>`;
  const half = Math.ceil(rows.length / 2);
  const col = (items: TemplateResult[]) => html`<div class="col nsr kv">${items}</div>`;
  return html`${head}${col(rows.slice(0, half))}${col(rows.slice(half))}`;
}

/** The optional-goals checklist, the lone renderer since the string builders retired. */
export function milestonesSection(mp: StatsReport["milestones"]): TemplateResult {
  const half = Math.ceil(mp.list.length / 2);
  const col = (items: StatsReport["milestones"]["list"]) =>
    html`<div class="col ms kv">${items.map(
      (m) =>
        html`<span class="k${m.done ? " ms-done" : ""}">${m.done ? "✓" : "·"} ${MILESTONE_COPY.get(m.id)?.label ?? m.id}</span><span class="v">${MILESTONE_COPY.get(m.id)?.desc ?? ""}</span>`,
    )}</div>`;
  const pct = mp.total ? Math.round((mp.achieved / mp.total) * 100) : 0;
  return html`<div class="stats-section win-title sm">${iconTemplate("milestone", { size: 14 })}Milestones (${mp.achieved}/${mp.total})<span class="evalbar"><span style="width:${pct}%"></span></span></div>${col(mp.list.slice(0, half))}${col(mp.list.slice(half))}`;
}
