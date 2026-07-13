import type { Simulation } from "../engine/Simulation";
import { TRANSPORT_FAR_TILES, VACATE_RESCIND } from "../engine/Simulation";
import { COMMERCIAL_LOBBY_FLOORS, TRAFFIC_FACTOR_MEAN } from "../engine/EconomySystem";
import { FACILITIES, isCommercialKind, isElevatorKind, isHotelKind } from "../engine/facilities";
import { ECON } from "../engine/econConfig";
import { subtypeListFor } from "../engine/retailSubtypes";
import { isOperational, VACATE_REASON_TEXT } from "../engine/types";
import type { FacilityKind, Transport, Unit } from "../engine/types";
import { escapeHtml } from "../ui/escape";

/**
 * The per-facility DIAGNOSTIC lines: access reachability, placement warnings,
 * on-notice countdown, recycling capacity, and the retail patronage block.
 *
 * Shared by the desktop hover inspector card ({@link InspectorController}) and
 * the mobile editor panel, which folds these lines in so a phone shows one rich
 * panel instead of a stuttering card-plus-editor pair. Keeping the block in ONE
 * place is the point: the two surfaces can never drift on what a facility's
 * warnings say. Pure functions of (sim, unit), no DOM, so they unit-test
 * without a game shell.
 */

/** The shared demand line for parking spaces & ramps: how many working spaces
 *  the tower has (`have`, passed in so the caller's single flood-fill is reused)
 *  vs what its offices (1 per ~24 workers) and suites (1 each) currently need. */
function parkingDemandLine(sim: Simulation, have: number): string {
  const d = sim.parkingDemand();
  const color = have < d.total ? "var(--bad)" : "var(--good)";
  return `<div style="color:${color}">Demand: ${have}/${d.total} spaces (${d.offices} for offices, ${d.suites} for suites).</div>`;
}

/** The recycling block: current fill and the capacity/demand verdict.
 *  Population and capacity are each scanned once and reused across the strings
 *  (the demand-met check is `pop <= cap`, exactly {@link Simulation.recyclingDemandMet}),
 *  so a hover doesn't rescan the unit list several times over. */
function recyclingLine(sim: Simulation): string {
  const pop = sim.tower.totalPopulation();
  const cap = sim.recyclingCapacity();
  const fillPct = Math.round(sim.recyclingFill() * 100);
  return (
    `<div>Fill: ${fillPct}%. Truck collects each morning.</div>` +
    (pop <= cap
      ? `<div style="color:var(--good)">Capacity: ${pop.toLocaleString()}/${cap.toLocaleString()} population; demand met.</div>`
      : `<div style="color:var(--bad)">Over capacity: ${pop.toLocaleString()} population vs ${cap.toLocaleString()} processed. Build another center (4★ requires demand met).</div>`)
  );
}

/** The retail-only block: today's customer count, the tier verdict vs baseline,
 *  yesterday's profit, and a rain note when weather is dragging down traffic.
 *  Kept as a pure function so the HTML is exercised by unit tests without a DOM
 *  shell (see `inspectorRetailStats.test.ts`). The tier bands were tuned in the
 *  party consult (Samus, Cloud, Sally, 2026-07-09); see the spec's Player-Facing
 *  Copy section for the canonical strings. */
