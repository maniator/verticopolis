import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/serializedGame";
import { markFounderFromLoadedFile } from "../../engine/sim/founderStatus";
import { decodeVctower } from "../../storage/vctowerContainer";
import { REPO_ROOT } from "./scenario";

/** A `.vctower` fixture opened on the TypeScript engine the way the game
 *  loads a file, founder status included. `edit` may change the decoded
 *  save first. */
export function loadFixture(file: string, edit: (raw: SerializedGame) => SerializedGame = (raw) => raw): Simulation {
  const raw = edit(decodeVctower(readFileSync(resolve(REPO_ROOT, file), "utf8"), file) as SerializedGame);
  const sim = Simulation.deserialize(raw);
  markFounderFromLoadedFile(sim, raw);
  return sim;
}

/** Every save under the fixtures directory, so a new one is covered. */
export const FIXTURES = readdirSync(resolve(REPO_ROOT, "conformance/fixtures"))
  .filter((f) => f.endsWith(".vctower"))
  .sort()
  .map((f) => `conformance/fixtures/${f}`);
