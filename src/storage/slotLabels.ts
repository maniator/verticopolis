/**
 * The names a player gave the save slots in 4.1 and 4.2 (owner, 2026-11-15: "Full set
 * plus slot names"), read once when the slots are copied into My Towers
 * (`fileSpaceMigrate.ts`), where each name becomes its file's. The slots and
 * their names are no longer written: this reads what those versions left, and the key
 * stays for a build that still shows slots.
 */

const KEY = "vc.slotNames";

/** The longest slot name 4.1 and 4.2 let a player type. */
export const SLOT_NAME_MAX = 28;

/** The last stored text and the names read from it, so a menu that lists the
 *  slots each time it opens parses nothing new until a name changes. */
let read: { raw: string | null; names: Record<string, string> } | null = null;

function storedNames(): Record<string, string> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return {};
  }
  if (read && read.raw === raw) return read.names;
  const names: Record<string, string> = {};
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (parsed && typeof parsed === "object") {
      for (const [slot, name] of Object.entries(parsed)) {
        const clean = typeof name === "string" ? cleanSlotName(name) : "";
        if (clean) names[slot] = clean;
      }
    }
  } catch {
    // A damaged entry reads as no names: every slot keeps its number.
  }
  read = { raw, names };
  return names;
}

/** A name as it is kept: spaces trimmed and runs of them made one, cut to
 *  {@link SLOT_NAME_MAX} characters. */
export function cleanSlotName(name: string): string {
  return [...name.replace(/\s+/g, " ").trim()].slice(0, SLOT_NAME_MAX).join("").trim();
}

/** The name the player gave slot `n`, if any. */
export function slotLabel(n: number): string | undefined {
  return storedNames()[String(n)];
}
