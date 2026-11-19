import type { GameplayEvent } from "../events/gameplayEvents";
import type { EnginePort } from "./enginePort";

/** What the analytics bridge drains: the live `Simulation` (whose drain
 *  the WASM host overrides to answer with its engine's batch). `release` is the session's
 *  own flush (a hide, or a window closing): a host that holds a command's
 *  events back until its engine's state covers them (the WASM host, #874)
 *  lets them go then, so a page that closes keeps them. `release` is
 *  temporary, with that fallback (story-engine-retire-typescript.md). */
export interface GameplayEventSource {
  drainGameplayEvents(opts?: { release?: boolean }): GameplayEvent[];
  readonly gameplayEventsDropped: number;
  readonly gameplayEvents: { readonly discardOnHandOff: boolean };
}

/**
 * The engine's gameplay events through the port (`drainEvents`, `eventText`),
 * in the shape the analytics bridge drains (`GameplayEventSource`). Drained
 * once per frame and once more when the session flushes.
 *
 * The title backdrop is marked here (`setBackdrop`), so the bridge can drop
 * its events while it is up. The engine forgets the mark on any swap, and so
 * does this source: the mark holds for the generation it was set in.
 */
export class PortEvents implements GameplayEventSource {
  private dropped = 0;
  private backdropGeneration = NaN;
  /** Read by the bridge on every drain, so it is one object. */
  readonly gameplayEvents: { readonly discardOnHandOff: boolean };

  constructor(private readonly port: Pick<EnginePort, "drainEvents" | "eventText" | "setBackdrop" | "generation">) {
    const isBackdrop = (): boolean => this.backdropGeneration === this.port.generation();
    this.gameplayEvents = {
      get discardOnHandOff() {
        return isBackdrop();
      },
    };
  }

  setBackdrop(on: boolean): void {
    this.port.setBackdrop(on);
    this.backdropGeneration = on ? this.port.generation() : NaN;
  }

  drainGameplayEvents(): GameplayEvent[] {
    const [dropped, count] = this.port.drainEvents();
    this.dropped = dropped;
    const out: GameplayEvent[] = [];
    for (let i = 0; i < count; i++) {
      const text = this.port.eventText(i);
      if (text !== undefined) out.push(JSON.parse(text) as GameplayEvent);
    }
    return out;
  }

  get gameplayEventsDropped(): number {
    return this.dropped;
  }
}
