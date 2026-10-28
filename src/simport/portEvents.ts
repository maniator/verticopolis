import type { GameplayEventSource } from "../analyticsEngineBridge";
import type { GameplayEvent } from "../engine/gameplayEvents";
import type { EnginePort } from "./enginePort";

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

  /** `host` is the WASM mirror host's part, which goes with that host in PR
   *  5e: `held` hands over the events it holds back for a release (#874), and
   *  `marked` is the backdrop mark on its tower, which a fault fallback
   *  carries to the fresh tower in a new generation. */
  constructor(
    private readonly port: Pick<EnginePort, "drainEvents" | "eventText" | "setBackdrop" | "generation">,
    private readonly host?: { held(): GameplayEvent[]; marked(): boolean },
  ) {
    const isBackdrop = (): boolean => this.backdropGeneration === this.port.generation() || (this.host?.marked() ?? false);
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

  drainGameplayEvents(opts?: { release?: boolean }): GameplayEvent[] {
    const [dropped, count] = this.port.drainEvents();
    this.dropped = dropped;
    const out: GameplayEvent[] = [];
    for (let i = 0; i < count; i++) {
      const text = this.port.eventText(i);
      if (text !== undefined) out.push(JSON.parse(text) as GameplayEvent);
    }
    if (opts?.release && this.host) out.push(...this.host.held());
    return out;
  }

  get gameplayEventsDropped(): number {
    return this.dropped;
  }
}
