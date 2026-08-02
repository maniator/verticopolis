import type { FacilityKind } from "../engine/types";
import { FAMILY_STORIES, SCREEN_PARTS } from "./tdtTables";

/**
 * Merge the per-floor "parts" a multi-story unit is stored as (doc §5) back
 * into whole units. Extracted from `tdtImport.ts`; pure union-find over a
 * tower's few dozen parts.
 */

/** A multi-story part collected during the floor walk, pre-merge. */
export interface PartRecord {
  kind: FacilityKind;
  typeId: number;
  floor: number;
  left: number;
  right: number;
  construction: boolean;
}

/** A merged multi-story unit: the cluster's base floor, top floor, and
 *  horizontal union. */
export interface MergedPart {
  kind: FacilityKind;
  floor: number;
  topFloor: number;
  left: number;
  right: number;
  construction: boolean;
}

/**
 * Merge per-floor parts into whole units. Two parts belong to the same
 * building only when their extents STRICTLY overlap within the family's
 * story-height window (a building's stories stack), or, for the theatre
 * alone, when a screen half sits flush against a hall half on the same
 * floor. Plain touching is deliberately NOT enough: two independent
 * same-kind units built flush against each other (or on far-apart floors at
 * the same x) must stay two units. Clusters are then split both ways, by floor
 * window and by horizontal connectivity, because buildings can chain into one
 * cluster through a neighbor on the floors below; each piece becomes one unit
 * anchored at its lowest floor, spanning its own horizontal union.
 *
 * Known imperfection: a screen sandwiched exactly between two flush theatres
 * can chain them; the width-mismatch report line flags the result.
 */
export function mergeParts(parts: PartRecord[]): MergedPart[] {
  const byFamily = new Map<FacilityKind, PartRecord[]>();
  for (const p of parts) {
    const arr = byFamily.get(p.kind);
    if (arr) arr.push(p);
    else byFamily.set(p.kind, [p]);
  }
  const merged: MergedPart[] = [];
  for (const [kind, records] of byFamily) {
    const stories = FAMILY_STORIES[kind] ?? 1;
    // Union-find over this family's parts (a tower holds at most a few dozen).
    const parent = records.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    // True when two parts can belong to the same building: their extents
    // strictly overlap within the family's story window, or (theatre only) a
    // screen half sits flush against a hall half on the same floor.
    const sameBuilding = (a: PartRecord, b: PartRecord): boolean => {
      const overlaps = a.left < b.right && b.left < a.right;
      const withinStories = Math.abs(a.floor - b.floor) < stories;
      const screenTouch =
        kind === "cinema" &&
        a.floor === b.floor &&
        (a.right === b.left || b.right === a.left) &&
        SCREEN_PARTS.has(a.typeId) !== SCREEN_PARTS.has(b.typeId);
      return (overlaps && withinStories) || screenTouch;
    };
    for (let i = 0; i < records.length; i++) {
      for (let j = i + 1; j < records.length; j++) {
        if (sameBuilding(records[i], records[j])) union(i, j);
      }
    }
    const clusters = new Map<number, PartRecord[]>();
    for (let i = 0; i < records.length; i++) {
      const root = find(i);
      const arr = clusters.get(root);
      if (arr) arr.push(records[i]);
      else clusters.set(root, [records[i]]);
    }
    for (const cluster of clusters.values()) {
      // Two same-kind buildings stacked on ADJACENT floor pairs (e.g. one
      // recycling on 10/11 and another on 12/13) chain through the union: the
      // upper half of one sits within the story window of the lower half of
      // the other. Split any cluster taller than the family's story count
      // into consecutive-floor groups so each building stays its own unit.
      cluster.sort((a, b) => a.floor - b.floor);
      let group: PartRecord[] = [];
      const flush = (): void => {
        if (group.length === 0) return;
        // A floor group can still hold SEVERAL buildings. Two same-kind units
        // built flush side by side never overlap each other, yet both chain
        // into one cluster through a third building on the floors below (whose
        // parts overlap each of them). Left unsplit, the pair fused into a
        // single double-width unit and one building vanished, so re-split the
        // group by horizontal connectivity and emit one unit per component.
        const parent2 = group.map((_, i) => i);
        const find2 = (i: number): number => {
          while (parent2[i] !== i) {
            parent2[i] = parent2[parent2[i]];
            i = parent2[i];
          }
          return i;
        };
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            if (!sameBuilding(group[i], group[j])) continue;
            const ra = find2(i);
            const rb = find2(j);
            if (ra !== rb) parent2[ra] = rb;
          }
        }
        const components = new Map<number, PartRecord[]>();
        for (let i = 0; i < group.length; i++) {
          const root = find2(i);
          const arr = components.get(root);
          if (arr) arr.push(group[i]);
          else components.set(root, [group[i]]);
        }
        for (const component of components.values()) {
          const m: MergedPart = {
            kind,
            floor: component[0].floor,
            topFloor: component[0].floor,
            left: component[0].left,
            right: component[0].right,
            construction: component[0].construction,
          };
          for (const p of component) {
            m.left = Math.min(m.left, p.left);
            m.right = Math.max(m.right, p.right);
            // Fold the base floor with min rather than trusting the first
            // element: a unit is anchored at its LOWEST story, and relying on
            // the incoming order would silently place a building a floor off if
            // that order ever changed.
            m.floor = Math.min(m.floor, p.floor);
            m.topFloor = Math.max(m.topFloor, p.floor);
            m.construction = m.construction || p.construction;
          }
          merged.push(m);
        }
        group = [];
      };
      for (const p of cluster) {
        if (group.length > 0 && p.floor - group[0].floor >= stories) flush();
        group.push(p);
      }
      flush();
    }
  }
  return merged;
}
