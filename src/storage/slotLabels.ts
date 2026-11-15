/**
 * The names a player gives the save slots (owner, 2026-11-15: "Full set plus
 * slot names"). A slot's name is the slot's own, apart from the name of the
 * tower saved in it, so it stays when the slot is saved over or emptied. It
 * is a device preference, kept beside the saves in its own key: it never
 * travels in a tower file and never touches the save format.
 */

const KEY = "vc.slotNames";

/** The longest slot name, so a name fits on one line in File > Load. */
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

/** Name slot `n`; an empty name gives it back its number. Returns false when
 *  the browser refused the write. */
export function setSlotLabel(n: number, name: string): boolean {
  const names = { ...storedNames() };
  const clean = cleanSlotName(name);
  if (clean) names[String(n)] = clean;
  else delete names[String(n)];
  try {
    if (Object.keys(names).length) localStorage.setItem(KEY, JSON.stringify(names));
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
