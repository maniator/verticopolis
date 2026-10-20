import { catalogFor } from "../engine/catalog";
import type { WasmEngine, WasmModule } from "../dualrun/binding";
import { FRAME_HEADER } from "./frameView";

/**
 * An engine stand-in for the headless worker-host tests: built from a save,
 * its clock moves by every tick's minutes, its money follows `setMoney`, its
 * revision moves on every other command, and every call is recorded. Any
 * command the shadow sends that is not modeled is accepted and recorded.
 */
export class FakeEngine {
  calls: string[] = [];
  minutes: number;
  money: number;
  star: number;
  revision = 0;
  hourRuns = 0;
  logSeq = 0;
  freed = false;
  owed: unknown[] = [];
  dropped = 0;
  pending: string | undefined = undefined;
  /** Throw from the next call of this name. */
  failOn: string | null = null;
  constructor(private readonly save: string) {
    const data = JSON.parse(save) as { minutes: number; money: number; star?: number };
    this.minutes = data.minutes;
    this.money = data.money;
    this.star = data.star ?? 1;
  }
  frameView(): Float64Array {
    const v = new Float64Array(FRAME_HEADER);
    v[0] = this.minutes;
    v[1] = this.revision;
    v[3] = this.logSeq;
    v[4] = this.money;
    v[5] = this.star;
    v[21] = this.pending ? 1 : 0;
    v[22] = this.hourRuns;
    return v;
  }
  serialize(): string {
    const data = JSON.parse(this.save) as Record<string, unknown>;
    return JSON.stringify({ ...data, minutes: this.minutes, money: this.money });
  }
  tick(dt: number): void {
    this.check("tick");
    this.minutes += dt;
    if (Math.floor(this.minutes / 60) !== Math.floor((this.minutes - dt) / 60)) this.hourRuns++;
  }
  setMoney(amount: number): void {
    this.check("setMoney");
    this.money = amount;
  }
  emit(text: string): void {
    this.check("emit");
    this.calls.push(`emit ${text}`);
    this.logSeq++;
  }
  free(): void { this.freed = true; }
  pendingChoice(): string | undefined { return this.pending; }
  logSince(seq: number): string {
    return JSON.stringify(Array.from({ length: this.logSeq - seq }, (_, i) => ({ seq: seq + i + 1, minute: this.minutes, text: `line ${seq + i + 1}`, kind: "info" })));
  }
  elevatorTelemetry(): string { return '{"util":[],"hourly":[],"origins":[]}'; }
  housekeepingReport(): string | undefined { return undefined; }
  commuteRows = "[]";
  commuteRevision = 0;
  commuteStress(): string { return this.commuteRows; }
  commuteStressRevision(): number { return this.commuteRevision; }
  drainGameplayEvents(): string {
    const out = JSON.stringify(this.owed);
    this.owed = [];
    return out;
  }
  gameplayEventsPending(): number { return this.owed.length; }
  gameplayEventsDropped(): number { return this.dropped; }
  private check(name: string): void {
    if (this.failOn === name) {
      this.failOn = null;
      throw new Error(`${name} failed`);
    }
  }
}

export function fakeModule(): WasmModule & { engines: FakeEngine[] } {
  const engines: FakeEngine[] = [];
  const Engine = {
    fromSave(save: string) {
      if (save === "refuse") throw new Error("bad save");
      const e = new FakeEngine(save);
      engines.push(e);
      // Commands the fake does not model are recorded and accepted.
      return new Proxy(e, {
        get(target, key) {
          if (key in target || typeof key !== "string") return (target as unknown as Record<string | symbol, unknown>)[key];
          return (...args: unknown[]) => {
            target.calls.push(`${key} ${JSON.stringify(args)}`);
            target.revision++;
          };
        },
      }) as unknown as WasmEngine;
    },
  };
  const catalog = (mode: string) => JSON.stringify(catalogFor(mode as "classic" | "modern"));
  return { Engine: Engine as unknown as WasmModule["Engine"], catalog, engines };
}
