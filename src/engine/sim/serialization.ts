import { Simulation } from "../Simulation";

import { Clock } from "../Clock";
import { coerceCalendarKind, type CalendarKind } from "../calendar";


import { Ledger } from "../Ledger";

import { MILESTONES } from "../milestones";
import { POOLED_CAPS, isFacilityKind, isFixedSpanTransport } from "../facilities";
import type { GameMode, SerializedGame, Transport } from "../types";

import { isGameMode } from "../types";
import { SAVE_VERSION, migrateSave } from "../saveMigration";
import { UNIT_CAP, assertSaneUnitCount, dropOverlappingUnits, repairEntityIds } from "./deserializeGuards";

import { LOG_SAVE_CAP } from "./constants";
import { detectFounder } from "./founderStatus";

/** Ceiling for the persisted VIP-visit counter. Visits accrue at most every
 *  few in-game days, so even a millennium-old tower sits orders of magnitude
 *  below this; anything above is a forged save that would otherwise blow out
 *  the stats layout (and, far enough, break ++ precision). */
const VIP_VISITS_CAP = 1_000_000;

/** serialize / deserialize / newGame for the Simulation, as friend functions taking the
 * instance. Extracted from `Simulation.ts`; the class keeps thin delegations. */

export function serialize(sim: Simulation): SerializedGame {
  return {
    version: SAVE_VERSION,
    seed: sim.rng.seed,
    initialSeed: sim.rng.initialSeed,
    money: sim.money,
    star: sim.star,
    minutes: sim.clock.minutes,
    mode: sim.mode,
    modernCalendar: sim.modernCalendar,
    // Only the turned-off state is written (absent loads as on), so a tower that
    // never touched the toggle stays byte-identical. The legacy manualStructure
    // field is no longer written (it is read only for migration on load).
    ...(sim.autoBridge ? {} : { autoBridge: false as const }),
    ...(sim.founder ? { founder: true as const } : {}), // ground-floor flag, persisted once earned (see detectFounder)
    lastQuarterMoney: sim.lastQuarterMoney,
    units: sim.tower.units.map(serializeUnit),
    transports: sim.tower.transports.map(serializeTransport),
    nextId: sim.tower.getNextId(),
    towerName: sim.tower.towerName,
    builtWeddingHall: sim.tower.builtWeddingHall,
    evaluatedTower: sim.evaluatedTower,
    vipVisitDay: sim.vipVisitDay,
    vipFavorable: sim.vipFavorable,
    vipVisits: sim.vipVisits,
    lastVipNagDay: sim.lastVipNagDay,
    treasuresFound: sim.treasuresFound,
    exterminationDueDay: sim.exterminationDueDay,
    events: sim.events.saveState(),
    excavated: [...sim.excavated],
    blockbusters: sim.economy.blockbusterIds,
    milestones: [...sim.achievedMilestones],
    ledger: sim.ledger.serialize(),
    // Spread so an unstamped view contributes no key at all (undo snapshots
    // and crash reports serialize too, and they must not grow a null field).
    ...(sim.view ? { view: sim.view } : {}),
    // The bulletin tail (newest last), so load/import/undo keeps the message
    // history. Same spread pattern: an empty log contributes no key.
    ...(sim.log.length ? { log: sim.log.slice(-LOG_SAVE_CAP).map((e) => ({ ...e })) } : {}),
  };
}

