import { html, type TemplateResult } from "lit-html";
import type { Simulation } from "../engine/Simulation";
import type { Unit } from "../engine/types";
import { HK_ROOMS_PER_CREW, INFEST_DAYS } from "../engine/economy/housekeeping";

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
      html`<div style="color:var(--bad)">Dirty: the guest checked out, so it can't be re-let until a housekeeper cleans it. Left dirty for ${INFEST_DAYS} days, it breeds cockroaches. Staff reach rooms by service elevator, stairs, or escalator.</div>`,
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
 *  parking demand line: how many rooms a crew turns over, the tower's crews vs
 *  its hotel rooms, and a red verdict when the tower is short on capacity or has
 *  rooms no crew can reach over the staff network. */
export function housekeepingCoverageLines(sim: Simulation): TemplateResult[] {
  const c = sim.housekeepingCoverage();
  const out: TemplateResult[] = [
    html`<div>Cleans ~${HK_ROOMS_PER_CREW} rooms a day. Tower: ${c.crews} crew${c.crews === 1 ? "" : "s"} (~${c.dailyCapacity}/day) for ${c.rooms} hotel room(s).</div>`,
  ];
  if (c.dailyCapacity < c.rooms - c.infested) {
    // Infested rooms are uncleanable, so they are not part of the daily workload.
    out.push(html`<div style="color:var(--bad)">Under capacity: rooms will pile up dirty. Add another Housekeeping unit.</div>`);
  }
  if (c.outOfReach > 0) {
    out.push(
      html`<div style="color:var(--bad)">${c.outOfReach} room(s) are out of staff reach and can never be cleaned. Extend a service elevator, stairs, or escalator to their floors.</div>`,
    );
  }
  return out;
}
