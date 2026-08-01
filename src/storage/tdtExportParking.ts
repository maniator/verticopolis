import type { GatheredRoom } from "./tdtExportGather";

/**
 * The parking block's connected-stall count for a `.TDT` export. Extracted from
 * `tdtEncoder.ts`, which had grown past the file-size ceiling.
 *
 * Canon: a parking space only works when contiguous spaces link it back to a
 * ramp on its own floor, so a lot full of orphan stalls exports 0, exactly what
 * the 1994 game could produce itself.
 */
export function connectedStallCount(rooms: readonly GatheredRoom[]): number {
  const byFloor = new Map<number, { x: number; w: number; ramp: boolean }[]>();
  for (const u of rooms) {
    if (u.kind !== "parking" && u.kind !== "parkingRamp") continue;
    // Count only stalls and ramps actually IN the file: a burned shell or an
    // out-of-range footprint writes no record, and letting either chain a run
    // would claim connected stalls the floor map cannot account for.
    if (!u.emitted) continue;
    const arr = byFloor.get(u.floor) ?? [];
    arr.push({ x: u.x, w: u.width, ramp: u.kind === "parkingRamp" });
    byFloor.set(u.floor, arr);
  }
  let connected = 0;
  for (const arr of byFloor.values()) {
    arr.sort((a, b) => a.x - b.x);
    const linked = arr.map((it) => it.ramp);
    // Chains are one-dimensional: two sweeps settle flush adjacency.
    for (let i = 1; i < arr.length; i++) {
      if (!linked[i] && linked[i - 1] && arr[i - 1].x + arr[i - 1].w >= arr[i].x) linked[i] = true;
    }
    for (let i = arr.length - 2; i >= 0; i--) {
      if (!linked[i] && linked[i + 1] && arr[i].x + arr[i].w >= arr[i + 1].x) linked[i] = true;
    }
    for (let i = 0; i < arr.length; i++) if (linked[i] && !arr[i].ramp) connected++;
  }
  return connected;
}
