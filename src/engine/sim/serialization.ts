import { Simulation } from "../Simulation";

import { Clock } from "../Clock";
import { coerceCalendarKind, type CalendarKind } from "../calendar";

import { rentConfig } from "../econConfig";
import { snapToLadder } from "../gameRules";

import { Ledger } from "../Ledger";

import { MILESTONES } from "../milestones";
import { canonicalSubtype, subtypeListFor } from "../retailSubtypes";
import { FACILITIES, GRID, POOLED_CAPS, facilityFloors, isElevatorKind, isFacilityKind, isFixedSpanTransport, isHotelKind, maxCarsFor } from "../facilities";
import type { FacilityKind, GameMode, SerializedGame, Transport } from "../types";

import { isGameMode, isUnitState, isVacateReason } from "../types";
import { SAVE_VERSION, migrateSave } from "../saveMigration";

import { SOLD_CONDO_MIN_PRICE, SOLD_CONDO_MAX_PRICE, LOG_SAVE_CAP } from "./constants";

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
    money: sim.money,
    star: sim.star,
    minutes: sim.clock.minutes,
    mode: sim.mode,
    modernCalendar: sim.modernCalendar,
    lastQuarterMoney: sim.lastQuarterMoney,
    units: sim.tower.units.map(serializeUnit),
    transports: sim.tower.transports.map((t) => ({
      ...t,
      // Deep-copy every per-car/array field so a retained snapshot can't be
      // mutated later by in-place updates (carLoad is written each tick).
      carPositions: [...t.carPositions],
      carDir: [...t.carDir],
      carLoad: t.carLoad ? [...t.carLoad] : undefined,
      skipFloors: t.skipFloors ? [...t.skipFloors] : undefined,
    })),
    nextId: sim.tower.getNextId(),
    towerName: sim.tower.towerName,
    builtWeddingHall: sim.tower.builtWeddingHall,
    evaluatedTower: sim.evaluatedTower,
    vipVisitDay: sim.vipVisitDay,
    vipFavorable: sim.vipFavorable,
    vipVisits: sim.vipVisits,
    lastVipNagDay: sim.lastVipNagDay,
    treasuresFound: sim.treasuresFound,
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
  );
  sim.money = data.money;
  // Clamp the star to the real ladder (1..6, TOWER included): a forged NaN or
  // out-of-range value would otherwise poison every star compare downstream,
  // e.g. reading parking demand while the build gate refuses to sell parking.
  sim.star = Math.max(1, Math.min(6, Math.floor(typeof data.star === "number" && Number.isFinite(data.star) ? data.star : 1)));
  // Reuse the calendar the constructor already resolved from mode + choice, so
  // the restored clock reads the same week/quarter/year as a fresh tower would.
  sim.clock = new Clock(data.minutes, sim.clock.calendar);
  sim.evaluatedTower = data.evaluatedTower;
  // Restore the pending VIP inspection so saving during the post-Wedding-Hall
  // window doesn't permanently cancel the TOWER evaluation.
  sim.vipVisitDay = data.vipVisitDay ?? -1;
  sim.vipFavorable = data.vipFavorable ?? false;
  // Clamp to a bounded non-negative integer (untrusted save): a forged
  // negative, fractional, or absurd count would render nonsense in the stats
  // dialog forever, and past 2^53 the ++ would stop incrementing (same
  // precision trap ID_CAP guards below).
  sim.vipVisits = Math.max(
    0,
    Math.min(
      VIP_VISITS_CAP,
      Math.floor(typeof data.vipVisits === "number" && Number.isFinite(data.vipVisits) ? data.vipVisits : 0),
    ),
  );
  // Saves written before the counter (and TDT imports, which synthesize
  // vipFavorable from the star) carry no visits at all, yet a favorable review
  // proves a VIP stayed at least once, and a won tower adds the winning TOWER
  // inspection on top; adopt those so the stats row can't contradict the
  // recorded flags. Only when the FIELD IS ABSENT: an explicit 0 (however it
  // arose) round-trips unchanged, keeping serialize/deserialize idempotent.
  if (data.vipVisits === undefined && (sim.vipFavorable || sim.evaluatedTower)) {
    sim.vipVisits = sim.evaluatedTower ? 2 : 1;
  }
  // Restore the unfavorable-VIP nag day so a reload can't reopen the 5-day
  // window early (that would both re-nag and inflate the persisted vipVisits).
  // Clamped to the save's own day so a forged future value can't mute the VIP
  // for years; missing (legacy) restores the fresh-tower default, at worst
  // re-nagging once after load.
  sim.lastVipNagDay = Math.min(
    sim.clock.day,
    typeof data.lastVipNagDay === "number" && Number.isFinite(data.lastVipNagDay) ? Math.floor(data.lastVipNagDay) : -100,
  );
  // Clamp ≥0 (untrusted save): a negative value would keep `treasuresFound < 3`
  // true forever and re-open the treasure farm.
  sim.treasuresFound = Math.max(
    0,
    typeof data.treasuresFound === "number" && Number.isFinite(data.treasuresFound) ? data.treasuresFound : 0,
  );
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
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  // Guard the container type too, not just null: a forged save can clobber
  // `units` to a non-array scalar/object, and `.filter` on it throws, same
  // hard-load-failure this hardening exists to prevent. Matches the
  // Array.isArray guard the sibling arrays (excavated/milestones) already use.
  sim.tower.units = (Array.isArray(data.units) ? data.units : [])
    // Drop a null/non-object entry BEFORE reading `.kind`: a forged or
    // partially-written save can hold a `null` in the array, and `u.kind`
    // on it throws, aborting the whole load instead of dropping one entry.
    .filter((u) => u != null && isFacilityKind(u.kind))
    .map((u) => {
      // Coerce geometry to finite integers, and keep the whole FOOTPRINT on
      // the lot (not just the origin): forged floor/x/width would otherwise
      // flow into renderer math (silhouette edges, lobby variant indexing,
      // actor positions) as NaN/Infinity, make a per-tile draw loop iterate
      // an absurd width, or hang a span/multi-story room off the lot edge.
      const stories = facilityFloors(u.kind);
      const floor = Math.max(GRID.minFloor, Math.min(GRID.maxFloor - (stories - 1), Math.round(num(u.floor, 1))));
      const x = Math.max(0, Math.min(GRID.width - 1, Math.round(num(u.x, 0))));
      const width = Math.max(1, Math.min(GRID.width - x, Math.round(num(u.width, FACILITIES[u.kind].width))));
      // Coerce the free-form state first (a forged `state` would flow into UI
      // innerHTML and state-machine compares); the sold/leased flag below reads it.
      const state = isUnitState(u.state) ? u.state : "empty";
      // Harden the "currently sold/leased" flag at the trust boundary: only a
      // literal `true` counts (a forged "yes" must not mark a condo sold), AND,
      // for a LEASE/SALE unit (office, condo), whose everOccupied means "currently
      // leased/sold", a shell state (empty, construction, gutted) is definitionally
      // NOT currently owned, so the flag is normalized to false even if the save
      // left it true. That rescues a LEGACY "dead" condo whose owner left back when
      // `vacate()` kept `everOccupied` set (else it reloads sold-but-empty and, since
      // sales require `!everOccupied`, sits off-market forever) and blocks a forged
      // shell from doing the same. (A sold unit that's on fire IS still owned, so
      // `fire` is not cleared.) HOTELS are exempt: their everOccupied means "ever
      // booked" and legitimately stays true while the room sits `empty` between
      // guests (turnover runs through `state`, not this flag).
      const notOwned = state === "empty" || state === "construction" || state === "gutted";
      const everOccupied = u.everOccupied === true && !(notOwned && !isHotelKind(u.kind));
      const soldCondo = u.kind === "condo" && everOccupied;
      // Player-set price, coerced to a finite number, then bounded for condos.
      // An UNSOLD condo re-enters the currently legal range so a legacy save
      // priced at an old min/max can't sell off-range (or render past the
      // editor's ends): the Modern band clamps here; a ladder mode instead
      // snaps every priced rent onto the canon rungs in the pass below (whose
      // Very Low sits BELOW the band floor by design, so the band clamp must
      // not run first and pre-clamp $50k up to $80k). A SOLD condo keeps its
      // historical price so the buy-back mirrors what it sold for, but is
      // still bounded so a forged `rent` can't drive an unbounded buy-back
      // money drain. The bound must match the mode's own legal range: the
      // Classic ladder's Very Low ($50,000) sits BELOW the band-era
      // SOLD_CONDO_MIN_PRICE, so bounding a ladder-mode sale through the band
      // floor would lift a legal $50k sale to $60k, the snap pass would pull
      // it back down, and that phantom migration would re-post the one-time
      // pricing bulletin on every load. Ladder mode bounds to the ladder's
      // own extremes (the snap pass then lands it exactly on a rung); band
      // mode keeps the historical bounds.
      let rent = u.rent === undefined ? undefined : num(u.rent, rentConfig(u.kind)?.default ?? 0);
      if (rent !== undefined && u.kind === "condo") {
        const condoOpts = sim.rules.priceOptions("condo");
        const ladderMode = condoOpts?.shape === "ladder";
        if (soldCondo) {
          rent =
            condoOpts?.shape === "ladder"
              ? Math.max(condoOpts.rungs[0].value, Math.min(condoOpts.rungs[condoOpts.rungs.length - 1].value, rent))
              : Math.max(SOLD_CONDO_MIN_PRICE, Math.min(SOLD_CONDO_MAX_PRICE, rent));
        } else if (!ladderMode) {
          const band = rentConfig("condo")!;
          rent = Math.max(band.min, Math.min(band.max, rent));
        }
      }
      return {
        ...u,
        floor,
        x,
        width,
        everOccupied,
        // A non-string `label` would crash the escaping at render.
        state,
        label: typeof u.label === "string" ? u.label : FACILITIES[u.kind].name,
        satisfaction: Math.max(0, Math.min(1, num(u.satisfaction, 1))),
        // Attendance venues' occupants mirrors the transient customersIn
        // tally (zeroed below), so it restores to 0 no matter what the save
        // carries: a hand-edited or legacy save can't seed a phantom
        // audience the live crowd would never drain.
        occupants: FACILITIES[u.kind].attendance !== undefined ? 0 : Math.max(0, num(u.occupants, 0)),
        // Household size, only kept for a CURRENTLY-sold condo, and sanitized by
        // the rule-set (Classic strips it so its condos read the flat 3; Modern
        // clamps into the 2..5 generator band). A not-sold condo (legacy dead
        // unit, empty/gutted, or a hand-edited save) carries none, so a stale
        // household can't leak into the census or a per-unit occupancy readout;
        // the next sale draws fresh.
        residents: soldCondo ? sim.rules.coerceResidents(u.residents) : undefined,
        pendingIncome: num(u.pendingIncome, 0),
        rent,
        // Coerce the film policy so a hand-edited save can't inject a bad value
        // (undefined ⇒ auto, the legacy behavior).
        filmPolicy:
          u.filmPolicy === "feature" || u.filmPolicy === "blockbuster" || u.filmPolicy === "auto"
            ? u.filmPolicy
            : undefined,
        // Whitelist-coerce the canon retail variant name against the kind's
        // §7 list, so a scrambled save or a subtype from a kind that doesn't
        // carry one drops to undefined (unit renders as the generic name).
        subtype: canonicalSubtype(u.kind as FacilityKind, u.subtype),
        // Retail-only running totals: kept only on kinds that carry a canon
        // subtype so a hand-edited save can't leak the fields onto a hotel or
        // office. `num` clamps non-finite / negative-infinity forgeries; a
        // legitimate absence stays absent (undefined) so a legacy save is
        // indistinguishable from a fresh retail unit that hasn't earned yet.
        patronageToday: subtypeListFor(u.kind as FacilityKind) === null || u.patronageToday === undefined ? undefined : Math.max(0, num(u.patronageToday, 0)),
        patronageYest: subtypeListFor(u.kind as FacilityKind) === null || u.patronageYest === undefined ? undefined : Math.max(0, num(u.patronageYest, 0)),
        profitToday: subtypeListFor(u.kind as FacilityKind) === null || u.profitToday === undefined ? undefined : Math.max(0, num(u.profitToday, 0)),
        profitYest: subtypeListFor(u.kind as FacilityKind) === null || u.profitYest === undefined ? undefined : Math.max(0, num(u.profitYest, 0)),
        // Preserve an in-progress eviction across save/reload, hardened like
        // every other loop-driving field: an out-of-set reason or a non-finite
        // deadline from a forged save must not reach the toast / state machine.
        vacateReason: isVacateReason(u.vacateReason) ? u.vacateReason : undefined,
        vacateAt: u.vacateAt === undefined ? undefined : num(u.vacateAt, 0),
        // Off-market flag, sanitized through the rule-set seam (like
        // `coerceResidents`): Classic keeps a literal-true flag and hardens a
        // forged non-boolean away; Modern never holds the state, so it coerces
        // the flag off entirely. Gated to priced kinds, mirroring import and
        // export: No Rate is a priced-unit concept, so a forged `true` on an
        // unpriced kind (shop, fast food) drops to undefined and never reaches
        // the move-in gate.
        noRate: rentConfig(u.kind as FacilityKind) ? sim.rules.coerceNoRate(u.noRate) : undefined,
        // Transient crowd counters never survive a load: serializeUnit omits
        // them, and the `...u` spread above would otherwise let a hand-edited
        // save seed the census/star gating (customersIn, hotelCustomersIn) or
        // the visible-occupancy projection (outForMeal) with forged values.
        // The live crowd rebuilds all of them organically.
        customersIn: undefined,
        hotelCustomersIn: undefined,
        outForMeal: undefined,
      };
    });
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
    const priceShape = sim.rules.priceOptions(u.kind);
    if (!priceShape || priceShape.shape !== "ladder") continue;
    const cfg = rentConfig(u.kind)!;
    const effective = u.rent ?? cfg.default; // what rentOf would charge (No Rate aside)
    // A stored value snaps to its nearest rung; an ABSENT override is not a
    // stored rent at all, it means "on the default", and the ladder's default
    // rung is Average (AR6), so it lands there directly. Snapping the band
    // default's dollars instead would drop a never-priced hotel onto Very Low
    // (the band defaults sit an order of magnitude under the canon ladder)
    // while an identical new build starts on Average: same untouched unit,
    // two prices. Offices and condos read identically either way.
    const snapped = u.rent === undefined ? priceShape.rungs[2].value : snapToLadder(priceShape.rungs, u.rent);
    // Count only visible price changes: an off-market (No Rate) unit charges
    // $0 either way, so normalizing its latent stored value is silent.
    if (!u.noRate && snapped !== effective) rentsSnapped++;
    // Same storage rule as every rung write: strip the override only when the
    // rung coincides with the band default (so `rentOf`'s fallback still reads
    // the same rung and sparse saves stay sparse for offices on Average).
    u.rent = snapped === cfg.default ? undefined : snapped;
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
    .map((t) => {
      // Coerce car counts/positions from an untrusted save: a NaN/negative/huge
      // `cars` would otherwise reach `new Array(cars)` in the dispatcher and
      // throw a RangeError (or OOM) on the very next tick.
      const maxCars = isElevatorKind(t.kind) ? maxCarsFor(t.kind) : 0;
      const cars = Math.max(0, Math.min(maxCars, Math.floor(num(t.cars, 0))));
      // Clamp the span to the lot: an unbounded forged bottom/top would give
      // the shaft an absurd height (its banded graphic loop scales with it).
      // Bottom caps at maxFloor - 1 so the top > bottom rule below can't be
      // forced past maxFloor by a forged bottom.
      const bottom = Math.max(GRID.minFloor, Math.min(GRID.maxFloor - 1, Math.round(num(t.bottom, 1))));
      // A transport must have height (validateTransport requires top > bottom);
      // never deserialize a zero-height shaft from a corrupt save.
      const top = Math.max(bottom + 1, Math.min(GRID.maxFloor, Math.round(num(t.top, bottom + 1))));
      // Shaft width is normally fixed per kind, but a legacy save keeps its own
      // stored width (canon widths only ever GREW: stairs 4→8, standard
      // elevator 3→4) and the consumers trust it, so preserve a valid stored
      // width up to the catalog's. A width ABOVE the catalog is always forged
      // (no canon width ever shrank), and trusting it would let one corrupt
      // entry shadow every transport under its bogus footprint through the
      // overlap filter below (and rasterize an oversized texture), so clamp
      // down to the catalog. Non-positive/non-finite falls back to the
      // catalog too (it would NaN-poison the W1 span scan and hit-testing).
      const w0 = Math.round(num(t.width, FACILITIES[t.kind].width));
      const width = w0 > 0 ? Math.min(w0, FACILITIES[t.kind].width) : FACILITIES[t.kind].width;
      const fixLen = (arr: unknown, fill: number) =>
        Array.from({ length: cars }, (_, i) =>
          Array.isArray(arr) ? num(arr[i], fill) : fill,
        );
      return {
        ...t,
        // Same geometry hardening as units: keep the shaft's whole width on
        // the lot. `width` is already bounded by the catalog above, so
        // clamping by it keeps a kept-legacy 3-wide shaft at the right lot
        // edge at its exact saved x (never shoved one tile into the neighbor
        // that boxed it in).
        x: Math.max(0, Math.min(GRID.width - width, Math.round(num(t.x, 0)))),
        width,
        bottom,
        top,
        cars,
        carPositions: fixLen(t.carPositions, bottom),
        carDir: fixLen(t.carDir, 0),
        carLoad: t.carLoad ? fixLen(t.carLoad, 0) : undefined,
        skipFloors: Array.isArray(t.skipFloors)
          ? t.skipFloors.filter((n) => typeof n === "number" && Number.isFinite(n))
          : undefined,
      };
    })
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
  // Ids drive every by-id lookup, and the renderer keys its retained actors
  // by them, so they must be sane and unique, and the id counter must sit
  // above them all (a corrupt/hand-edited nextId would otherwise mint
  // duplicates for new placements, permanently drawing the wrong room).
  // "Sane" is stricter than finite: a forged id near/past 2^53 would make
  // the ++ repair (and allocateId later) a precision no-op that re-mints the
  // same id forever, so ids must be positive integers under a bound no legit
  // tower approaches. Max over the SANE ids only, then hand each corrupt or
  // duplicated id a fresh one.
  const ID_CAP = 2 ** 31; // ~2.1e9 placements, far past any real save
  const saneId = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n > 0 && n < ID_CAP;
  const entities: { id: number }[] = [...sim.tower.units, ...sim.tower.transports];
  let maxLoadedId = 0;
  for (const e of entities) if (saneId(e.id) && e.id > maxLoadedId) maxLoadedId = e.id;
  const seenIds = new Set<number>();
  for (const e of entities) {
    if (!saneId(e.id) || seenIds.has(e.id)) e.id = ++maxLoadedId;
    seenIds.add(e.id);
  }
  // The saved counter gets the same sanity gate: a forged huge nextId would
  // otherwise win the max and park the counter where ++ stops incrementing.
  const savedNextId = saneId(data.nextId) ? data.nextId : 0;
  sim.tower.setNextId(Math.max(savedNextId, maxLoadedId + 1));
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
  // Legacy saves predate this field, so a missing value restores as 0
  // (no snapshot), matching a fresh tower.
  sim.lastQuarterMoney = num(data.lastQuarterMoney, 0); // sanitize like every other numeric field: a forged NaN/string must not persist back out
  sim.lastMonth = Math.floor(sim.clock.day / sim.clock.calendar.maintPeriodDays);
  sim.lastHour = sim.clock.hour;
  // Silently adopt any milestone already satisfied at load time (e.g. a save
  // that predates this feature) so the next day doesn't spam a burst of
  // headlines for goals the player already earned. Runs last, after the tower,
  // transports and clock are fully restored, so the predicates read real state.
  for (const m of MILESTONES) if (!sim.achievedMilestones.has(m.id) && m.test(sim)) sim.achievedMilestones.add(m.id);
  return sim;
}

/** Convenience for the initial empty lot (ground lobby seed). The `mode`
 *  chosen at the New Tower screen is baked in here, at creation, and is
 *  immutable for the tower's life. */
export function newGame(seed = 12345, mode: GameMode = "classic", modernCalendar: CalendarKind = "realWorld"): Simulation {
  const sim = new Simulation(seed, mode, modernCalendar);
  // Seed a starter ground-floor lobby strip so the player has a base.
  const startX = Math.floor(GRID.width / 2) - 20;
  for (let i = 0; i < 40; i++) {
    sim.tower.place("lobby", 1, startX + i);
  }
  sim.emit("Welcome! Build floors, add elevators, and attract tenants.", "info");
  return sim;
}

import { serializeUnit, coerceLog, coerceView } from "./coerce";
