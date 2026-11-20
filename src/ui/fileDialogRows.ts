import type { TowerFileEntry } from "../storage/fileSpace";
import type { FileDialogView, FileFilter, FileRow, FileSortKey } from "./templates/fileDialog";

/** The rows the Open and Save As windows list (`fileDialog.ts`). */

const TYPE_ORDER: Readonly<Record<FileRow["type"], number>> = { auto: 0, tower: 1, tdt: 2 };

/** The window's tower count and size, with the Auto-save when it is listed,
 *  so the header counts every tower the window shows. */
export function withAuto(
  usage: { count: number; bytes: number },
  auto: FileRow | null,
): { count: number; bytes: number } {
  return auto ? { count: usage.count + 1, bytes: usage.bytes + (auto.size ?? 0) } : usage;
}

/** The rows a window shows: the Auto-save first, then the files that pass
 *  the filter, in the chosen order. */
export function fileRows(
  auto: FileRow | null,
  files: readonly TowerFileEntry[],
  filter: FileFilter,
  sort: FileDialogView["sort"],
): FileRow[] {
  const rows: FileRow[] = files
    .filter((f) => filter === "all" || f.kind === filter)
    .map((f) => ({ id: f.id, name: f.name, type: f.kind, size: f.size, modified: f.modified }));
  const by: Record<FileSortKey, (a: FileRow, b: FileRow) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
    type: (a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type],
    size: (a, b) => (a.size ?? 0) - (b.size ?? 0),
    modified: (a, b) => (a.modified ?? 0) - (b.modified ?? 0),
  };
  rows.sort((a, b) => (sort.down ? -1 : 1) * by[sort.key](a, b) || by.name(a, b));
  return auto && filter === "all" ? [auto, ...rows] : rows;
}
