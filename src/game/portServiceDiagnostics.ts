import { html, nothing, type TemplateResult } from "lit-html";
import type { ServiceDiagnosticFacts } from "../simport/enginePort";

/**
 * Sole source of player-facing service diagnostic copy for both engines.
 * Game policy/thresholds belong in Rust; only the legacy TypeScript reference
 * derives statuses independently for conformance. This module formats supplied
 * statuses, supporting numbers and colors, without any gameplay calculation.
 */
type Lines = TemplateResult[];
const bad = "var(--bad)";
const good = "var(--good)";

export function hotelRatingLines(rating: string | undefined): Lines {
  if (rating === "counts") return [html`<div style="color:${good}">Counts toward stars: yes.</div>`];
  if (rating === "excluded") return [html`<div style="color:${bad}">Counts toward stars: no. Hotel guests stop counting at 4★ (they still earn income).</div>`];
  return [];
}

export function hotelConditionLines(condition: string | undefined, days: number, exterminator: boolean): Lines {
  if (condition === "dirty") return [
    html`<div style="color:${bad}">Dirty: the guest checked out, so it can't be re-let until a maid cleans it. Left dirty for ${days} days, it turns infested: cockroaches housekeeping can no longer clear. Staff reach rooms by service elevator or stairs.</div>`,
  ];
  if (condition === "infested") return [
    exterminator
      ? html`<div style="color:${bad}">Cockroach infested: neglected too long, so housekeeping can no longer clean it. Call an exterminator (clears every room infested at the time you book) or bulldoze this one and rebuild.</div>`
      : html`<div style="color:${bad}">Cockroach infested: neglected too long. It can't be cleaned. Bulldoze it and rebuild.</div>`,
  ];
  return [];
}

export interface HousekeepingDisplay {
  status: string | undefined;
  crews: number;
  maids: number;
  rooms: number;
  maidsPerUnit: number;
  roomsPerMaid: number;
  cleaned: number;
  leftover: number;
  infested: number;
  outOfReach: number;
  hasInfested: boolean;
  hasOutOfReach: boolean;
  recovery: boolean;
}

export function housekeepingDisplayLines(c: HousekeepingDisplay): Lines {
  if (c.status !== "adequate" && c.status !== "nominalShortfall" && c.status !== "observedShortfall") return [];
  const out: Lines = [
    html`<div>Fields ${c.maidsPerUnit} maids, each cleaning up to ~${c.roomsPerMaid} rooms a day when travel is short. Tower: ${c.crews} crew${c.crews === 1 ? "" : "s"} (${c.maids} maid${c.maids === 1 ? "" : "s"}) for ${c.rooms} hotel room(s).</div>`,
  ];
  if (c.status === "observedShortfall") {
    out.push(html`<div style="color:${bad}">Falling behind: ${c.leftover} room(s) went unserved yesterday (${c.cleaned} cleaned). Add another Housekeeping unit or improve staff transport.</div>`);
  } else if (c.status === "nominalShortfall") {
    out.push(html`<div style="color:${bad}">Likely under capacity: rooms may pile up dirty. Add another Housekeeping unit.</div>`);
  }
  if (c.hasInfested) {
    out.push(html`<div style="color:${bad}">${c.infested} room(s) are infested; cleaning can't recover them. ${c.recovery ? "Call an exterminator, or bulldoze and rebuild." : "Bulldoze and rebuild to clear them."}</div>`);
  }
  if (c.hasOutOfReach) {
    out.push(html`<div style="color:${bad}">${c.outOfReach} room(s) are out of staff reach and can never be cleaned. Extend a service elevator or stairs to their floors.</div>`);
  }
  return out;
}

export interface ParkingDisplay {
  status: string | undefined;
  shortage: boolean;
  have: number;
  total: number;
  offices: number;
  suites: number;
}

