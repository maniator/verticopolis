/**
 * The game's draw planes (Excalibur z), back to front, in one table so the
 * scene and the atlas data (`data.depth`) can never disagree. Higher draws in
 * front; equal planes draw in the order their actors were added.
 */
export const Z = {
  /** The sky strip, sun, moon and clouds (a screen-space layer). */
  sky: -60,
  /** The far and near skyline bands. */
  skylineFar: -56,
  skylineNear: -55,
  /** The dirt under the lot and the ground line over it. */
  dirt: -50,
  groundLine: -49,
  /** The lot's grass and paving strip. */
  strip: -48,
  /** Sidewalks, roads, the forecourt and the roundabout. */
  groundEdge: -47,
  /** The fountain, the lamps, the planter, the trees and bushes. */
  plant: -46,
  /** The fire escapes (awnings on the ground floor) and the crane. */
  hang: -2,
  /** Floor and lobby tiles (the entrances are lobby tiles). */
  structure: -1,
  /** Settled rooms (the region canvases). */
  room: 0,
  /** Ambient walkers on the floors and in the lobby. */
  walker: 0.4,
  /** Rooms that redraw every frame: burning and under construction. */
  animatedRoom: 0.45,
  /** The parking ramp's commuter cars. */
  streetCar: 0.5,
  /** The metro train and the garbage truck. */
  vehicle: 0.6,
  /** Shafts, stairs and escalators. */
  transport: 1,
  /** Elevator cabs. */
  cab: 2,
  /** The commuting crowd. */
  crowd: 3,
  /** Screen-space overlays (labels, effects). */
  overlay: 100,
} as const;
