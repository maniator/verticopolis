import type { SimContext } from "./SimContext";
import type { Unit } from "./types";
import { isOperational, isPresent, isTenanted } from "./types";
import { FACILITIES } from "./facilities";
import { RNG } from "./rng";

/**
 * SimTower's signature emergencies — fires (which spread unless contained) and
 * bomb threats — extracted from {@link Simulation} so the disaster logic owns
 * its own state (the set of burning units) and can be tested in isolation
 * against a small {@link SimContext}.
 */
export class EventSystem {
  /** Ids of units currently ablaze (a fire emergency in progress). */
  private active = new Set<number>();
  /** Dedicated RNG for the seasonal/visitor events, so adding them never
   * disturbs the gameplay RNG stream the rest of the sim depends on. */
  private extra: RNG;
  /** Year index of the last Santa visit, so he comes at most once a year. */
  private lastSantaYear = -1;

  /** A player decision awaiting resolution (canon: pay for fire rescue, or pay a
   * bomb ransom vs. search). The UI surfaces it and calls {@link resolveChoice};
   * if it's still open at the next daily event roll it auto-declines. */
  pending: { kind: "fireRescue" | "bombThreat"; cost: number; message: string } | null = null;

  /** Coverage radius (floors) for services in the v2 spatial model (review F15):
   * a Security/Medical office only speeds the emergency response within this many
   * floors, so one in a basement corner can't protect a floor-100 fire and a
   * tall tower needs several — which is why the original caps each at 10. */
  private static readonly SECURITY_RADIUS = 8;
  private static readonly MEDICAL_RADIUS = 12;

  /** Daily chance a thief prowls the tower (≥2★). Deliberately low so the cameo
   * reads as the occasional event it is in the original — not a constant parade.
   * At top speed (~12s/game-day) this is a thief roughly every ~8 minutes. */
  private static readonly THIEF_DAILY_CHANCE = 0.025;

  constructor(private readonly sim: SimContext, seed = 1) {
    this.extra = new RNG((seed ^ 0x5a17a) >>> 0);
  }

  /** Persist the seasonal-event state (RNG position + Santa guard) AND any open
   * player choice, so saving mid-threat can't dodge a bomb. */
  saveState(): { lastSantaYear: number; rngState: number; pending?: typeof EventSystem.prototype.pending } {
    return { lastSantaYear: this.lastSantaYear, rngState: this.extra.seed, pending: this.pending };
  }

  /** Restore seasonal-event state from a save (no-op for older saves). Coerces
   * the fields, since saves are untrusted and may be hand-edited or stale. */
  loadState(state?: { lastSantaYear: number; rngState: number; pending?: typeof EventSystem.prototype.pending }): void {
    if (!state) return;
    const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
    this.lastSantaYear = num(state.lastSantaYear, -1);
    this.extra = new RNG(num(state.rngState, 1) >>> 0 || 1);
    // Restore an unresolved choice (a bomb threat survives save/reload).
    const p = state.pending;
    this.pending =
      p && (p.kind === "fireRescue" || p.kind === "bombThreat") && Number.isFinite(p.cost)
        ? { kind: p.kind, cost: p.cost, message: String(p.message ?? "") }
        : null;
  }

  /** Number of units currently on fire (for the UI / stats). */
  get count(): number {
    return this.active.size;
  }

  /** Re-arm ongoing fires after loading a save (idempotent — replaces, not adds). */
  restore(unitIds: Iterable<number>): void {
    this.active.clear();
    for (const id of unitIds) this.active.add(id);
  }

