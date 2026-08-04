/**
 * The coherence stamp: what the store last ACKNOWLEDGED per slot, remembered
 * machine-locally so hydration can tell WHICH SIDE moved.
 *
 * The problem it solves is the #736 F1 rule. Hydration writes store records
 * over localStorage keys, and "store wins, no comparison" was rejected in
 * party review with two concrete tower-loss constructions: a browser-
 * equivalent session's legitimate localStorage progress bulldozed when a
 * stray heals, and Steam Cloud replacing store files out from under a newer
 * local cache. A which-is-newer timestamp comparison is unsound (two wall
 * clocks, two machines), but WHICH SIDE MOVED is answerable with one
 * machine-local fact: a hash of the cache value the store last acknowledged.
 *
 *   store == cache                     coherent, no-op
 *   cache == acked, store differs      the STORE moved (Cloud): store wins
 *   cache != acked, store == acked     the CACHE moved: reconcile it forward
 *   cache != acked, store differs      both moved: stash, store wins, say so
 *
 * The stamp lives in ONE localStorage meta key, never migrated, never synced,
 * never part of any save. FNV-1a because this is divergence detection between
 * two values we wrote ourselves, not an adversarial boundary.
 */

const ACKED_KEY = "vc-store-acked";

/** FNV-1a 32-bit over UTF-16 code units, hex string. Collision odds are
 *  irrelevant here: a collision only makes hydration treat a moved value as
 *  unmoved, which degrades to the pre-stamp behavior for that one key. */
export function coherenceHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ACKED_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    // A corrupt meta key must degrade to "nothing acked", which is the
    // conservative reading: every difference becomes a conflict-or-reconcile
    // decision rather than a silent overwrite.
    return {};
  }
}

function writeMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(ACKED_KEY, JSON.stringify(map));
  } catch {
    // Quota. Losing the stamp costs conservatism, never data: an absent stamp
    // reads as "cache moved", which stashes rather than bulldozes.
  }
}

/** Record that the store acknowledged `cacheValue` for `id`. Called by the
 *  write-through after every committed write, and by hydration after it
 *  materializes a record. */
export function noteAcked(id: string, cacheValue: string): void {
  const map = readMap();
  map[id] = coherenceHash(cacheValue);
  writeMap(map);
}

/** The acked hash for `id`, or undefined when nothing was ever acknowledged.
 *  Undefined is the CONSERVATIVE answer by design: it reads as "the cache may
 *  have moved", which can stash or reconcile but never silently overwrite. */
export function ackedHash(id: string): string | undefined {
  return readMap()[id];
}

/** Drop the stamp for `id` (a deleted slot's stamp must not outlive it). */
export function clearAcked(id: string): void {
  const map = readMap();
  if (id in map) {
    delete map[id];
    writeMap(map);
  }
}