export function retailStatsLines(
  kind: FacilityKind,
  patronageToday: number | undefined,
  patronageYest: number | undefined,
  profitYest: number | undefined,
  isRaining: boolean,
): string {
  const spend = ECON.retailSpendPerCustomer[kind];
  const daily = ECON.dailyTrafficIncome[kind];
  if (spend === undefined || spend <= 0 || daily === undefined) return "";
  // The reference is an "average good day": a venue at full appeal, well placed,
  // on a dry day. `daily / spend` is the theoretical ceiling where every hourly
  // multiplier is 1, but the foot-traffic factor averages TRAFFIC_FACTOR_MEAN
  // (0.8), never 1, so real patronage tops out around that fraction of the
  // ceiling. Baking the mean into the baseline keeps the verdict measuring the
  // levers a player controls (appeal, placement, weather) rather than the daily
  // dice; otherwise the top band was unreachable and the green verdict was dead
  // code.
  const baseline = (daily / spend) * TRAFFIC_FACTOR_MEAN;
  const today = Math.max(0, patronageToday ?? 0);
  // The "Today's patronage" number is the running count so far today; its bar
  // fills as the trading day progresses (a progress indicator, not a verdict).
  const barWidth = Math.min(100, Math.round((baseline > 0 ? today / baseline : 0) * 100));
  const custRounded = Math.round(today);
  // The VERDICT judges the last COMPLETED day (`patronageYest`), never the
  // partial current day: `patronageToday` resets to 0 at the midnight rollover,
  // so scoring the current day would flash a false red "Very few customers." on
  // a booming shop hovered in the early hours before it has traded. Until the
  // first rollover gives a full day of data, the venue reads "just opened".
  // 3-band against the average-good-day baseline: <0.5 red (appeal, placement,
  // or weather is dragging trade well below par), 0.5-0.85 neutral, >0.85 green
  // (near-ideal conditions: high appeal, well placed, dry). A mature tower with
  // a metro pushes appeal to 1, so the green band is genuinely reachable.
  const yRatio = patronageYest === undefined ? undefined : baseline > 0 ? Math.max(0, patronageYest) / baseline : 0;
  const tier =
    yRatio === undefined
      ? { color: "", verdict: "Just opened, no data yet." }
      : yRatio < 0.5
        ? { color: "var(--bad)", verdict: "Very few customers." }
        : yRatio > 0.85
          ? { color: "var(--good)", verdict: "Business is booming." }
          : { color: "", verdict: "Business is average." };
  // Yesterday's line is skipped on day 1 (no rollover yet) so the card doesn't
  // read "$0" for a fresh tower. Once at least one rollover has fired the
  // field is defined (>= 0) and the line shows even when yesterday earned
  // nothing (a genuine slow day is honest to name).
  const yestLine =
    patronageYest !== undefined || profitYest !== undefined
      ? `<div>Yesterday's profit: $${Math.round(Math.max(0, profitYest ?? 0)).toLocaleString()}.</div>`
      : "";
  const rainLine = isRaining ? `<div>Rain might cause fewer customers.</div>` : "";
  return (
    `<div>Today's patronage: ${custRounded.toLocaleString()} customer${custRounded === 1 ? "" : "s"}` +
    ` <span class="evalbar"><span style="width:${barWidth}%"></span></span></div>` +
    `<div${tier.color ? ` style="color:${tier.color}"` : ""}>${tier.verdict}</div>` +
    yestLine +
    rainLine
  );
}

/**
 * The concatenated diagnostic lines for a unit, in card order: access, hotel
 * star-count, parking ramp/demand, office long-walk, commercial lobby distance,
 * recycling capacity, the on-notice countdown, and the retail patronage block.
 * Any line that does not apply returns "", so the result is empty for a plain,
 * well-placed, non-retail unit with nothing to warn about.
 */
