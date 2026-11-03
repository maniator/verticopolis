/**
 * The freeze guard's decision (#1647): while a replay window is open, a pull
 * request may not move the window key (`fuzzKey.ts`) unless the owner approved
 * a reset and the marker file records it. Nothing here reads the repository;
 * `scripts/fuzz-freeze.ts` feeds it the marker at the PR head, the marker on
 * the base branch and the key computed on the PR's merge result.
 *
 * The marker (`conformance/fuzz-window.json`) says whether a window is open and
 * which key it counts on. It is not a key part, so opening, closing or
 * recording a reset never moves the key itself.
 */

export const FREEZE_MARKER_PATH = "conformance/fuzz-window.json";

/** An owner-approved restart of the window: the old key, the new one, and the
 *  comment on #1104 (or the PR) where the owner said so in their own words. */
export interface FreezeReset {
  from: string;
  to: string;
  approval: string;
}

export interface FreezeMarker {
  open: boolean;
  /** The key the window counts on; null while no window is open. */
  key: string | null;
  resets: FreezeReset[];
}

const KEY_PATTERN = /^[0-9a-f]{64}$/;
const APPROVAL_PATTERN = /^https:\/\/github\.com\/maniator\/verticopolis\/(?:issues|pull)\/\d+#issuecomment-\d+$/;

/** The marker, or the reason it is malformed. */
export function parseMarker(text: string): FreezeMarker | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "the marker is not valid JSON";
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "the marker is not an object";
  const m = raw as Record<string, unknown>;
  if (typeof m.open !== "boolean") return 'the marker needs a boolean "open"';
  if (m.key !== null && (typeof m.key !== "string" || !KEY_PATTERN.test(m.key))) return 'the marker\'s "key" is null or a 64-digit hex string';
  if (m.open && m.key === null) return 'an open window needs the "key" it counts on';
  if (!m.open && m.key !== null) return 'a closed window has a null "key"';
  if (!Array.isArray(m.resets)) return 'the marker needs a "resets" list';
  const resets: FreezeReset[] = [];
  for (const r of m.resets as unknown[]) {
    const e = r as Record<string, unknown> | null;
    const ok =
      typeof e === "object" && e !== null && typeof e.from === "string" && typeof e.to === "string" && typeof e.approval === "string" &&
      KEY_PATTERN.test(e.from) && KEY_PATTERN.test(e.to) && APPROVAL_PATTERN.test(e.approval);
    if (!ok) return 'each reset needs "from" and "to" keys and an "approval" link to an issue or PR comment on maniator/verticopolis';
    resets.push({ from: e.from as string, to: e.to as string, approval: e.approval as string });
  }
  return { open: m.open, key: m.key as string | null, resets };
}

export interface FreezeVerdict {
  ok: boolean;
  message: string;
}

/**
 * @param head the marker as the PR leaves it
 * @param base the marker on the base branch (null when the base has none)
 * @param key the window key computed on the PR's merge result
 */
export function checkFreeze(head: FreezeMarker, base: FreezeMarker | null, key: string): FreezeVerdict {
  if (!head.open) {
    return { ok: true, message: base?.open ? "The window is closed by this PR." : "No replay window is open." };
  }
  if (head.key !== key) {
    return {
      ok: false,
      message:
        `The open replay window counts on key ${head.key}, but this PR leaves the key at ${key}. ` +
        "A change to the engine, the nightly scripts, the WASM build inputs, the pins or the fixtures restarts the 14 nights. " +
        "Revert it, or get the owner's approval of a reset and record it in the marker's resets list with the new key.",
    };
  }
  if (base?.open && base.key !== head.key) {
    // A reset is spent by the PR that records it: one already on the base cannot be reused.
    const step = (r: FreezeReset): boolean => r.from === base.key && r.to === head.key;
    const approved = head.resets.some(step) && !base.resets.some(step);
    if (!approved) {
      return {
        ok: false,
        message: `The marker's key moves from ${base.key} to ${head.key} with no owner-approved reset recorded for that step.`,
      };
    }
    return { ok: true, message: "The key moved with an owner-approved reset recorded in the marker." };
  }
  if (!base?.open) return { ok: true, message: "This PR opens a replay window on the current key." };
  return { ok: true, message: "The key is unchanged for the open replay window." };
}
