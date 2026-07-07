import type { Tool } from "../ui/UI";
import type { FacilityKind } from "../engine/types";
import { FACILITIES, isFixedSpanTransport } from "../engine/facilities";

/**
 * Build tools that lay a contiguous RUN by dragging — the original's floor tool.
 * Floor/lobby paint a strip; **parking** chains its spaces the same way (canon:
 * "use parking spots like the floor tool — click and drag to make a chain").
 * A dragged parking space still only functions when it chains to a ramp; the
 * drag just places them. The ramp itself is a single 16-wide fixture, not a run.
 *
 * They own the one-finger drag on touch (instead of panning), so a mobile player
 * can lay a whole run rather than tap one at a time. Single source of truth for
 * "which tools drag-paint", shared by the gesture router below and the app's
 * paint path so the two can't disagree.
 */
export function isPaintKind(kind: FacilityKind): boolean {
  return kind === "floor" || kind === "lobby" || kind === "parking";
}

/**
 * Pan-vs-act decision for a single pointer press. Pure (no engine/DOM state) so
 * the whole tool × touch × button × space routing matrix is unit-testable.
 *
 * - `"pan"` — the drag moves the camera; a small-movement press places via
 *   `onTap` on release (the tap path, with touch slop).
 * - `"action"` — `onActionDown`/`onActionMove`/`onActionUp` fire (press / drag /
 *   release), the path drag-sized transports and paint runs use.
 *
 * On touch, one finger pans EXCEPT for gestures that OWN the drag: drag-sized
 * transports (elevators) size with it, and paint tools (floor/lobby) lay a run
 * with it. On mouse, everything but inspect acts (pan is space/right-button).
 */
export function classifyGesture(
  tool: Tool,
  button: number,
  touch: boolean,
  space: boolean,
): "pan" | "action" {
  if (button > 0 || space) return "pan"; // middle/right button or held space
  if (tool.type === "inspect") return "pan"; // inspect: drag pans, tap selects
  // Narrow to the build variant IN the condition so `tool.kind` is unambiguously
  // in scope (a `const build = tool.type === "build"` alias only narrows under TS's
  // aliased-discriminant analysis — this form doesn't lean on it).
  const dragSized =
    tool.type === "build" && !!FACILITIES[tool.kind].transport && !isFixedSpanTransport(tool.kind);
  const paint = tool.type === "build" && isPaintKind(tool.kind);
  if (touch && !dragSized && !paint) return "pan";
  return "action";
}
