import { describe, it, expect } from "vitest";
import { EventSystem } from "../engine/EventSystem";
import { Tower } from "../engine/Tower";
import { Clock } from "../engine/Clock";
import { RNG } from "../engine/rng";
import type { LogKind } from "../engine/SimContext";
import type { FacilityKind } from "../engine/types";

/**
 * End-to-end coverage of every random EVENT through its real trigger — the
 * daily roll in {@link EventSystem.maybeRandomEvent} and the player's
 * emergency choice ({@link EventSystem.resolveChoice}). The individual event
 * mechanics (fire spread/containment, thief, Santa, weather, buried treasure,
 * the VIP inspection) are pinned elsewhere — fire.test.ts, phase2.test.ts,
 * weatherEvents.test.ts, simulation.test.ts, reviewFixes.test.ts,
 * parity.test.ts. What was NOT covered, and is here, are the interactive
 * choice flows and the star gating that decides which emergency can fire:
 *
 *  - a fire arriving on the daily roll and offering a rescue, then ACCEPT
 *    (blaze cleared, fee charged, rooms gutted) vs DECLINE (keeps burning);
 *  - a bomb threat arriving on the daily roll at 4★ (only the raw
 *    bombThreat() was tested before), then pay-the-ransom vs have-Security-
 *    search (defused) vs detonate (unguarded);
 *  - the star gates (no bomb below 4★) and the flavor-headline fallback;
 *  - the anti-stall guard: an unanswered choice auto-declines on the next roll.
 */

/** An RNG whose next() yields queued values first, then a real stream. Because
 *  chance()/pick()/int() all route through next(), queuing the raw floats
 *  scripts every downstream draw — so each event roll is deterministic. */
class ScriptedRNG extends RNG {
  private queue: number[];
  constructor(queue: number[], seed = 1) {
    super(seed);
    this.queue = queue;
  }
  next(): number {
    return this.queue.length ? (this.queue.shift() as number) : super.next();
  }
}

type Entry = { text: string; kind?: LogKind };

function makeCtx(tower: Tower, star: number, rng: RNG, money = 1_000_000) {
  return {
    tower,
    clock: new Clock(0),
    rng,
    money,
    star,
    simModel: "v1" as const,
    log: [] as Entry[],
    emit(text: string, kind?: LogKind) {
      this.log.push({ text, kind });
    },
    hasAny: (kind: FacilityKind) => tower.units.some((u) => u.kind === kind),
    hasOperational: (kind: FacilityKind) =>
      tower.units.some((u) => u.kind === kind && u.state !== "construction" && u.state !== "fire"),
    floorLabel: (floor: number) => (floor >= 1 ? `floor ${floor}` : `B${1 - floor}`),
  };
}

/** Small tower with finished (flammable — place() → "empty") offices on floors
 *  3–6, one per floor at x=0 so a fire has no same-floor neighbor to spread to.
 *  Floors are 20 wide because an office spans 9 tiles (see FACILITIES). */
function officeTower(opts: { security?: boolean } = {}): Tower {
  const W = 20;
  const tower = new Tower();
  for (let x = 0; x < W; x++) tower.place("lobby", 1, x);
  for (let x = 0; x < W; x++) tower.place("floor", 2, x);
  if (opts.security) tower.place("security", 2, 0);
  for (let f = 3; f <= 6; f++) {
    for (let x = 0; x < W; x++) tower.place("floor", f, x);
    tower.place("office", f, 0);
  }
  return tower;
}

const logHas = (ctx: { log: Entry[] }, needle: string) => ctx.log.some((e) => e.text.includes(needle));