  /** Roll the daily event: resolve any ongoing fire, then maybe start a new one. */
  maybeRandomEvent(): void {
    // A choice the player left unanswered defaults (fire keeps burning / the
    // tower is searched) so the game can't stall waiting on a modal.
    if (this.pending) this.resolveChoice("decline");
    // An ongoing fire is fought (or spreads) every day until it's out.
    this.processFires();
    // Seasonal / visitor events roll on their own RNG, independent of the
    // emergency rolls below, so they never shift the gameplay sequence.
    this.maybeSanta();
    this.maybeThief();
    if (this.sim.star < 2) return;

    const roll = this.sim.rng.next();
    const fireChance = this.fireChance();
    if (this.active.size === 0 && roll < fireChance) {
      this.startFire();
      // Canon: Security fights fires for free; the fire-rescue helicopter puts it
      // out instantly for a fee. That fee scales with the tower so it's payable
      // early (~$150k at 2★) and reaches the original's $500k for a 5★ skyscraper.
      if (this.active.size > 0) {
        const cost = this.fireRescueCost();
        this.pending = {
          kind: "fireRescue",
          cost,
          message: `🚒 Fire rescue available for $${cost.toLocaleString()}. Pay to stop the spread and save the tower now, or decline and fight it the slow way. Either way the rooms already ablaze burn down to gutted shells you'll rebuild; the fee just limits how far the fire spreads.`,
        };
        this.sim.emit(this.pending.message, "bad");
        // Telegraph the free defense to a player who hasn't built one yet. Use
        // "bad" so it surfaces as a toast during the emergency — the UI only
        // pops toasts for good/bad log entries, and "info" would hide in the log.
        if (!this.sim.hasAny("security")) {
          this.sim.emit("Tip: a Security office fights fires for free. Build one to defend your tower.", "bad");
        }
      }
      return;
    }
    // Bomb threats target prestigious towers (4★ and up): pay the ransom or
    // have Security search (canon).
    if (this.sim.star >= 4 && roll < fireChance + 0.05) {
      this.pending = {
        kind: "bombThreat",
        cost: 300_000,
        message: "💣 A caller demands a $300,000 ransom or a bomb detonates. Pay, or have Security search the tower.",
      };
      this.sim.emit(this.pending.message, "bad");
      return;
    }
    // Otherwise the occasional flavorful headline.
    if (this.sim.rng.chance(0.15)) {
      if (this.sim.rng.chance(0.5)) this.sim.emit("A local newspaper praised your tower's design.", "good");
      else this.sim.emit("Tenants are happy with the tower today.", "info");
    }
  }

