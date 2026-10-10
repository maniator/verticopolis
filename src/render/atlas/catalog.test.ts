import { describe, expect, it } from "vitest";
import { FACILITIES, facilityFloors, hasBusinessHours, isOpenAt } from "../../engine/facilities";
import { subtypeListFor } from "../../engine/retailSubtypes";
import type { FacilityKind } from "../../engine/types";
import { FLOOR, TILE } from "../scale";
import { allJobs } from "./browserEntry";
import { UNIT_STATES, hourFor, occupantCap, roomJobs, roomKinds, variantPlacements, type StillJob } from "./catalog";
import { paint, cloudOrigin, unitOf, type PaintSpec } from "./paint";

/** A 2D context that accepts every call (paint coverage, not pixels: the
 *  e2e comparison spec checks pixels in a real browser). */
function sinkCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop: () => undefined };
  return new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern") return () => grad;
      if (prop === "measureText") return () => ({ width: 10 });
      if (prop === "getLineDash") return () => [];
      return () => undefined;
    },
    set(target, prop, v) {
      target[prop as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

describe("room catalog", () => {
  const jobs = roomJobs();
  const stills = jobs.filter((j): j is StillJob => j.type === "still");

  it("covers every room kind in every state, and ships fire and construction as loops", () => {
    for (const kind of roomKinds()) {
      for (const state of UNIT_STATES) {
        if (state === "fire" || state === "construction") {
          expect(jobs.some((j) => j.type === "anim" && j.name === `${state}/${kind}`)).toBe(true);
        } else {
          expect(stills.some((j) => j.keys.kind === kind && j.keys.state === state), `${kind} ${state}`).toBe(true);
        }
      }
    }
    expect(roomKinds()).not.toContain("lobby");
    expect(roomKinds()).not.toContain("elevatorStandard");
  });
  it("names frames from the engine's kind and state strings, uniquely", () => {
    const names = allJobs().map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("room/office/occupied/-/w9/unlit/always/any/v0/home");
    expect(names).toContain("room/condo/occupied/-/w16/lit/always/late/v0/home");
    expect(names).toContain("room/shop/occupied/Book Store/w12/lit/closed/any/v3/away".replace("w12", `w${FACILITIES.shop.width}`));
  });
  it("sizes rooms by catalog width and floors", () => {
    for (const j of stills) {
      const k = j.keys.kind as FacilityKind;
      expect(j.w).toBe(FACILITIES[k].width * TILE);
      expect(j.h).toBe(facilityFloors(k) * FLOOR);
    }
  });
  it("bakes every subtype plus the legacy no-subtype look", () => {
    for (const kind of roomKinds()) {
      const list = subtypeListFor(kind);
      const subs = new Set(stills.filter((j) => j.keys.kind === kind).map((j) => j.keys.subtype));
      expect(subs.size).toBe((list?.length ?? 0) + 1);
    }
  });
  it("splits presence and walks the visible count for occupied rooms", () => {
    const home = stills.find((j) => j.name === "room/office/occupied/-/w9/unlit/always/any/v0/home")!;
    const steps = home.chains!.occupants.steps as Extract<PaintSpec, { p: "unit" }>[];
    expect(steps[0]).toMatchObject({ occupants: 1, outForMeal: 1 });
    expect(steps[3]).toMatchObject({ occupants: 3, outForMeal: 0 });
    expect(steps.length).toBe(occupantCap("office") + 1);
    const parking = stills.find((j) => j.keys.kind === "parking")!;
    expect(Object.keys(parking.overlays!).sort()).toEqual(["car0", "car1", "car2", "car3", "car4", "car5", "car6", "dead"]);
    const recycling = stills.find((j) => j.keys.kind === "recycling")!;
    expect(recycling.chains!.fill.steps).toHaveLength(9);
  });
  it("picks an hour that realizes the open and late bits", () => {
    for (const kind of roomKinds()) {
      for (const open of [true, false]) {
        if (!hasBusinessHours(kind) && !open) continue;
        const h = hourFor(kind, open, false);
        if (hasBusinessHours(kind)) expect(isOpenAt(kind, h)).toBe(open);
      }
    }
    expect(hourFor("condo", false, true)).toBe(23);
    expect(hourFor("condo", false, false)).toBe(12);
  });
  it("samples placements on the right side of the ground line", () => {
    expect(variantPlacements("metro")).toHaveLength(1);
    expect(variantPlacements("parking").every((p) => p.floor < 0)).toBe(true);
    expect(variantPlacements("office").every((p) => p.floor > 0)).toBe(true);
  });
});

describe("paint", () => {
  it("paints every spec in the catalog without throwing", () => {
    const ctx = sinkCtx();
    for (const j of allJobs()) {
      const specs = j.type === "anim" ? j.frames : [j.paint, ...Object.values(j.overlays ?? {}), ...Object.values(j.chains ?? {}).flatMap((c) => c.steps.slice(0, 3))];
      for (const s of specs) paint(ctx, s, j.w, j.h);
    }
  });
  it("rejects an unknown spec", () => {
    expect(() => paint(sinkCtx(), { p: "nope" } as unknown as PaintSpec, 1, 1)).toThrow(/unknown paint spec/);
  });
  it("builds engine-shaped units and cloud canvases that hold every puff", () => {
    expect(unitOf({ p: "unit", kind: "office", state: "empty", floor: 3, x: 4, id: 7, width: 9, occupants: 2, outForMeal: 1, lit: false, hour: 12, anim: 0 })).toMatchObject({
      id: 7,
      kind: "office",
      occupants: 2,
      outForMeal: 1,
    });
    const r = 94;
    const o = cloudOrigin(r);
    expect(o.x - r * 0.88).toBeGreaterThanOrEqual(0);
    expect(o.x + r * 0.9).toBeLessThanOrEqual(o.w);
    expect(o.y - r * 0.5).toBeGreaterThanOrEqual(0);
    expect(o.y + 9 + r * 0.55).toBeLessThanOrEqual(o.h);
  });
});
