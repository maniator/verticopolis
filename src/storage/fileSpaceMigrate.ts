import { fileSpace, type NewTowerFile } from "./fileSpace";
import { SaveGame, SLOT_COUNT, type SlotInfo } from "./SaveGame";
import { slotLabel } from "./slotLabels";
import { toTowerFile } from "./towerFileCodec";

/** The folder's flag that says the save slots were copied in. */
export const SLOTS_COPIED = "slotsCopied";

/**
 * The three save slots as My Towers files (owner, 2026-11-15: "the 3 slots
 * and their names are copied into My Towers once"). Each one becomes the
 * `.vctower` text its stored value converts to without a decode
 * (`toTowerFile`, so a founder stays a founder), named by the name the player
 * gave the slot, else its tower's name, else "Slot n". A slot this build
 * can't read is copied too, its bytes kept as they are, so nothing the player
 * had goes out of sight; opening it then says why it won't load. An empty
 * slot, or one whose value is not a save at all, is left out.
 *
 * The slot keys stay in storage, so an older build still finds its slots.
 */
export function slotFiles(
  read: (n: number) => string | null = (n) => SaveGame.slotRaw(n),
  rows: readonly SlotInfo[] = safeRows(),
  label: (n: number) => string | undefined = slotLabel,
): NewTowerFile[] {
  const files: NewTowerFile[] = [];
  const encoder = new TextEncoder();
  for (let n = 1; n <= SLOT_COUNT; n++) {
    const raw = read(n);
    if (raw === null) continue;
    const converted = toTowerFile(raw);
    const kept = converted.ok ? converted : toTowerFile(raw, true);
    if (!kept.ok) continue;
    const row = rows.find((r) => r.slot === n);
    files.push({
      name: label(n) ?? (row?.towerName || `Slot ${n}`),
      kind: "tower",
      bytes: encoder.encode(kept.text),
      modified: row?.savedAt ?? Date.now(),
    });
  }
  return files;
}

function safeRows(): SlotInfo[] {
  try {
    return SaveGame.listSlots();
  } catch {
    return [];
  }
}

/** Copy the slots in, the first time the folder opens on this device. Never
 *  rejects: a slot copy that fails now is tried again next time. Resolves to
 *  how many files were added. */
export async function copySlotsOnce(): Promise<number> {
  if (!fileSpace.isOpen()) return 0;
  try {
    if (await fileSpace.flag(SLOTS_COPIED)) return 0;
    return await fileSpace.addOnce(SLOTS_COPIED, slotFiles());
  } catch {
    return 0;
  }
}
