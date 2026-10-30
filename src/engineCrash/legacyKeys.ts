/**
 * Storage keys the retired engine cohort left on players' devices: the random
 * test bucket (`vc.engineCohort`), the failure latch (`vc.engineSafety`) and
 * the crash-loop marker (`vc.engineBoot`). Nothing reads them now, and the
 * bucket was the one value the privacy note said the browser kept, so boot
 * removes all three. Never throws: storage can be blocked.
 */
export const LEGACY_COHORT_KEYS = ["vc.engineCohort", "vc.engineSafety", "vc.engineBoot"] as const;

export function removeLegacyCohortKeys(store: Pick<Storage, "removeItem"> | null = safeLocalStorage()): void {
  for (const key of LEGACY_COHORT_KEYS) {
    try {
      store?.removeItem(key);
    } catch {
      // Blocked storage keeps the keys; they stay unread.
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
