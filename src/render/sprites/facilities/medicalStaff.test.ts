import { describe, expect, it, vi } from "vitest";
import { rasterCtx } from "../../../tests/originSeedsHarness";
import { castIndex } from "../../pixelSprites/people";
import { FLOOR, TILE } from "../../scale";
import { drawMedical } from "./service";

/** The seed of every standing figure the medical center paints, in order:
 *  the nurse, then the doctor. The wrapper passes straight through, so the
 *  paint is unchanged. */
const standing = vi.hoisted(() => [] as number[]);
vi.mock("../../pixelSprites/common", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../pixelSprites/common")>();
  return {
    ...real,
    personStanding: (...args: Parameters<typeof real.personStanding>) => {
      standing.push(args[3]);
      return real.personStanding(...args);
    },
  };
});

/** The cast members a medical center at this floor and column staffs. */
function staffAt(floor: number, x: number): { nurse: number; doctor: number } {
  standing.length = 0;
  const w = 16 * TILE;
  const r = rasterCtx(w, FLOOR);
  drawMedical({ ctx: r.ctx, lit: true, anim: 0, hour: 12 }, { kind: "medical", floor, x }, 0, 0, w, FLOOR);
  expect(standing).toHaveLength(2);
  return { nurse: castIndex(standing[0]), doctor: castIndex(standing[1]) };
}

describe("the medical center's nurse and doctor (#1117)", () => {
  const rooms = [3, 9, 17, 26, 38, 51, 67, 84].flatMap((floor) => [5, 23, 64, 131, 208].map((x) => staffAt(floor, x)));

  it("never pairs the nurse with their own twin as the doctor", () => {
    for (const { nurse, doctor } of rooms) expect(doctor).not.toBe(nurse);
  });

  it("does not fix the doctor by the nurse", () => {
    // Both seeds once came from one staff seed, so each nurse always stood
    // beside the same doctor and a tower showed only five pairs.
    const doctorsByNurse = new Map<number, Set<number>>();
    for (const { nurse, doctor } of rooms) doctorsByNurse.set(nurse, (doctorsByNurse.get(nurse) ?? new Set()).add(doctor));
    expect(Math.max(...[...doctorsByNurse.values()].map((s) => s.size))).toBeGreaterThan(1);
    expect(new Set(rooms.map(({ nurse, doctor }) => `${nurse}/${doctor}`)).size).toBeGreaterThan(5);
  });
});
