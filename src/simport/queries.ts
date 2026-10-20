import type { FacilityKind } from "../engine/types";

/**
 * Questions the game asks the engine whose answer the engine decides (the
 * consumer inventory's 1Q table). Slice 1 carries the two the build preview
 * and the palette ask most; later slices add members here.
 */
export type Query =
  | { op: "canBuild"; kind: FacilityKind; floor: number; x: number }
  | { op: "isUnlocked"; kind: FacilityKind };

export interface QueryResults {
  /** Whether a placement would succeed, with the refusal and the quote. */
  canBuild: { readonly ok: boolean; readonly reason?: string; readonly cost: number };
  isUnlocked: boolean;
}

export type QueryResult<Q extends Query> = QueryResults[Q["op"]];

/** The key two equal queries share, so `cached` can find the last answer.
 *  Built from the fields in a fixed order, so it does not depend on the
 *  order a caller wrote them in. */
export function queryKey(q: Query): string {
  switch (q.op) {
    case "canBuild":
      return `canBuild:${q.kind}:${q.floor}:${q.x}`;
    case "isUnlocked":
      return `isUnlocked:${q.kind}`;
    default:
      return unknownQuery(q);
  }
}

function unknownQuery(q: never): never {
  throw new Error(`simport: unknown query ${JSON.stringify(q)}`);
}
