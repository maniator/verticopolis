import { slotCensusEpoch } from "./slotCensus";
import type { SlotInfo } from "./slotInfo";

/**
 * What each slot's row last said, with the stored values it was read from.
 *
 * Reading a row decodes the slot, inflates it, parses its JSON and hashes the
 * text for the census reader, whose own memo then answers the population (it
 * loads the whole tower only for a save text it has not counted). On a large
 * tower that read is a long task on every open of the Saves dialog. A row
 * depends only on the slot's stored values and on the census reader, so it is
 * read again only when one of those changed. The stored values are kept as the
 * strings themselves and compared whole, so a slot rewritten with different
 * bytes always reads again.
 *
 * Only a row that loaded, or a slot with nothing stored, is remembered. A
 * stored slot that fails to read is read again on the next open, as it was
 * before this memo: the failure may be a one-off (memory pressure during the
 * inflate) that a retry clears, and a refused or corrupt slot is not worth
 * pinning as unreadable for the page.
 */
interface Remembered {
  readonly keys: readonly string[];
  readonly raws: readonly (string | null)[];
  readonly epoch: number;
  readonly info: SlotInfo;
}

const memo = new Map<SlotInfo["slot"], Remembered>();

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * The row for `slot`, whose loader walks `keys` in order. `read` builds the row
 * from those keys' stored values (`raws[i]` is `keys[i]`'s value, null when the
 * key is absent); it runs only when a value or the census reader changed since
 * the last remembered read, or when the last read found a stored slot it could
 * not load. A row is remembered with the key list it was read through, so a
 * call with other keys reads again. The memo keeps its own copy of each row and
 * a reuse hands out a fresh one, so a caller that edits a row cannot change the
 * next one.
 */
export function rememberedSlotInfo(slot: SlotInfo["slot"], keys: readonly string[], read: (raws: readonly (string | null)[]) => SlotInfo): SlotInfo {
  const raws = keys.map((key) => localStorage.getItem(key));
  // Read the epoch BEFORE `read`: a census trap inside `read` removes the
  // reader (raising the epoch), and a row stored under the older epoch is then
  // read again on the next open, with no census.
  const epoch = slotCensusEpoch();
  const known = memo.get(slot);
  if (known && known.epoch === epoch && sameList(known.keys, keys) && sameList(known.raws, raws)) return { ...known.info };
  const info = read(raws);
  if (info.exists || !info.present) memo.set(slot, { keys: [...keys], raws, epoch, info: { ...info } });
  else memo.delete(slot);
  return info;
}