export function parkingDisplayLines(c: ParkingDisplay): Lines {
  if (c.status === "disconnected") return [
    html`<div style="color:${bad}">Ramp access: none. This space is dead (no relief). Chain it to a Parking Ramp.</div>`,
  ];
  if (c.status !== "ramp" && c.status !== "connected") return [];
  const result: Lines = [];
  if (c.status === "connected") result.push(html`<div style="color:${good}">Ramp access: connected.</div>`);
  result.push(html`<div style="color:${c.shortage ? bad : good}">Demand: ${c.have}/${c.total} spaces (${c.offices} for offices, ${c.suites} for suites).</div>`);
  return result;
}

/** Rust determines business tiers and tower pressure. This module only
 * formats keyed facts, never recalculating demand or patronage thresholds. */
export function retailDisplayLines(c: ServiceDiagnosticFacts["retail"]): Lines {
  if (!c.active) return [];
  const today = c.today ?? 0;
  const out: Lines = [
    html`<div>Today's patronage: ${today.toLocaleString()} customer${today === 1 ? "" : "s"} <span class="evalbar"><span style="width:${c.barWidth ?? 0}%"></span></span></div>`,
  ];
  if (c.localDemandPct !== null) {
    out.push(html`<div>Local demand: ${c.localDemandPct}% of capacity.</div>`);
    if (c.advice === "underServed") {
      out.push(html`<div>The tower's shoppers outstrip its retail space; another venue would still sell.</div>`);
    } else if (c.advice === "overBuilt") {
      out.push(html`<div>The tower has more retail than its shoppers fill; add homes, or hold off on new venues, to lift every venue.</div>`);
    }
  }
  const verdict: Record<ServiceDiagnosticFacts["retail"]["tier"], string> = {
    notApplicable: "",
    noData: "Just opened, no data yet.",
    low: "Very few customers.",
    average: "Business is average.",
    booming: "Business is booming.",
  };
  if (verdict[c.tier]) {
    let style: string | typeof nothing = nothing;
    if (c.tier === "low") style = `color:${bad}`;
    else if (c.tier === "booming") style = `color:${good}`;
    out.push(html`<div style=${style}>${verdict[c.tier]}</div>`);
  }
  if (c.profitYest !== null) out.push(html`<div>Yesterday's profit: $${c.profitYest.toLocaleString()}.</div>`);
  if (c.rainy) out.push(html`<div>Rain might cause fewer customers.</div>`);
  return out;
}

/** The WASM export returns a keyed object from Rust's typed struct.
 * This adapter does not know about slots, status code integers or thresholds. */
export function portServiceLines(facts: ServiceDiagnosticFacts): Lines {
  const out: Lines = [
    ...hotelRatingLines(facts.hotel.rating),
    ...hotelConditionLines(
      facts.hotel.condition,
      facts.hotel.infestDays ?? NaN,
      facts.hotel.recovery === true,
    ),
  ];
  const h = facts.housekeeping;
  out.push(...housekeepingDisplayLines({
    status: h.status, crews: h.crews ?? NaN, maids: h.maids ?? NaN,
    rooms: h.rooms ?? NaN, maidsPerUnit: h.maidsPerUnit ?? NaN,
    roomsPerMaid: h.roomsPerMaid ?? NaN, cleaned: h.cleaned ?? NaN,
    leftover: h.leftover ?? NaN, infested: h.infested ?? NaN,
    outOfReach: h.outOfReach ?? NaN, hasInfested: h.hasInfested === true,
    hasOutOfReach: h.hasOutOfReach === true, recovery: h.recovery === true,
  }));
  const p = facts.parking;
  out.push(...parkingDisplayLines({
    status: p.status, shortage: p.shortage === true,
    have: p.have ?? NaN, total: p.total ?? NaN,
    offices: p.offices ?? NaN, suites: p.suites ?? NaN,
  }));
  out.push(...retailDisplayLines(facts.retail));
  return out;
}
