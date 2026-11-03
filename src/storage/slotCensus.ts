/**
 * The population a slot's save would load with, which the Saves dialog and the
 * title screen's tower picker show on each row. The engine counts it: the
 * rules that decide who lives in a tower live in the Rust crate, so the
 * storage layer holds no copy of them and no parsed tower. The game installs
 * the reader once the engine package has loaded (`bootstrap.ts`), the way it
 * installs the engine's `.vctower` writer (`vctowerWriter.ts`).
 */
export type SlotPopulationReader = (text: string) => number;

let reader: SlotPopulationReader | null = null;

/** Count populations through `next` from now on, or (with null) not at all. */
export function setSlotPopulationReader(next: SlotPopulationReader | null): void {
  reader = next;
}

/**
 * The population `text` loads with, or undefined while no engine is installed
 * (a row then shows its other facts and no census). Throws when the engine
 * refuses the save, so a caller can treat that slot as one it cannot load.
 */
export function slotPopulation(text: string): number | undefined {
  return reader ? reader(text) : undefined;
}
