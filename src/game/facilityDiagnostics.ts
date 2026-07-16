import { html, nothing, type TemplateResult } from "lit-html";
import type { Simulation } from "../engine/Simulation";
import { TRANSPORT_FAR_TILES, VACATE_RESCIND, GRIPE_WARN } from "../engine/Simulation";
import { SERVED_RECOVERY } from "../engine/sim/constants";
import { COMMERCIAL_LOBBY_FLOORS, TRAFFIC_FACTOR_MEAN } from "../engine/EconomySystem";
import { FACILITIES, isCommercialKind, isElevatorKind, isHotelKind } from "../engine/facilities";
import { ECON } from "../engine/econConfig";
import { subtypeListFor } from "../engine/retailSubtypes";
import { isOperational, isPresent, VACATE_REASON_TEXT } from "../engine/types";
import type { FacilityKind, Transport, Unit, VacateReason } from "../engine/types";

/**
 * Plain-language phrasing for the pre-notice "Main gripe" inspector line. Only
 * the drains WITHOUT a dedicated diagnostic line above are named here: access
 * ("not connected" / "too far"), the office long-walk (W1), and very-far lobby
 * distance already have their own actionable lines, and a relocation is a life
 * event, so those causes map to nothing and the gripe line stays off (deferring
 * to the dedicated line). Congestion, over-market rent, noise, and unmet local
 * retail demand (#395) have no such line, so they surface here. Each string
 * names the lever the player can pull.
 */
const GRIPE_TEXT: Partial<Record<VacateReason, string>> = {
  congestion: "crowded elevators. Add cars or a parallel shaft to this block.",
  rent: "the rent is above the going rate. Lower it to keep them.",
  noise: "a noisy neighbor. An office or commercial venue sits too close; a lobby tile between them shields it.",
  unmetDemand: "too few shops or restaurants within reach. Add or connect retail near this floor.",
};

/**
 * The per-facility DIAGNOSTIC lines: access reachability, placement warnings,
 * on-notice countdown, recycling capacity, and the retail patronage block.
 *
 * Shared by the desktop hover inspector card ({@link InspectorController}) and
 * the mobile editor panel, which folds these lines in so a phone shows one rich
 * panel instead of a stuttering card-plus-editor pair. Keeping the block in ONE
 * place is the point: the two surfaces can never drift on what a facility's
 * warnings say. Each function returns lit `TemplateResult` lines (an empty array
 * means "no warnings"): a `TemplateResult` is inert data that touches no DOM
 * until a `render()` in `ui/`, so these stay pure functions of (sim, unit) and
 * unit-test without a game shell. lit auto-escapes text bindings, so no
 * `escapeHtml` is needed and no `unsafeHTML` bridge is used at the call sites.
 */

/** The shared demand line for parking spaces & ramps: how many working spaces
 *  the tower has (`have`, passed in so the caller's single flood-fill is reused)
 *  vs what its offices (1 per ~24 workers) and suites (1 each) currently need. */
function parkingDemandLine(sim: Simulation, have: number): TemplateResult {
  const d = sim.parkingDemand();
  const color = have < d.total ? "var(--bad)" : "var(--good)";
  return html`<div style="color:${color}">Demand: ${have}/${d.total} spaces (${d.offices} for offices, ${d.suites} for suites).</div>`;
}

/** The recycling block: current fill and the capacity/demand verdict.
 *  Population and capacity are each scanned once and reused across the lines
 *  (the demand-met check is `pop <= cap`, exactly {@link Simulation.recyclingDemandMet}),
 *  so a hover doesn't rescan the unit list several times over. */
function recyclingLines(sim: Simulation): TemplateResult[] {
  const pop = sim.tower.totalPopulation();
  const cap = sim.recyclingCapacity();
  const fillPct = Math.round(sim.recyclingFill() * 100);
  return [
    html`<div>Fill: ${fillPct}%. Truck collects each morning.</div>`,
    pop <= cap
      ? html`<div style="color:var(--good)">Capacity: ${pop.toLocaleString()}/${cap.toLocaleString()} population; demand met.</div>`
      : html`<div style="color:var(--bad)">Over capacity: ${pop.toLocaleString()} population vs ${cap.toLocaleString()} processed. Build another center (4★ requires demand met).</div>`,
  ];
}