export function deserialize(raw: SerializedGame): Simulation {
  // Run the save through the version seam first, then harden every field below.
  const data = migrateSave(raw);
  // Mode is founded at creation and immutable, so it comes straight from the
  // save. A save that predates the fork (or a forged value) has no valid mode
  // ⇒ classic, keeping every legacy tower pixel-faithful with no migration.
  const sim = new Simulation(
    data.seed,
    isGameMode(data.mode) ? data.mode : "classic",
    coerceCalendarKind(data.modernCalendar),
    false, // startUnbridged: the autoBridge restore below is authoritative
  );
  // Bridging is on by default (absent loads as on, byte-identical). Off when the
  // save turned it off OR it is a legacy "manual structure" tower (that option
  // became the founding "no bridging" default). Classic clamps a forged value on.
  sim.autoBridge = sim.rules.bridgingToggleable() ? data.autoBridge !== false && data.manualStructure !== true : true;
  if (typeof data.initialSeed === "number" && Number.isFinite(data.initialSeed)) sim.rng.initialSeed = data.initialSeed >>> 0; // else: the constructor's data.seed fallback (see RNG.initialSeed)
  // Coerce money to a finite number (untrusted save): a forged NaN/Infinity or
  // non-number poisons the ledger; a broken value keeps the start balance, not NaN.
  sim.money = typeof data.money === "number" && Number.isFinite(data.money) ? data.money : sim.money;
  // Clamp the star to the real ladder (1..6, TOWER included): a forged NaN or
  // out-of-range value would otherwise poison every star compare downstream,
  // e.g. reading parking demand while the build gate refuses to sell parking.
  sim.star = Math.max(1, Math.min(6, Math.floor(typeof data.star === "number" && Number.isFinite(data.star) ? data.star : 1)));
  // Reuse the calendar the constructor already resolved from mode + choice, so
  // the restored clock reads the same week/quarter/year as a fresh tower would.
  // Clamp minutes to a non-negative finite number (untrusted save): a forged
  // NaN/negative would poison every clock.minutes consumer. Not floored, so a valid fractional (sub-minute) save round-trips.
  sim.clock = new Clock(Math.max(0, typeof data.minutes === "number" && Number.isFinite(data.minutes) ? data.minutes : 0), sim.clock.calendar);
  sim.evaluatedTower = data.evaluatedTower;
  // Restore the pending VIP inspection so saving during the post-Wedding-Hall
  // window doesn't permanently cancel the TOWER evaluation.
  sim.vipVisitDay = data.vipVisitDay ?? -1;
  sim.vipFavorable = data.vipFavorable ?? false;
  // Clamp to a bounded non-negative integer (untrusted save): a forged negative,
  // fractional, or absurd count would render nonsense in the stats dialog, and
  // past 2^53 the ++ would stop incrementing (same precision trap as ID_CAP).
  sim.vipVisits = Math.max(
    0,
    Math.min(
      VIP_VISITS_CAP,
      Math.floor(typeof data.vipVisits === "number" && Number.isFinite(data.vipVisits) ? data.vipVisits : 0),
    ),
  );
  // Saves written before the counter (and TDT imports, which synthesize
  // vipFavorable from the star) carry no visits: a favorable review proves one,
  // a won tower two (its winning TOWER inspection). Adopt those so the stats row
  // can't contradict the flags. Only when ABSENT, so an explicit 0 round-trips.
  if (data.vipVisits === undefined && (sim.vipFavorable || sim.evaluatedTower)) {
    sim.vipVisits = sim.evaluatedTower ? 2 : 1;
  }
  // Restore the unfavorable-VIP nag day so a reload can't reopen the 5-day
  // window early (that would both re-nag and inflate the persisted vipVisits).
  // Clamped to the save's own day so a forged future value can't mute the VIP
  // for years; missing (legacy) restores the fresh-tower default.
  sim.lastVipNagDay = Math.min(
    sim.clock.day,
    typeof data.lastVipNagDay === "number" && Number.isFinite(data.lastVipNagDay) ? Math.floor(data.lastVipNagDay) : -100,
  );
  // Clamp ≥0 (untrusted): a negative keeps `treasuresFound < 3` true and re-opens the treasure farm.
  sim.treasuresFound = Math.max(
    0,
    typeof data.treasuresFound === "number" && Number.isFinite(data.treasuresFound) ? data.treasuresFound : 0,
  );
  sim.exterminationDueDay = coerceExterminationDueDay(sim.rules.infestationRecovery() !== null, sim.clock.day, data.exterminationDueDay);
  // Restore excavation history so buried treasure stays one-time per tile across
  // a save/reload (otherwise the build/bulldoze exploit reopens on load).
  if (Array.isArray(data.excavated)) {
    for (const k of data.excavated) if (typeof k === "string") sim.excavated.add(k);
  }
  // Restore this month's blockbuster bookings (already paid for pre-save).
  if (Array.isArray(data.blockbusters)) sim.economy.restoreBlockbusters(data.blockbusters);
  // Restore achieved milestones so reload doesn't re-announce them.
  if (Array.isArray(data.milestones)) {
    for (const id of data.milestones) if (typeof id === "string") sim.achievedMilestones.add(id);
  }
  // Restore the income-breakdown ledger (absent in pre-ledger saves → empty,
  // warming up as play continues).
  sim.ledger = Ledger.restore(data.ledger);
  // Restore the saved camera view (inert UI cargo) through the same trust
  // boundary as everything else: malformed shapes drop to null (the renderer
  // then centers), out-of-range values clamp to the grid and zoom range.
  sim.view = coerceView(data.view);
  // Restore the bulletin tail (hardened per entry; see coerceLog). logSeq
  // stays 0 on purpose: the UI rebases its cursor on adopt, so the restored
  // entries repopulate the panel without replaying as toasts. The write-time
  // provenance stamps (savedAt, appVersion) are deliberately NOT carried:
  // they describe the file, and the next write re-stamps them.
  sim.log = coerceLog(data.log);
  // Reject any unit/transport with an unrecognized kind from untrusted saves,
  // and coerce the numeric fields that drive the loop to finite values so a
  // hand-edited or foreign save can't poison the math with NaN/undefined.
  // Guard the container type, not just null: a forged save can clobber `units`
  // to a non-array, which throws when iterated, the same hard load failure this
  // hardening prevents (matching the Array.isArray guard excavated/milestones
  // already use). The null check runs BEFORE `.kind`, since a forged entry can
  // be `null` and reading it throws, aborting the load instead of dropping one
  // entry. The forged-count ceiling applies AS WE GO, before the map below
  // builds any unit object, or a crafted file could freeze the tab at load (see
  // deserializeGuards); counting only kind-valid entries spares a salvageable
  // save padded with junk, and bailing past the cap bounds work and array alike.
  const rawUnits: SerializedGame["units"] = [];
  for (const u of Array.isArray(data.units) ? data.units : []) {
    if (u == null || !isFacilityKind(u.kind)) continue;
    rawUnits.push(u);
    if (rawUnits.length > UNIT_CAP) assertSaneUnitCount(rawUnits.length);
  }
  sim.tower.units = rawUnits.map((u) => coerceUnitRecord(sim, u));
  // Unit-layer overlap filter, the mirror of the transport pass below: first
  // kept wins, later overlappers drop, per index layer (see deserializeGuards).
  sim.tower.units = dropOverlappingUnits(sim.tower.units);
  // Snap-on-load (pricing split, NFR3): in a ladder-priced mode (Classic),
  // every stored rent snaps once onto the canon rungs, nearest rung with ties
  // rounding UP, uniformly for every kind with no intent-guessing (the labeled
  // "grandfather" row was rejected on the record). Non-finite and out-of-band
  // values were already coerced above, and the snap itself bounds anything
  // left, so nothing off-ladder survives into a ladder tower: the dropdown
  // never lies. Idempotent, so a post-split save re-snaps to itself and only a
  // genuinely pre-split (or forged) save ever reports a change; Modern saves
  // read the band shape and are untouched. Runs on the restored units, before
  // any log emit below, so the bulletin lands after the restored tail.
  let rentsSnapped = 0;
  let snappedTowerHasCondo = false;
  for (const u of sim.tower.units) {
    if (u.kind === "condo") snappedTowerHasCondo = true;
    if (snapUnitRent(sim, u)) rentsSnapped++;
  }
  if (rentsSnapped > 0) {
    // One bulletin line, once per save (idempotence above means a later load
    // finds nothing to change): durable in the log, no modal and no toast
    // ("info" entries are bulletin-only). The condo callout turns the removed
    // $80k floor into the feature it is (ux-pricing-split-editor §3).
    sim.emit(
      `Classic pricing: rents snapped to the four 1994 rate levels.${snappedTowerHasCondo ? " Condos can now sell for as little as $50,000." : ""}`,
      "info",
    );
  }
  const keptTransports: Transport[] = [];
  sim.tower.transports = (Array.isArray(data.transports) ? data.transports : [])
    // Same null/non-object guard as units: never read `.kind` off a `null`
    // entry, or one corrupt transport aborts the entire load.
    .filter((t) => t != null && isFacilityKind(t.kind))
    .map(coerceTransportRecord)
    // Bound the list before the quadratic overlap pass below: a legit tower
    // can never exceed the pooled build caps (24 shafts + 64 walkway links,
    // enforced at placement by Tower.capReason), so anything past their sum
    // is forged padding that would otherwise turn the O(n^2) scan into a
    // load-time hang on a crafted save.
    .slice(0, POOLED_CAPS.reduce((sum, pool) => sum + pool.cap, 0))
    // Overlap cross-check: `validateTransport` can never produce two shafts
    // sharing a cell, but a forged or hand-edited save can, and everything
    // downstream (hit-testing, selection, dispatch) assumes the invariant.
    // Drop a shaft that overlaps an earlier KEPT one (checking against kept
    // shafts only, so one bad entry can't shadow-block healthy later ones),
    // with the one legal exception mirrored from placement: exact-footprint
    // stacked walkway flights sharing their landing floor.
    .filter((t) => {
      for (const p of keptTransports) {
        if (t.x >= p.x + p.width || p.x >= t.x + t.width) continue;
        if (t.bottom > p.top || p.bottom > t.top) continue;
        if (
          isFixedSpanTransport(t.kind) &&
          isFixedSpanTransport(p.kind) &&
          t.x === p.x &&
          t.width === p.width &&
          (t.bottom === p.top || t.top === p.bottom)
        ) {
          continue; // stacked flights sharing exactly the landing floor
        }
        return false; // overlaps an earlier-kept shaft: drop this one
      }
      keptTransports.push(t);
      return true;
    });
  // Repair corrupt/duplicate ids and park the id counter above them all
  // (forged-save guard; rationale and the sanity bound live in deserializeGuards).
  sim.tower.setNextId(repairEntityIds([...sim.tower.units, ...sim.tower.transports], data.nextId));
  sim.tower.towerName = data.towerName;
  sim.tower.builtWeddingHall = data.builtWeddingHall;
  sim.tower.reindex();
  // Re-assert the express lobby-stop lock at the trust boundary: the import
  // path above writes `skipFloors` directly (bypassing setStop), so a forged
  // or foreign save could otherwise carry a non-lobby express stop. Runs after
  // reindex so the lobby-tile index is populated (floorHasLobby is live), and
  // only ADDS forbidden non-lobby floors to each express's skip list, keeping
  // a player's deliberate lobby-skip intact.
  sim.tower.coerceExpressStops();
  // Resume any in-progress construction and ongoing fires.
  for (const u of sim.tower.units) {
    if (u.state === "construction") sim.constructing.add(u.id);
  }
  sim.events.restore(sim.tower.units.filter((u) => u.state === "fire").map((u) => u.id));
  // Resume the seasonal-event RNG and Santa's once-a-year guard so a save can't
  // make Santa re-visit (or thieves replay) the same in-game year.
  sim.events.loadState(data.events);
  // Recompute today's sky so a freshly loaded game doesn't show stale weather
  // until the next day boundary.
  sim.weather = Simulation.weatherFor(sim.clock.day);
  sim.lastDay = sim.clock.day;
  sim.lastQuarter = sim.clock.quarter;
  // Legacy saves predate this field: a missing value restores as 0 (no snapshot).
  sim.lastQuarterMoney = typeof data.lastQuarterMoney === "number" && Number.isFinite(data.lastQuarterMoney) ? data.lastQuarterMoney : 0; // sanitize like every other numeric field: a forged NaN/string must not persist back out
  sim.lastMonth = Math.floor(sim.clock.day / sim.clock.calendar.maintPeriodDays);
  sim.lastHour = sim.clock.hour;
  // Silently adopt any milestone already satisfied at load time (e.g. a legacy
  // save) so the next day doesn't spam headlines for goals already earned. Runs
  // last, after tower/transports/clock are restored, so predicates read real state.
  for (const m of MILESTONES) if (!sim.achievedMilestones.has(m.id) && m.test(sim)) sim.achievedMilestones.add(m.id);
  sim.founder = detectFounder(raw); // ground-floor recognition (2.0)
  return sim;
}

/** Found a new tower on an empty lot. Both rule-sets found the 1994 way now:
 *  an empty lot, and where to lay the lobby that opens the tower is the
 *  player's first decision. The `mode` chosen at the New Tower screen is baked
 *  in here, at creation, and is immutable for the tower's life. */
export function newGame(seed = 12345, mode: GameMode = "classic", modernCalendar: CalendarKind = "realWorld", startUnbridged = false): Simulation {
  const sim = new Simulation(seed, mode, modernCalendar, startUnbridged);
  sim.emit("Welcome! Lay a lobby on the ground line to open your tower.", "info");
  sim.gameplayEvents.push("tower_founded", { mode: sim.mode });
  return sim;
}

import { serializeUnit, serializeTransport, coerceLog, coerceView, coerceExterminationDueDay } from "./coerce";
import { coerceTransportRecord, coerceUnitRecord, snapUnitRent } from "./deserializeRecords";
