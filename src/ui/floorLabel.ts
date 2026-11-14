/** Floor label with the basement grammar the retired stops dialog pinned: B1,
 *  B2... below ground, plain numbers above. DOM-free so the schedule formatter
 *  and the template can both import it without pulling in lit-html. */
export function floorLabel(floor: number): string {
  return isBasementFloor(floor) ? `B${1 - floor}` : String(floor);
}

/** True below the ground lobby (floor 1): B1 is floor 0. */
export function isBasementFloor(floor: number): boolean {
  return floor < 1;
}