/** Below this raw demand `share` (pool / reachable capacity) the tower reads as
 *  over-built for commerce: its shoppers fill less than half the reachable
 *  commercial capacity, so the Modern inspector advises adding residents or
 *  holding off on new venues. */
const OVER_BUILT_SHARE = 0.5;

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
  demandFraction?: number,
  demandShare?: number,
  advice = false,
): TemplateResult[] {
  const spend = ECON.retailSpendPerCustomer[kind];
  const daily = ECON.dailyTrafficIncome[kind];
  if (spend === undefined || spend <= 0 || daily === undefined) return [];
  // The reference is an "average good day": a venue at full local demand, well
  // placed, on a dry day. `daily / spend` is the raw ceiling where every hourly
  // multiplier is 1, but the foot-traffic factor averages TRAFFIC_FACTOR_MEAN
  // (0.8), never 1, so real patronage tops out around that fraction of the
  // ceiling. This baseline is a STABLE reference (it does not fold in the live
  // demand fraction) so the verdict stays internally consistent day to day:
  // yesterday's patronage is scored against the same yardstick whether or not
  // local demand shifted overnight. The demand-limitation itself is surfaced
  // separately, and honestly, by the "Local demand" line below, so a low verdict
  // reads as "thin local demand here" rather than a mystery.
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
  // Each line is its own `<div>`, in card order: today's running count with its
  // progress bar, the verdict (colored only when it is a red/green tier), then
  // the optional yesterday-profit and rain lines. The verdict's `style` binding
  // resolves to `nothing` on the neutral tier so no `style` attribute is emitted,
  // matching the old string that appended none.
  const lines: TemplateResult[] = [
    html`<div>Today's patronage: ${custRounded.toLocaleString()} customer${custRounded === 1 ? "" : "s"} <span class="evalbar"><span style="width:${barWidth}%"></span></span></div>`,
  ];
  // The venue's share of local demand (commercial demand pools): what fraction of
  // its capacity the reachable population fills. Surfaced so a low customer count
  // reads as "thin local demand here" (add population, or spread venues out)
  // rather than a mystery, and so a venue pinned at 100% reads as fully
  // subscribed. Plain information, shown in both modes; in Modern the under-served
  // / over-built advice rides on top of this number (added just below).
  // Only shown when the fraction is KNOWN (the venue is in the current demand
  // map: reachable and operational). An absent venue, e.g. one that just finished
  // construction and is not yet in this hour's memo, passes `undefined` and omits
  // the line rather than fabricating a misleading "0% of capacity".
  if (demandFraction !== undefined) {
    const demandPct = Math.round(Math.max(0, Math.min(1, demandFraction)) * 100);
    lines.push(html`<div>Local demand: ${demandPct}% of capacity.</div>`);
    // Modern-only advice on top of the demand number: name whether the TOWER is
    // under-served for commerce (its shoppers meet or outstrip the reachable
    // commercial capacity, so more venues would still sell) or over-built (that
    // capacity outstrips the shoppers, so every venue splits a thin pool). The
    // demand model is tower-uniform under lobby-anchored reachability, so the copy
    // speaks about the tower, not "here": naming a local area would overpromise a
    // locality the share does not carry. Classic shows the number only (it
    // withholds advice, never information). Keyed on the raw uncapped `share`, so
    // the Modern floor never masks a genuinely thin tower.
    if (advice && demandShare !== undefined) {
      if (demandShare >= 1) {
        lines.push(html`<div>The tower's shoppers outstrip its retail space; another venue would still sell.</div>`);
      } else if (demandShare < OVER_BUILT_SHARE) {
        // Phrased to hold for a one-venue tower and a zero-pool tower too: "add
        // homes" always lifts the pool, and "hold off on new venues" is the
        // build-side lever. Avoid telling a player to "thin" a single venue,
        // which would mean bulldozing their only shop (and could not lift a pool
        // that is already zero).
        lines.push(html`<div>The tower has more retail than its shoppers fill; add homes, or hold off on new venues, to lift every venue.</div>`);
      }
    }
  }
  lines.push(html`<div style=${tier.color ? `color:${tier.color}` : nothing}>${tier.verdict}</div>`);
  // Yesterday's line is skipped on day 1 (no rollover yet) so the card doesn't
  // read "$0" for a fresh tower. Once at least one rollover has fired the field
  // is defined (>= 0) and the line shows even when yesterday earned nothing.
  if (patronageYest !== undefined || profitYest !== undefined) {
    lines.push(html`<div>Yesterday's profit: $${Math.round(Math.max(0, profitYest ?? 0)).toLocaleString()}.</div>`);
  }
  if (isRaining) lines.push(html`<div>Rain might cause fewer customers.</div>`);
  return lines;
}

