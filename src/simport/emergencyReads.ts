import type { EnginePort } from "./enginePort";
import type { BombSearchView, FireResponseView, PendingChoiceView } from "./view";

/**
 * The emergency reads the view reader makes from the frame header: the
 * pending choice, fetched once when its flag rises, and the bomb search and
 * the answer to a fire, each fetched again only when its sequence moves (0
 * means none runs).
 */
export class EmergencyReads {
  choice: PendingChoiceView | null = null;
  bomb: BombSearchView | null = null;
  fire: FireResponseView | null = null;
  private choiceUp = false;
  private bombSeq = 0;
  private fireSeq = 0;

  /** Forget them all, for a new tower (a generation change). */
  reset(): void {
    this.choiceUp = false;
    this.bombSeq = 0;
    this.bomb = null;
    this.fireSeq = 0;
    this.fire = null;
  }

  read(port: Pick<EnginePort, "pendingChoice" | "bombSearch" | "fireResponse">, choiceUp: boolean, bombSeq: number, fireSeq = 0): void {
    if (choiceUp && !this.choiceUp) {
      const text = port.pendingChoice();
      this.choice = text === undefined ? null : (JSON.parse(text) as PendingChoiceView);
    } else if (!choiceUp) {
      this.choice = null;
    }
    this.choiceUp = choiceUp;
    if (bombSeq !== this.bombSeq) {
      this.bombSeq = bombSeq;
      const text = bombSeq === 0 ? undefined : port.bombSearch?.();
      this.bomb = text === undefined ? null : (JSON.parse(text) as BombSearchView);
    }
    if (fireSeq !== this.fireSeq) {
      this.fireSeq = fireSeq;
      const text = fireSeq === 0 ? undefined : port.fireResponse?.();
      this.fire = text === undefined ? null : (JSON.parse(text) as FireResponseView);
    }
  }
}
