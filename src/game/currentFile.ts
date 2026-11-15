/**
 * The My Towers file the live tower is (`fileSpaceCommands.ts`): the one it
 * was opened from or last saved as, by id. Any other tower arriving (a new
 * one, a load, an import) forgets it (`towerFollow.ts`), so File > Save never
 * writes one tower over another tower's file. An undo or redo step is the
 * same tower and keeps it. Kept in this page's memory only.
 */
let current: string | null = null;

export function currentFileId(): string | null {
  return current;
}

export function setCurrentFile(id: string | null): void {
  current = id;
}

/** Another tower arrived. */
export function forgetCurrentFile(): void {
  current = null;
}
