import type { GameApp } from "../main";
import type { FacilityKind } from "../shared/types";
import { catalogFacility } from "../catalog/catalogTypes";
import { snapX } from "../ui/placement";
import { groupDigits } from "../ui/format";
import { catalogOf } from "./portAccess";
import { isPaintKind } from "./gesture";
import { clearBuildRefusal, updateBuildRefusal } from "./buildPreview";
import { quoteRoomRow, roomRowLabel } from "./roomRowTool";

/**
 * The row of rooms' mouse gesture (Modern, #646): with a room tool, a press on
 * a floor starts a row, a drag along it stretches the row toward the pointer
 * (the ghost shows each room and the row's full price), and the release places
 * the row through `BuildActions.buildRoomRow`, inside the undo step the press
 * opened. A press with no drag places one room. The row stays on the floor it
 * was pressed on. Touch keeps its lifted ghost, which places one room.
 */

/** A row under way: the press's floor and room, and the room under the pointer. */
interface RoomRowDrag {
  readonly kind: FacilityKind;
  readonly floor: number;
  readonly from: number;
  to: number;
}

const rows = new WeakMap<GameApp, RoomRowDrag>();

/** Whether a press with the active tool starts a row: a room tool (not a
 *  shaft, a flight or a brush) under a mouse or pen, where the catalog says the
 *  mode lays rows (`rules.roomRows`). */
export function startsRoomRow(app: GameApp, touch: boolean): boolean {
  if (touch || app.tool.type !== "build") return false;
  const catalog = catalogOf(app);
  return catalog.rules.roomRows && !catalogFacility(catalog, app.tool.kind).transport && !isPaintKind(app.tool.kind);
}

/** Start a row at the press: one room, drawn as the ghost. */
export function pressRoomRow(app: GameApp, tile: number, floor: number): void {
  if (app.tool.type !== "build") return;
  const kind = app.tool.kind;
  const x = snapX(catalogOf(app), kind, tile);
  rows.set(app, { kind, floor, from: x, to: x });
  drawRoomRow(app);
}

/** Stretch the row under way to the room under the pointer, on the press's
 *  floor. False when no row is under way, or when the tool changed (a key)
 *  since the press, which drops the row and its ghost. */
export function dragRoomRow(app: GameApp, tile: number): boolean {
  const row = rows.get(app);
  if (!row) return false;
  if (app.tool.type !== "build" || app.tool.kind !== row.kind) {
    dropRoomRow(app);
    clearBuildRefusal(app);
    return false;
  }
  const to = snapX(catalogOf(app), row.kind, tile);
  if (to !== row.to) {
    row.to = to;
    drawRoomRow(app);
  }
  return true;
}

/** Whether a row is under way, which its release places. */
export function roomRowPending(app: GameApp): boolean {
  return rows.has(app);
}

/** End the row under way: place it when the release `acts`, and clear its
 *  ghost either way. False when no row was under way. */
export function releaseRoomRow(app: GameApp, acts: boolean): boolean {
  const row = rows.get(app);
  if (!row) return false;
  rows.delete(app);
  app.engine.preview = null;
  clearBuildRefusal(app);
  // A tool changed mid-drag (a key) leaves the row unbuilt.
  const sameTool = app.tool.type === "build" && app.tool.kind === row.kind;
  if (acts && sameTool) app.build.buildRoomRow(row.kind, row.floor, row.from, row.to);
  return true;
}

/** Forget a row whose press was cut off or whose gesture closed under it,
 *  with its ghost. */
export function dropRoomRow(app: GameApp): void {
  if (rows.delete(app)) app.engine.preview = null;
}

/** The row's ghost: every room the release places, with the row's full price
 *  on a tag above it once it holds two or more; red, with the engine's reason,
 *  when the release would place nothing. */
function drawRoomRow(app: GameApp): void {
  const row = rows.get(app);
  if (!row) return;
  const q = quoteRoomRow(app.enginePort, app.portCodes, row.kind, row.floor, row.from, row.to);
  const rooms = q.rooms.length > 0 ? q.rooms : [row.from];
  // The rooms run from the press outward, so either end is the leftmost.
  const x = Math.min(rooms[0], rooms[rooms.length - 1]);
  const reason = q.ok || !catalogOf(app).rules.previewNamesRefusal ? undefined : q.reason;
  app.engine.preview = { kind: row.kind, floor: row.floor, x, valid: q.ok, reason, rooms, label: roomRowLabel(q, groupDigits) };
  app.engine.transportPreview = null;
  updateBuildRefusal(app, reason, row.floor, x + Math.floor(catalogFacility(catalogOf(app), row.kind).width / 2));
}