/**
 * Whether {@link facilityDiagnostics} emits an access-reachability line for this
 * unit: only kinds that actually draw commuters/visitors (tenants + venues) get
 * one, since parking/service facilities work via ramp-chaining/coverage, not
 * passenger trips, so an access warning on them would be a false alarm. The
 * mobile editor reads this to decide whether its plain "Elevator access" row
 * would just duplicate the diagnostics line (drop it) or is the only
 * connectivity signal for a zero-population service kind (keep it). One source,
 * so the editor and the diagnostics can never disagree on which kinds carry it.
 */
export function hasAccessDiagnostic(u: Unit): boolean {
  const f = FACILITIES[u.kind];
  return f.population > 0 || ECON.dailyTrafficIncome[u.kind] !== undefined;
}

/**
 * The diagnostic lines for a unit, in card order: access, hotel star-count,
 * parking ramp/demand, office long-walk, commercial lobby distance, recycling
 * capacity, the on-notice countdown, and the retail patronage block. Each line
 * is a lit `TemplateResult`; a rule that does not apply pushes nothing, so the
 * returned array is empty for a plain, well-placed, non-retail unit with nothing
 * to warn about.
 */
export function facilityDiagnostics(sim: Simulation, u: Unit): TemplateResult[] {
  // Built in card order: access, hotel, parking, walk-far, commercial-lobby,
  // recycling, notice, retail. Any rule that does not apply pushes nothing, so
  // the array is empty for a plain, well-placed unit with nothing to warn about.
  const lines: TemplateResult[] = [];
  // Access is the whole truth, not just "served": a floor can be connected yet
  // have no admissible two-ride route from the lobby (3+ rides out, or, in
  // Classic, its only path leans on an express transfer at a plain floor), in
  // which case no commuter ever comes.
  if (hasAccessDiagnostic(u)) {
    lines.push(
      !sim.tower.isFloorServed(u.floor)
        ? html`<div style="color:var(--bad)">Access: not connected. No elevator or stair reaches this floor.</div>`
        : sim.floorReachable(u.floor)
          ? html`<div style="color:var(--good)">Access: reachable (≤2 rides from the lobby).</div>`
          : html`<div style="color:var(--bad)">Access: too far. No route from the lobby within two rides, so no one travels here. Add a sky-lobby transfer.</div>`,
    );
  }
  // No Rate (off-market) legibility: a chosen setting, so plain ink, neither
  // --good nor --bad. The occupied line states the census fact out loud on
  // purpose (free tenants still count is canon, the 1994 cheap-rent lever
  // endpoint), so it never reads as a bug later. Sits after the access line
  // and before the on-notice block, so a No Rate unit that is ALSO on notice
  // shows both truthfully (ux-pricing-split-editor §2.2).
  if (u.noRate) {
    lines.push(
      isPresent(u)
        ? html`<div>No Rate: the tenant stays, pays nothing, and still counts toward stars.</div>`
        : html`<div>Off the market: No Rate. No one moves in until you set a rate.</div>`,
    );
  }
  // Silent rule: hotel guests stop counting toward the star rating at 4★.
  if (isHotelKind(u.kind)) {
    lines.push(
      sim.hotelsCountTowardRating()
        ? html`<div style="color:var(--good)">Counts toward stars: yes.</div>`
        : html`<div style="color:var(--bad)">Counts toward stars: no. Hotel guests stop counting at 4★ (they still earn income).</div>`,
    );
  }
  // Silent rule: a parking space only works when it chains to a ramp. Skip
  // the verdict while it's still building (or on fire); "Status" covers that.
  // One flood-fill for the whole parking card: its `.has(id)` gives ramp
  // connectivity and its `.size` feeds the demand line, so a hover never
  // runs the fill twice.
  const parkingSet =
    (u.kind === "parking" || u.kind === "parkingRamp") && isOperational(u)
      ? sim.tower.functionalParkingSet()
      : null;
  if (parkingSet) {
    if (u.kind === "parkingRamp") {
      lines.push(parkingDemandLine(sim, parkingSet.size));
    } else if (parkingSet.has(u.id)) {
      lines.push(html`<div style="color:var(--good)">Ramp access: connected.</div>`);
      lines.push(parkingDemandLine(sim, parkingSet.size));
    } else {
      lines.push(
        html`<div style="color:var(--bad)">Ramp access: none. This space is dead (no relief). Chain it to a Parking Ramp.</div>`,
      );
    }
  }
  // W1: a served office whose nearest stairs/elevator is beyond the walking
  // tolerance is silently eroding, so surface it always (like the W3 line below),
  // not only once the tenant is already on notice, and name the concrete fix.
  if (
    u.kind === "office" &&
    u.floor !== 1 &&
    sim.tower.isFloorServed(u.floor) &&
    sim.tower.nearestTransportDistance(u) > TRANSPORT_FAR_TILES
  ) {
    lines.push(
      html`<div style="color:var(--bad)">Long walk to transport. Tenants tire of the hike. Put a stairway, escalator, or passenger elevator within reach.</div>`,
    );
  }
  // W3: a canon commercial venue (not partyHall) more than two floors from a
  // (sky) lobby loses half its shoppers. Name the ACHIEVABLE fix: lobbies only
  // go on the ground and every 15th floor, so "add a lobby here" is usually
  // impossible; the real move is to sit within 2 floors of one of those levels.
  if (isCommercialKind(u.kind) && sim.tower.nearestLobbyFloorDistance(u.floor) > COMMERCIAL_LOBBY_FLOORS) {
    lines.push(
      html`<div style="color:var(--bad)">Shoppers: too far from a lobby. Traffic is halved. Keep it within 2 floors of the ground or a sky lobby (every 15th floor).</div>`,
    );
  }
  // W-new (#394): a served office/condo/hotel far from the nearest (sky)lobby caps
  // low, and deep in the very-far band also erodes toward a move-out. Name the
  // structural fix (a sky lobby, not a local shaft). Always-on, like W1/W3. Modern
  // shows the live distance (advice-with-numbers); Classic names the band only.
  // HONESTY GATE: the advice may only prescribe a lobby the placement rules
  // would accept, so it names the exact buildable slot; when no legal nearer
  // slot exists (the short block above the highest buildable slot, e.g. floors
  // 91+ over a floor-90 lobby), the line goes neutral and uncolored instead of
  // flagging unavoidable geometry as a player mistake.
  if (
    (u.kind === "office" || u.kind === "condo" || isHotelKind(u.kind)) &&
    sim.tower.isFloorServed(u.floor)
  ) {
    const lobbyDist = sim.tower.nearestLobbyFloorDistance(u.floor);
    const drain = sim.rules.lobbyDistanceDrain(lobbyDist);
    if (drain.cap < 1) {
      // Modern shows the live distance; Classic names the situation without it.
      const distNote = sim.rules.mode === "modern" ? `: ${lobbyDist} floors` : "";
      const slot = sim.tower.nearestBuildableLobbySlot(u.floor);
      if (slot === null) {
        // No nearer lobby can legally exist (the short block above the highest
        // legal slot). Plain information, no imperative. The eroding variant is
        // unreachable at the current geometry (the invariant test pins the top
        // block inside the capped band), but the branch handles it anyway so
        // the neutral copy can never mask an actual slide toward a notice.
        lines.push(
          drain.erosion > SERVED_RECOVERY
            ? html`<div style="color:var(--bad)">Too far from any lobby${distNote}. Satisfaction sinks until tenants give notice, and no closer sky lobby slot exists this high in the tower.</div>`
            : html`<div>Far from the nearest lobby${distNote}. Satisfaction is capped here, so it never tops out; no closer sky lobby slot exists this high in the tower.</div>`,
        );
      } else {
        // Name the WHOLE project the build rules will actually accept, never a
        // prescribe-then-refuse loop: a slot above the built top needs floors
        // laid up to it first; a slot carrying floors or rooms needs clearing;
        // and a unit sitting on the empty slot itself must move (clearing the
        // floor demolishes it, so "lift these tenants" would be false for it).
        const onSlot = slot === u.floor;
        // A slot one story above the built top rests on the top story and is
        // directly placeable; only a slot higher than that needs floors first.
        const needsSupport = slot > sim.tower.highestFloor + 1;
        const clearFirst = !onSlot && !needsSupport && sim.tower.floorHasNonLobbyContent(slot);
        // Clearing the slot is itself refused while stories rest on it, so the
        // advice names the teardown too, whether the slot's own obstacle is
        // other content or the advised unit itself; the in-place floor-to-lobby
        // conversion that would spare it is the gated #317 engine change (backlog).
        const aboveBlocked = !needsSupport && sim.tower.floorHasNonLobbyContent(slot + 1);
        const blockedAbove = clearFirst && aboveBlocked;
        if (drain.erosion > SERVED_RECOVERY) {
          // The strong "sinks until notice" warning only when the distance erosion
          // actually outpaces the served recovery, so the tenant really is sliding
          // out (a genuinely skipped sky lobby). Name the exact slot that fixes it.
          const fix = onSlot
            ? aboveBlocked
              ? `This unit sits on the empty sky lobby slot; take down the stories above floor ${slot}, move it, clear the story, and build the lobby there to anchor the block.`
              : `This unit sits on the empty sky lobby slot; move it, clear the story, and build the lobby on floor ${slot} to anchor the block.`
            : needsSupport
              ? `Build floors up to ${slot - 1}, then put the sky lobby on floor ${slot} to lift these tenants.`
              : blockedAbove
                ? `Take down the stories above floor ${slot}, clear it, and build the sky lobby there to lift these tenants.`
                : clearFirst
                  ? `Clear floor ${slot} and build the sky lobby there to lift these tenants.`
                  : `Build the sky lobby on floor ${slot} to lift these tenants.`;
          lines.push(
            html`<div style="color:var(--bad)">Too far from any lobby${distNote}. Satisfaction sinks until tenants give notice. ${fix}</div>`,
          );
        } else {
          // The ceiling holds satisfaction down without evicting; the gentler line
          // describes that honestly and names the buildable fix.
          const fix = onSlot
            ? aboveBlocked
              ? `This unit sits on the sky lobby slot itself; a lobby here, once the stories above come down, it moves, and the story is cleared, would lift the block.`
              : `This unit sits on the sky lobby slot itself; a lobby here, once it moves and the story is cleared, would lift the block.`
            : needsSupport
              ? `A sky lobby on floor ${slot} would lift it (build floors up to ${slot - 1} first; the slot story itself stays clear for the lobby).`
              : blockedAbove
                ? `A sky lobby on floor ${slot} would lift it (the stories above it must come down before it can be cleared).`
                : clearFirst
                  ? `A sky lobby on floor ${slot} would lift it (clear that floor first).`
                  : `A sky lobby on floor ${slot} would lift it.`;
          lines.push(
            html`<div style="color:var(--bad)">Far from the nearest lobby${distNote}. Satisfaction is capped here, so it never tops out. ${fix}</div>`,
          );
        }
      }
    }
  }
  // Recycling runs on demand: how full it is right now, and whether the
  // tower has outgrown its centers (the canon 4★ gate).
  if (u.kind === "recycling" && isOperational(u)) lines.push(...recyclingLines(sim));
  // "Main gripe": before an eviction notice ever fires, name the dominant drain
  // on an unhappy tenant (office / condo / hotel) that isn't already called out
  // by a dedicated line above, so a dropping satisfaction number reads as an
  // actionable cause instead of a mystery. Access, the office long-walk, and
  // very-far lobby distance keep their own lines (GRIPE_TEXT skips those causes);
  // this surfaces congestion, over-market rent, noise, and unmet local retail
  // demand, which were otherwise invisible until the notice.
  // Gated at GRIPE_WARN (the noise annoyance ceiling) so a content tenant is left
  // unbothered while a noise-capped one, which sits exactly at the ceiling, is caught.
  if (
    isPresent(u) &&
    u.state !== "vacating" &&
    u.satisfaction <= GRIPE_WARN &&
    (u.kind === "office" || u.kind === "condo" || isHotelKind(u.kind))
  ) {
    const gripe = sim.dominantGripe(u);
    const text = gripe ? GRIPE_TEXT[gripe] : undefined;
    if (text) lines.push(html`<div style="color:var(--bad)">Main gripe: ${text}</div>`);
  }
  // A tenant on notice: spell out that they're leaving, why, how long is left,
  // and the exact recovery bar they must clear, the "inform before you hurt
  // them" contract, so the eviction is never a surprise. The countdown and the
  // current-vs-target read recompute on every render, so they tick down live as
  // the game clock advances. A relocation is a life event (Modern condos), not a
  // complaint: the player cannot keep them by fixing the tower, so the block
  // drops the recovery-bar line and says plainly what happens instead.
  if (u.state === "vacating" && u.vacateReason) {
    const isRelocation = u.vacateReason === "relocation";
    const minsLeft = Math.max(0, (u.vacateAt ?? 0) - sim.clock.minutes);
    // Framed as an honest UPPER bound ("under N") using ceil, so the block
    // never implies the tenant has *more* time than they do. Once the notice
    // has elapsed, say so plainly: they leave on the next hourly tick.
    const left =
      minsLeft <= 0
        ? "any moment now"
        : minsLeft >= 24 * 60
          ? `in under ${Math.ceil(minsLeft / (24 * 60))} day(s)`
          : `in under ${Math.ceil(minsLeft / 60)} hour(s)`;
    // The reason text is a fixed internal enum string; lit auto-escapes it as a
    // text binding regardless, so no escapeHtml call is needed.
    if (isRelocation) {
      lines.push(
        html`<div style="color:var(--bad)">${VACATE_REASON_TEXT[u.vacateReason]}. Leaves ${left}.</div>`,
        html`<div>A life event, so you cannot keep them. You buy the unit back to re-sell.</div>`,
      );
    } else {
      const now = Math.round(u.satisfaction * 100);
      const target = Math.round(VACATE_RESCIND * 100);
      lines.push(
        html`<div style="color:var(--bad)">Giving notice: ${VACATE_REASON_TEXT[u.vacateReason]}. Leaves ${left}.</div>`,
        html`<div>Fix the cause and get satisfaction to ${target}% to keep them (now ${now}%).</div>`,
      );
    }
  }
  // Retail-only patronage / profit block (shop / fastFood / restaurant): shown
  // for every OPERATIONAL retail venue; a legacy unit (from a save predating the
  // fields) still gets it, reading "just opened" until it trades. Only a gutted
  // / on-fire / mid-build venue is skipped, via the isOperational gate.
  if (
    subtypeListFor(u.kind) !== null &&
    isOperational(u) &&
    ECON.dailyTrafficIncome[u.kind] !== undefined &&
    ECON.retailSpendPerCustomer[u.kind] !== undefined
  ) {
    const demandMap = sim.demandMap();
    const demandFraction = demandMap.fractionByUnit.get(u.id);
    lines.push(
      ...retailStatsLines(
        u.kind,
        u.patronageToday,
        u.patronageYest,
        u.profitYest,
        sim.weather === "rain",
        // Undefined (not `?? 0`) when the venue is absent from the demand map, so
        // the readout omits the "Local demand" line rather than fabricating 0%.
        demandFraction,
        // The tower-wide raw demand pressure, only when this venue is in the map
        // (so absent venues get neither the demand line nor the advice).
        demandFraction === undefined ? undefined : demandMap.share,
        // Modern-only advice: Classic shows the demand number without a verdict on it.
        sim.rules.mode === "modern",
      ),
    );
  }
  return lines;
}

/**
 * The transport diagnostic line: how full a passenger elevator's cars run on
 * average, with a near-capacity nudge. Staff-only service elevators carry no
 * passenger load and stairs/escalators have none, so both return an empty array.
 * Shared by the hover card and the mobile transport editor.
 */
export function transportDiagnostics(sim: Simulation, t: Transport): TemplateResult[] {
  const util = isElevatorKind(t.kind) ? sim.elevatorUtilization(t.id) : undefined;
  if (util === undefined) return [];
  const near = util > 0.85;
  return [
    html`<div style="color:${near ? "var(--bad)" : "var(--good)"}">Avg load: ${Math.round(util * 100)}% full${near ? ". Near capacity; consider more cars or a parallel shaft." : ""}</div>`,
  ];
}