describe("Fire event", () => {
  it("breaks out on a low daily roll (≥2★) and offers a rescue choice", () => {
    const ctx = makeCtx(officeTower(), 2, new ScriptedRNG([0])); // roll 0 < fireChance
    const events = new EventSystem(ctx, 7);
    events.maybeRandomEvent();
    expect(events.count).toBe(1);
    expect(events.pending?.kind).toBe("fireRescue");
    expect(events.pending?.cost).toBe(150_000); // scales from $150k at 2★
    expect(logHas(ctx, "Fire broke out")).toBe(true);
  });

  it("accepting the rescue charges the fee, ends the blaze, and guts the room", () => {
    const ctx = makeCtx(officeTower(), 2, new ScriptedRNG([0]), 1_000_000);
    const events = new EventSystem(ctx, 7);
    events.maybeRandomEvent();
    events.resolveChoice("accept");
    expect(ctx.money).toBe(1_000_000 - 150_000);
    expect(events.count).toBe(0);
    expect(ctx.tower.units.some((u) => u.state === "gutted")).toBe(true);
    expect(ctx.tower.units.some((u) => u.state === "fire")).toBe(false);
  });

  it("declining the rescue leaves the fire burning (fought the slow way)", () => {
    const ctx = makeCtx(officeTower(), 2, new ScriptedRNG([0]), 1_000_000);
    const events = new EventSystem(ctx, 7);
    events.maybeRandomEvent();
    events.resolveChoice("decline");
    expect(ctx.money).toBe(1_000_000); // no fee paid
    expect(events.count).toBe(1);
    expect(ctx.tower.units.some((u) => u.state === "fire")).toBe(true);
  });

  it("an unanswered choice auto-declines on the next roll — the game never stalls", () => {
    // First roll ignites + leaves the rescue pending; the second roll's
    // processFires draw (0.9) fails containment so the fire is still burning,
    // proving the pending choice was auto-declined, not silently paid.
    const ctx = makeCtx(officeTower(), 2, new ScriptedRNG([0, 0.9]));
    const events = new EventSystem(ctx, 7);
    events.maybeRandomEvent();
    expect(events.pending?.kind).toBe("fireRescue");
    events.maybeRandomEvent();
    expect(events.pending).toBeNull(); // stale choice cleared
    expect(events.count).toBeGreaterThanOrEqual(1); // and it was declined, not paid
  });
});

describe("Bomb-threat event — the 4★ daily roll and its choice", () => {
  // roll 0.05 clears the fire window (0.025) but lands inside the bomb window
  // (fireChance + 0.05) — the branch only reachable at 4★+.
  it("arrives on the daily roll only at 4★ and up", () => {
    const ctx = makeCtx(officeTower(), 4, new ScriptedRNG([0.05]));
    const events = new EventSystem(ctx, 7);
    events.maybeRandomEvent();
    expect(events.pending?.kind).toBe("bombThreat");
    expect(events.pending?.cost).toBe(300_000);
  });

  it("never fires below 4★ (a 3★ roll in the same window yields no threat)", () => {
    const ctx = makeCtx(officeTower(), 3, new ScriptedRNG([0.05, 0.9]));
    const events = new EventSystem(ctx, 7);
    events.maybeRandomEvent();
    expect(events.pending).toBeNull();
  });

  it("paying the ransom deducts the money and the threat passes quietly", () => {
    const ctx = makeCtx(officeTower(), 4, new ScriptedRNG([0.05]), 1_000_000);
    const events = new EventSystem(ctx, 7);
    events.maybeRandomEvent();
    events.resolveChoice("accept");
    expect(ctx.money).toBe(1_000_000 - 300_000);
    expect(logHas(ctx, "ransom")).toBe(true);
    expect(ctx.tower.units.some((u) => u.state === "gutted")).toBe(false);
  });

  it("declining with Security has it swept and found empty — no rooms destroyed", () => {
    const ctx = makeCtx(officeTower({ security: true }), 4, new ScriptedRNG([0.05]));
    const events = new EventSystem(ctx, 7);
    events.maybeRandomEvent();
    expect(events.pending?.kind).toBe("bombThreat");
    events.resolveChoice("decline");
    expect(logHas(ctx, "found nothing")).toBe(true);
    expect(ctx.tower.units.some((u) => u.state === "gutted")).toBe(false);
  });

  it("declining with no Security detonates and guts rooms across ~5 floors", () => {
    const ctx = makeCtx(officeTower(), 4, new ScriptedRNG([0.05]));
    const events = new EventSystem(ctx, 7);
    events.maybeRandomEvent();
    events.resolveChoice("decline");
    expect(logHas(ctx, "detonated")).toBe(true);
    expect(ctx.tower.units.filter((u) => u.state === "gutted").length).toBeGreaterThan(0);
  });
});

describe("Flavor headline — the daily-roll fallback", () => {
  it("surfaces an occasional headline when no emergency fires", () => {
    // roll 0.5 misses the fire window; chance(0.15)→0.1 hits; chance(0.5)→0.0 = praise.
    const ctx = makeCtx(officeTower(), 2, new ScriptedRNG([0.5, 0.1, 0.0]));
    const events = new EventSystem(ctx, 7);
    events.maybeRandomEvent();
    expect(logHas(ctx, "praised")).toBe(true);
    expect(events.count).toBe(0);
    expect(events.pending).toBeNull();
  });
});