export function facilityDiagnostics(sim: Simulation, u: Unit): string {
  const f = FACILITIES[u.kind];
  // Access — the whole truth, not just "served": a floor can be connected yet
  // sit 3+ rides from the lobby, in which case no commuter ever comes. Only
  // shown for units that actually draw commuters/visitors (tenants + venues);
  // parking/service work via ramp-chaining/coverage, not passenger trips, so
  // an access warning on them would be a false alarm.
  const needsAccess = f.population > 0 || ECON.dailyTrafficIncome[u.kind] !== undefined;
  const served = sim.tower.isFloorServed(u.floor);
  const access = !needsAccess
    ? ""
    : !served
      ? `<div style="color:var(--bad)">Access: not connected. No elevator or stair reaches this floor.</div>`
      : sim.floorReachable(u.floor)
        ? `<div style="color:var(--good)">Access: reachable (≤2 rides from the lobby).</div>`
        : `<div style="color:var(--bad)">Access: too far. 3+ rides from the lobby, so no one travels here. Add a sky-lobby transfer.</div>`;
  // Silent rule: hotel guests stop counting toward the star rating at 4★.
  const hotel = isHotelKind(u.kind)
    ? sim.hotelsCountTowardRating()
      ? `<div style="color:var(--good)">Counts toward stars: yes.</div>`
      : `<div style="color:var(--bad)">Counts toward stars: no. Hotel guests stop counting at 4★ (they still earn income).</div>`
    : "";
  // Silent rule: a parking space only works when it chains to a ramp. Skip
  // the verdict while it's still building (or on fire) — "Status" covers that.
  // One flood-fill for the whole parking card: its `.has(id)` gives ramp
  // connectivity and its `.size` feeds the demand line, so a hover never
  // runs the fill twice.
  const parkingSet =
    (u.kind === "parking" || u.kind === "parkingRamp") && isOperational(u)
      ? sim.tower.functionalParkingSet()
      : null;
  const parking = !parkingSet
    ? ""
    : u.kind === "parkingRamp"
      ? parkingDemandLine(sim, parkingSet.size)
      : parkingSet.has(u.id)
        ? `<div style="color:var(--good)">Ramp access: connected.</div>` + parkingDemandLine(sim, parkingSet.size)
        : `<div style="color:var(--bad)">Ramp access: none. This space is dead (no relief). Chain it to a Parking Ramp.</div>`;
  // W1: a served office whose nearest stairs/elevator is beyond the walking
  // tolerance is silently eroding — surface it always (like the W3 line below),
  // not only once the tenant is already on notice, and name the concrete fix.
  const walkFar =
    u.kind === "office" &&
    u.floor !== 1 &&
    sim.tower.isFloorServed(u.floor) &&
    sim.tower.nearestTransportDistance(u) > TRANSPORT_FAR_TILES
      ? `<div style="color:var(--bad)">Long walk to transport. Tenants tire of the hike. Put a stairway, escalator, or passenger elevator within reach.</div>`
      : "";
  // W3: a canon commercial venue (not partyHall) more than two floors from a
  // (sky) lobby loses half its shoppers. Name the ACHIEVABLE fix — lobbies only
  // go on the ground and every 15th floor, so "add a lobby here" is usually
  // impossible; the real move is to sit within 2 floors of one of those levels.
  const commercialLobby =
    isCommercialKind(u.kind) && sim.tower.nearestLobbyFloorDistance(u.floor) > COMMERCIAL_LOBBY_FLOORS
      ? `<div style="color:var(--bad)">Shoppers: too far from a lobby. Traffic is halved. Keep it within 2 floors of the ground or a sky lobby (every 15th floor).</div>`
      : "";
  // Recycling runs on demand: how full it is right now, and whether the
  // tower has outgrown its centers (the canon 4★ gate).
  const recycling = u.kind === "recycling" && isOperational(u) ? recyclingLine(sim) : "";
  // A tenant on notice: spell out that they're leaving, why, how long is left,
  // and the exact recovery bar they must clear — the "inform before you hurt
  // them" contract, so the eviction is never a surprise. The countdown and the
  // current-vs-target read recompute on every render, so they tick down live as
  // the game clock advances. A relocation is a life event (Modern condos), not a
  // complaint: the player cannot keep them by fixing the tower, so the block
  // drops the recovery-bar line and says plainly what happens instead.
  const isRelocation = u.state === "vacating" && u.vacateReason === "relocation";
  let notice = "";
  if (u.state === "vacating" && u.vacateReason) {
    const minsLeft = Math.max(0, (u.vacateAt ?? 0) - sim.clock.minutes);
    // Framed as an honest UPPER bound ("under N") using ceil, so the block
    // never implies the tenant has *more* time than they do. Once the notice
    // has elapsed, say so plainly — they leave on the next hourly tick.
    const left =
      minsLeft <= 0
        ? "any moment now"
        : minsLeft >= 24 * 60
          ? `in under ${Math.ceil(minsLeft / (24 * 60))} day(s)`
          : `in under ${Math.ceil(minsLeft / 60)} hour(s)`;
    if (isRelocation) {
      notice =
        `<div style="color:var(--bad)">${escapeHtml(VACATE_REASON_TEXT[u.vacateReason])}. Leaves ${left}.</div>` +
        `<div>A life event, so you cannot keep them. You buy the unit back to re-sell.</div>`;
    } else {
      const now = Math.round(u.satisfaction * 100);
      const target = Math.round(VACATE_RESCIND * 100);
      notice =
        `<div style="color:var(--bad)">Giving notice: ${escapeHtml(VACATE_REASON_TEXT[u.vacateReason])}. Leaves ${left}.</div>` +
        `<div>Fix the cause and get satisfaction to ${target}% to keep them (now ${now}%).</div>`;
    }
  }
  // Retail-only patronage / profit block (shop / fastFood / restaurant): shown
  // for every OPERATIONAL retail venue; a legacy unit (from a save predating the
  // fields) still gets it, reading "just opened" until it trades. Only a gutted
  // / on-fire / mid-build venue is skipped, via the isOperational gate.
  const retailStats =
    subtypeListFor(u.kind) !== null && isOperational(u) && ECON.dailyTrafficIncome[u.kind] !== undefined && ECON.retailSpendPerCustomer[u.kind] !== undefined
      ? retailStatsLines(u.kind, u.patronageToday, u.patronageYest, u.profitYest, sim.weather === "rain")
      : "";
  return access + hotel + parking + walkFar + commercialLobby + recycling + notice + retailStats;
}

/**
 * The transport diagnostic line: how full a passenger elevator's cars run on
 * average, with a near-capacity nudge. Staff-only service elevators carry no
 * passenger load and stairs/escalators have none, so both return "". Shared by
 * the hover card and the mobile transport editor.
 */
export function transportDiagnostics(sim: Simulation, t: Transport): string {
  const util = isElevatorKind(t.kind) ? sim.elevatorUtilization(t.id) : undefined;
  return util === undefined
    ? ""
    : `<div style="color:${util > 0.85 ? "var(--bad)" : "var(--good)"}">Avg load: ${Math.round(util * 100)}% full${util > 0.85 ? ". Near capacity; consider more cars or a parallel shaft." : ""}</div>`;
}
