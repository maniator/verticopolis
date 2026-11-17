/**
 * The file the live tower is (`fileSpaceCommands.ts`): the one it was opened
 * from, saved as, or given when it was founded (`towerDocument.ts`). It is
 * either a My Towers file, by id, or a file in the linked folder on the
 * player's computer (`linkedFolderCommands.ts`), by its name there; never
 * both. Any other tower arriving (a new one, a load, an import) forgets it
 * (`towerFollow.ts`), so File > Save never writes one tower over another
 * tower's file. An undo or redo step is the same tower and keeps it.
 *
 * Kept in this page's memory; `towerDocument.ts` hears every change and
 * remembers it beside the crash copy, so a reload finds the file again.
 */
let current: string | null = null;
let currentLinked: string | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** The My Towers file the live tower is, by id. */
export function currentFileId(): string | null {
  return current;
}

export function setCurrentFile(id: string | null): void {
  current = id;
  currentLinked = null;
  changed();
}

/** The linked folder's file the live tower is, by its name there. */
export function currentLinkedFile(): string | null {
  return currentLinked;
}

export function setCurrentLinkedFile(id: string | null): void {
  currentLinked = id;
  current = null;
  changed();
}

/** Another tower arrived. */
export function forgetCurrentFile(): void {
  current = null;
  currentLinked = null;
  changed();
}

/** Hear every change of the live tower's file; returns the unsubscribe. */
export function onCurrentFileChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