  /** Resolve the open player choice. `accept` pays (fire rescue / bomb ransom);
   * `decline` lets the fire burn on / has Security search for the bomb. */
  resolveChoice(option: "accept" | "decline"): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    if (p.kind === "fireRescue") {
      if (option === "accept" && this.sim.money >= p.cost) {
        this.sim.money -= p.cost;
        this.extinguishAll();
        this.sim.emit(
          `🚒 Fire-rescue crews saved the tower for $${p.cost.toLocaleString()}. The rooms that were ablaze are gutted. Bulldoze and rebuild them.`,
          "money",
        );
      }
      // decline → the fire keeps burning; processFires fights it each day.
      return;
    }
    // bombThreat
    if (option === "accept" && this.sim.money >= p.cost) {
      this.sim.money -= p.cost;
      this.sim.emit(`💣 You paid the $${p.cost.toLocaleString()} ransom; the threat passed quietly.`, "money");
    } else {
      this.bombThreat(); // search: Security defuses it, else it detonates (~5 floors)
    }
  }

  /** Reduce a burned unit to a gutted shell — inert until bulldozed & rebuilt.
   *  Single source of truth for the fire-destroys-rooms transition (canon:
   *  fires never silently restore a room to a fresh, re-leasable one). */
  private gut(u: Unit): void {
    u.state = "gutted";
    u.occupants = 0;
    u.everOccupied = false;
    // A gutted shell houses no one: drop any Modern household so it stops counting
    // toward the Households readout (it's already excluded from the population
    // census, which keys off isPresent — this keeps the two from disagreeing).
    u.residents = undefined;
    u.satisfaction = 0;
    u.pendingIncome = 0;
    u.label = FACILITIES[u.kind].name;
  }

  /** End every active fire (the paid rescue outcome). The fee halts the spread
   *  and ends the panic — it does NOT un-burn: rooms that were ablaze are gutted. */
  private extinguishAll(): void {
    for (const id of [...this.active]) {
      const u = this.sim.tower.getUnit(id);
      if (u && u.state === "fire") this.gut(u);
    }
    this.active.clear();
  }

  /**
   * Daily chance a fire breaks out, reduced by the fire-defense you've built.
   * Security (buildable from 2★) is the free front-line defense; a medical
   * center's fast emergency response cuts the odds further. Building both makes
   * fires rare — investing in safety visibly pays off.
   *
   * Rates are per in-game day, and days elapse fast at top speed (~12s/day), so
   * the base is deliberately low and Security is a strong deterrent — otherwise
   * fires read as constant rather than the occasional emergency they are in the
   * original. Approx. mean gap between fires at top speed: ~8 min with nothing
   * built, ~18 min once you have Security, ~35 min with Security + Medical.
   *
   * Only *operational* stations count (not one under construction or itself on
   * fire), matching the spatial v2 containment check.
   */
  fireChance(): number {
    let chance = 0.025;
    if (this.sim.hasOperational("security")) chance *= 0.45;
    if (this.sim.hasOperational("medical")) chance *= 0.5;
    return chance;
  }

  /**
   * Cost of the instant fire-rescue helicopter. Scales with the tower's rating
   * so it's affordable while you're small (~$150k at 2★) and rises to the
   * original's $500k for a 5★ tower.
   */
  private fireRescueCost(): number {
    return Math.min(500_000, 150_000 + Math.max(0, this.sim.star - 2) * 120_000);
  }

  /** Rooms that can catch fire (real, finished rooms — not structure). */
  private flammableUnits(): Unit[] {
    return this.sim.tower.units.filter(
      (u) =>
        u.kind !== "floor" &&
        u.kind !== "lobby" &&
        u.state !== "construction" &&
        u.state !== "fire" &&
        u.state !== "gutted", // a husk can't re-ignite
    );
  }

  /** Ignite a random room. */
  startFire(): void {
    const candidates = this.flammableUnits();
    if (candidates.length === 0) return;
    const u = this.sim.rng.pick(candidates);
    u.state = "fire";
    u.occupants = 0;
    this.active.add(u.id);
    this.sim.emit(`🔥 Fire broke out in ${FACILITIES[u.kind].name} on ${this.sim.floorLabel(u.floor)}!`, "bad");
  }

  /** True if an operational unit of `kind` is within `radius` floors of `floor`. */
  private serviceWithin(kind: Unit["kind"], floor: number, radius: number): boolean {
    return this.sim.tower.units.some(
      (u) => u.kind === kind && isOperational(u) && Math.abs(u.floor - floor) <= radius, // a gutted station gives no coverage
    );
  }

  /**
   * Probability a fire on `floor` is contained this day. In v2 the Security /
   * Medical bonuses apply only if a station is within its coverage radius of the
   * fire (spatial, review F15); in v1 they apply tower-wide if one exists at all.
   */
  controlChance(floor: number): number {
    const v2 = this.sim.simModel === "v2";
    const sec = v2
      ? this.serviceWithin("security", floor, EventSystem.SECURITY_RADIUS)
      : this.sim.hasAny("security");
    const med = v2
      ? this.serviceWithin("medical", floor, EventSystem.MEDICAL_RADIUS)
      : this.sim.hasAny("medical");
    // Base is deliberately > 1/3 so a player who can't yet afford Security or the
    // rescue fee isn't trapped in a spreading, satisfaction-draining death spiral;
    // Security/Medical still add a clear, meaningful bonus on top.
    return 0.5 + (sec ? 0.2 : 0) + (med ? 0.3 : 0);
  }

  /** The room immediately left or right of a unit on the same floor. */
  private adjacentRoom(u: Unit): Unit | undefined {
    return this.sim.tower.roomAt(u.floor, u.x - 1) ?? this.sim.tower.roomAt(u.floor, u.x + u.width);
  }

  /**
   * Resolve active fires. Security and especially a medical center speed the
   * emergency response; without them a blaze is more likely to spread to the
   * neighboring room before it's contained — the core reason to staff your
   * tower in the original game.
   */
  private processFires(): void {
    if (this.active.size === 0) return;
    for (const id of [...this.active]) {
      const u = this.sim.tower.getUnit(id);
      if (!u || u.state !== "fire") {
        this.active.delete(id);
        continue;
      }
      // Response speed depends on whether a station covers THIS fire's floor (v2).
      const control = this.controlChance(u.floor);
      if (this.sim.rng.chance(control)) {
        // Contained: the blaze stops spreading, but the room is destroyed — a
        // gutted shell the player must bulldoze and rebuild (canon; no repair).
        this.gut(u);
        this.active.delete(id);
        this.sim.emit(
          `🔥 The ${FACILITIES[u.kind].name} on ${this.sim.floorLabel(u.floor)} burned down. Only a gutted shell remains. Bulldoze the rubble and rebuild.`,
          "bad",
        );
      } else {
        const next = this.adjacentRoom(u);
        // Small-tower safety valve: never consume the LAST operational room of its
        // kind, so one blaze can't wipe a starter tower to zero of something.
        // Count with an early exit (no per-spread array allocation).
        let opsOfKind = 0;
        if (next) {
          for (const x of this.sim.tower.units) {
            if (x.kind === next.kind && isOperational(x) && ++opsOfKind > 1) break;
          }
        }
        const lastOfKind = !!next && opsOfKind <= 1;
        // adjacentRoom() returns only room-layer units (never floor/lobby) and
        // isOperational() already excludes fire — so the guard is just these two.
        if (next && !lastOfKind && isOperational(next)) {
          next.state = "fire";
          next.occupants = 0;
          this.active.add(next.id);
          this.sim.emit(`The fire spread to ${FACILITIES[next.kind].name} on ${this.sim.floorLabel(next.floor)}!`, "bad");
        }
      }
    }
    // An active emergency rattles everyone still in the building.
    if (this.active.size > 0) {
      for (const u of this.sim.tower.units) {
        if (isTenanted(u) || u.state === "asleep") {
          u.satisfaction = Math.max(0, u.satisfaction - 0.05);
        }
      }
    }
  }

  /**
   * Santa visits a respectable tower (3★+) once a year over the holidays — a
   * cameo only, with no gift, exactly as the original ("No presents, sorry").
   */
  private maybeSanta(): void {
    const year = Math.floor(this.sim.clock.day / 360);
    const dayOfYear = ((this.sim.clock.day % 360) + 360) % 360;
    // The last stretch of the year is "the holidays".
    if (dayOfYear < 340 || this.sim.star < 3 || year === this.lastSantaYear) return;
    if (!this.extra.chance(0.4)) return; // not every holiday day
    this.lastSantaYear = year;
    // Canon: Santa is a seasonal cameo only — "No presents, sorry." (No cash.)
    this.sim.emit("🎅 Santa was spotted crossing the sky above your tower for the holidays!", "good");
    this.sim.triggerSanta?.(); // fly the sleigh across the sky (cosmetic)
  }

  /**
   * A thief occasionally slips into the tower. Security catches them; without
   * a guard on duty they make off with some cash — another reason to staff up.
   */
  private maybeThief(): void {
    if (this.sim.star < 2) return;
    if (!this.extra.chance(EventSystem.THIEF_DAILY_CHANCE)) return;
    // Anchor the cosmetic to a real floor so the thief prowls the tower rather
    // than floating across mid-screen (see TowerEngine.renderThief).
    const floor = this.thiefFloor();
    if (this.sim.hasAny("security")) {
      this.sim.emit("🕵️ Security caught a thief prowling the tower. Nothing was taken.", "good");
      this.sim.triggerThief?.(true, floor); // caught: a guard trails him across (cosmetic)
      return;
    }
    const loss = 5_000 + this.extra.int(0, 20_000);
    this.sim.money -= loss;
    this.sim.emit(`🕵️ A thief slipped through the tower and made off with $${loss.toLocaleString()}. Build Security.`, "bad");
    this.sim.triggerThief?.(false, floor); // got away with the loot (cosmetic)
  }

  /**
   * Pick a floor for the thief to prowl: a random *inhabited floor* (so he shows
   * up where people actually are), falling back to the ground lobby when no one
   * is home yet. "Inhabited" uses {@link isPresent} — the same census predicate
   * the population count uses — so it counts sleeping hotel guests (`asleep`),
   * not just leases; otherwise an all-hotel tower (or any tower at night) would
   * always fall back to the lobby. Selection is over the set of *distinct*
   * inhabited floors, so it's floor-uniform — a floor holding several occupied
   * units is no likelier to be picked than one holding a single tenant. Drawn on
   * the seasonal-event RNG so it never perturbs the gameplay stream — and only
   * *after* the daily chance passes, so a day with no thief consumes no extra RNG.
   */
  private thiefFloor(): number {
    const floors = [...new Set(this.sim.tower.units.filter((u) => isPresent(u)).map((u) => u.floor))];
    return floors.length === 0 ? 1 : this.extra.pick(floors);
  }

  /** A bomb scare. Security defuses it; without guards it does real damage. */
  bombThreat(): void {
    if (this.sim.hasAny("security")) {
      const cost = 2_000 + this.sim.rng.int(0, 3_000);
      this.sim.money -= cost;
      this.sim.emit(`💣 A bomb threat was called in. Security swept the tower and found nothing. The evacuation cost $${cost.toLocaleString()}.`, "info");
      return;
    }
    const fine = 15_000 + this.sim.rng.int(0, 15_000);
    this.sim.money -= fine;
    // Canon: an undetected bomb levels roughly five floors. Pick an epicenter and
    // destroy every room within ±2 floors of it — a genuine catastrophe, not the
    // loss of a single room — so leaving the tower unguarded is dangerous.
    const targets = this.flammableUnits();
    let destroyed = 0;
    if (targets.length > 0) {
      const ground = this.sim.rng.pick(targets);
      const epicenter = ground.floor;
      // Flash the blast at the epicenter room's true center (fractional tile, so
      // worldToScreenX places the starburst dead-center for any room width).
      this.sim.triggerExplosion?.(epicenter, ground.x + ground.width / 2);
      for (const u of this.sim.tower.units) {
        if (
          Math.abs(u.floor - epicenter) <= 2 &&
          u.kind !== "floor" &&
          u.kind !== "lobby" &&
          u.state !== "construction" &&
          u.state !== "gutted" // already destroyed — don't revive or double-count
        ) {
          this.active.delete(u.id); // a burning unit caught in the blast is cleared
          this.gut(u); // destroyed rooms become gutted shells (rebuild), like a fire
          destroyed++;
        }
      }
    }
    this.sim.emit(`💣 A bomb detonated with no security to stop it. ${destroyed} room(s) across ~5 floors were gutted, plus a $${fine.toLocaleString()} fine. Build Security!`, "bad");
  }
}
