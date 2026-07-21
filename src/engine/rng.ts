/**
 * Mulberry32 — a tiny, fast, deterministic PRNG. Determinism matters so the
 * simulation can be tested and save/load reproduces the same world.
 */
export class RNG {
  private state: number;
  /** The seed this stream was constructed with, fixed for the stream's whole
   *  life, unlike {@link seed}, which is the live mutating state. Persistent
   *  cosmetic looks (the scenery outside the lot) key off this so they never
   *  reshuffle mid-game; save/load carries it so they survive sessions too. */
  initialSeed: number;

  constructor(seed = 1) {
    this.state = seed >>> 0 || 1;
    this.initialSeed = seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  get seed(): number {
    return this.state >>> 0;
  }
}
