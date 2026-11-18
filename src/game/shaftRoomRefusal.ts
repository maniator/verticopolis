import { trackAppAction } from "../analyticsActions";

/**
 * The two refusals that keep an elevator shaft and a room off each other's
 * tiles (engine-rs/src/tower/shaft_rooms.rs), word for word as the engine
 * says them. `shaftRoomRefusal.integration.test.ts` builds both through the
 * real engine and checks the words still match, so a change on either side
 * fails there instead of quietly stopping the count.
 */
export const ROOM_IN_SHAFT = "An elevator shaft runs through here.";
export const SHAFT_THROUGH_ROOM = "A room is in the way. Elevator shafts can't run through rooms.";

/** Which side of the rule a refusal met: the `shaft_room_refused` action's
 *  `detail`. `room` is a room refused where a shaft runs, `shaft` a shaft
 *  refused (built, extended or resized) through a room. */
export type ShaftRoomSide = "room" | "shaft";

/** The side a refusal's reason names, or undefined for any other reason. */
export function shaftRoomSide(reason: string | undefined): ShaftRoomSide | undefined {
  if (reason === ROOM_IN_SHAFT) return "room";
  if (reason === SHAFT_THROUGH_ROOM) return "shaft";
  return undefined;
}

/** Count a refusal the player was just told about as `shaft_room_refused`
 *  when it is one of the two above (docs/analytics-data-map.md). Any other
 *  reason counts nothing. */
export function countShaftRoomRefusal(reason: string | undefined): void {
  const side = shaftRoomSide(reason);
  if (side) trackAppAction("shaft_room_refused", side);
}
