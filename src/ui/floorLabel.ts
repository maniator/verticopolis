/** Floor label with the basement grammar the retired stops dialog pinned: B1,
 *  B2... below ground, plain numbers above. DOM-free so the schedule formatter
 *  and the template can both import it without pulling in lit-html. */
export function floorLabel(floor: number): string {
  return floor < 1 ? `B${1 - floor}` : String(floor);
}
