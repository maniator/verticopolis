import { addPlayerTextSource, nameAndStem } from "../analyticsPlayerText";
import { fileSpace } from "../storage/fileSpace";
import { linkedFolder } from "../storage/linkedFolder";
import { recentTowers, type RecentTower } from "../storage/recentTowers";

/**
 * Tell the error reporter's scrubber (`analyticsPlayerText.ts`, #607) where the
 * player's own names live, so an error that quotes one is sent without it:
 * - the open tower's name, from the engine and from the name box on screen
 *   (an engine that trapped throws on every call, and its tower's name must
 *   still be known);
 * - every file in My Towers and in the linked folder;
 * - every tower in File > Open Recent.
 *
 * Each source is read only when a report is about to be sent (a few times a page
 * life at most), never on a pump, tick or frame. A file name is listed with and
 * without its extension, since a message may quote either.
 */

/** The narrow piece of the app this reads: the open tower's name, from the
 *  engine and from the name box the UI shows. The UI is assigned after the
 *  controllers are wired, so it may not be there yet. */
export interface PlayerTextApp {
  readonly enginePort: { towerName(): string | undefined };
  readonly ui?: { readonly el: { readonly towerName: { readonly value: string } } };
}

/** Every name in a list of files or recent towers, with its stem. */
function* namesOf(entries: Iterable<{ readonly name: string }>): Iterable<string> {
  for (const e of entries) yield* nameAndStem(e.name);
}

/** A recent tower's shown name, and for a linked folder file its name on disk
 *  (its id), each with its stem. */
function* recentNames(list: readonly RecentTower[]): Iterable<string> {
  for (const t of list) {
    yield* nameAndStem(t.name);
    if (t.place === "folder") yield* nameAndStem(t.id);
  }
}

let unwire: (() => void) | null = null;

/** Register the game's sources once; a second call replaces the first. */
export function wirePlayerTextSources(app: PlayerTextApp): void {
  unwire?.();
  const off = [
    addPlayerTextSource(() => [app.enginePort.towerName()]),
    addPlayerTextSource(() => [app.ui?.el.towerName.value]),
    addPlayerTextSource(() => namesOf(fileSpace.list())),
    addPlayerTextSource(() => namesOf(linkedFolder.list())),
    addPlayerTextSource(() => recentNames(recentTowers())),
  ];
  unwire = () => off.forEach((remove) => remove());
}
