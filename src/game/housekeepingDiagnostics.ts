import { html, type TemplateResult } from "lit-html";
import type { Simulation } from "../engine/Simulation";
import type { Unit } from "../engine/types";
import { HK_MAIDS_PER_UNIT, HK_NOMINAL_ROOMS_PER_MAID, INFEST_DAYS } from "../engine/economy/housekeeping";

/**
 * Housekeeping / cockroach inspector lines, split out of `facilityDiagnostics`
 * to keep that file under the readable ceiling. Same contract as the rest of the
 * diagnostics block: pure functions of (sim, unit) returning lit `TemplateResult`
 * lines, shared by the desktop hover card and the mobile editor fold-in.
 */

/** Why a hotel room has roaches and how to fix it. A `dirty` room is normal
 *  churn (a housekeeper is coming) but names the 3-day infestation deadline; an
 *  `infested` room can no longer be cleaned, so it names the mode-correct
 *  recovery (Modern: a paid exterminator; Classic: bulldoze-only). */
export function hotelInfestationLines(sim: Simulation, u: Unit): TemplateResult[] {
  if (u.state === "dirty") {
    return [
      html`<div style="color:var(--bad)">Dirty: the guest checked out, so it can't be re-let until a maid cleans it. Left dirty for ${INFEST_DAYS} days, it turns infested: cockroaches housekeeping can no longer clear. Staff reach rooms by service elevator or stairs.</div>`,
    ];
  }
  if (u.state === "infested") {
    return [
      sim.rules.infestationRecovery()
        ? html`<div style="color:var(--bad)">Cockroach infested: neglected too long, so housekeeping can no longer clean it. Call an exterminator (clears every room infested at the time you book) or bulldoze this one and rebuild.</div>`
        : html`<div style="color:var(--bad)">Cockroach infested: neglected too long. It can't be cleaned. Bulldoze it and rebuild.</div>`,
    ];
  }
  return [];
}

/** The housekeeping-station coverage block, the housekeeping analog of the
 *  parking demand line: the maids a unit fields, the tower's crews vs its hotel
 *  rooms, and a red verdict keyed on the OBSERVED shortfall (rooms that
 *  survived yesterday's whole shift dirty), never a nominal best case: the
 *  maids-times-anchor estimate can read fine while a distant wing rots. The
 *  nominal comparison remains only as the fallback before the first checkout,
 *  and an active infestation always shows red (it is at-risk, not "adequate"). */
export function housekeepingCoverageLines(sim: Simulation): TemplateResult[] {
  const c = sim.housekeepingCoverage();
  const report = sim.economy.housekeepingReport();
  const out: TemplateResult[] = [
    html`<div>Fields ${HK_MAIDS_PER_UNIT} maids, each cleaning up to ~${HK_NOMINAL_ROOMS_PER_MAID} rooms a day when travel is short. Tower: ${c.crews} crew${c.crews === 1 ? "" : "s"} (${c.maids} maid${c.maids === 1 ? "" : "s"}) for ${c.rooms} hotel room(s).</div>`,
  ];
  if (report && report.leftover > 0 && c.rooms > 0) {
    out.push(
      html`<div style="color:var(--bad)">Falling behind: ${report.leftover} room(s) went unserved yesterday (${report.cleaned} cleaned). Add another Housekeeping unit or improve staff transport.</div>`,
    );
  } else if (c.dailyCapacity < c.rooms) {
    // Gross under-provision by the nominal best case: fires immediately (a big
    // hotel build-out should not wait for the next morning's latched report to
    // read red), and it is the only signal before the first observed shift.
    out.push(html`<div style="color:var(--bad)">Likely under capacity: rooms may pile up dirty. Add another Housekeeping unit.</div>`);
  }
  if (c.infested > 0) {
    out.push(
      html`<div style="color:var(--bad)">${c.infested} room(s) are infested; cleaning can't recover them. ${sim.rules.infestationRecovery() ? "Call an exterminator, or bulldoze and rebuild." : "Bulldoze and rebuild to clear them."}</div>`,
    );
  }
  if (c.outOfReach > 0) {
    out.push(
      html`<div style="color:var(--bad)">${c.outOfReach} room(s) are out of staff reach and can never be cleaned. Extend a service elevator or stairs to their floors.</div>`,
    );
  }
  return out;
}
