import { digest } from "./canonical";

/**
 * What the `reload` command holds a save round trip to (the Rust runner has
 * the same rule in `engine-rs/src/scenario/reload.rs`).
 *
 * The state view must come back unchanged, with one allowed difference: a
 * load adopts every milestone already met, silently, and milestones are only
 * checked once a day, so a reload shortly after a condition becomes true comes
 * back with that milestone added (#1711). Everything else is compared as
 * before, and the milestones the game already held must come back first, in
 * order, so a milestone that is lost, changed or reordered still fails.
 */

const milestonesOf = (view: unknown): unknown[] | null => {
  const list = (view as { milestones?: unknown } | null)?.milestones;
  return Array.isArray(list) ? list : null;
};

const withoutMilestones = (view: unknown): unknown => {
  const { milestones: _milestones, ...rest } = view as Record<string, unknown>;
  return rest;
};

/** Whether the loaded view differs from the saved one in anything but
 *  milestones added by the load. */
export function reloadChanged(before: unknown, after: unknown): boolean {
  const held = milestonesOf(before);
  const loaded = milestonesOf(after);
  if (held === null || loaded === null) return digest(before) !== digest(after);
  const keptInOrder = held.every((id, i) => loaded[i] === id);
  return !keptInOrder || digest(withoutMilestones(before)) !== digest(withoutMilestones(after));
}
