import type { EnginePort } from "./enginePort";
import type { BombSearchView, PendingChoiceView } from "./view";

/**
 * The emergency reads the view reader makes from the frame header: the
 * pending choice, fetched once when its flag rises, and Classic's bomb
 * search, fetched again only when its sequence moves (0 means none runs).
 */
export class EmergencyReads {
  choice: PendingChoiceView | null = null;
  bomb: BombSearchView | null = null;
  private choiceUp = false;
  private bombSeq = 0;

  /** Forget both, for a new tower (a generation change). */
  reset(): void {
    this.choiceUp = false;
    this.bombSeq = 0;
    this.bomb = null;
  }

  read(port: Pick<EnginePort, "pendingChoice" | "bombSearch">, choiceUp: boolean, bombSeq: number): void {
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
  }
}
