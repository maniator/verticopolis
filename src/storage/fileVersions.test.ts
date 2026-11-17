import { describe, expect, it } from "vitest";
import { planVersions, readVersions, VERSION_GAP_MS, VERSIONS_KEPT, type TowerVersion } from "./fileVersions";

const MIN = 60_000;

/** Write the file at each time in turn (by hand where `manual`), keeping the plans' lists. */
function writes(times: readonly (number | { at: number; manual: true })[]): { list: TowerVersion[]; dropped: string[]; put: (string | null)[] } {
  let list: TowerVersion[] = [];
  const dropped: string[] = [];
  const put: (string | null)[] = [];
  for (const t of times) {
    const at = typeof t === "number" ? t : t.at;
    const plan = planVersions(list, "F", at, 100, typeof t !== "number");
    list = plan.versions;
    dropped.push(...plan.drop);
    put.push(plan.put?.key ?? null);
  }
  return { list, dropped, put };
}

describe("a tower file's versions", () => {
  it("keeps a version on the first write, then one only once ten minutes have passed", () => {
    const { list, put } = writes([0, MIN / 2, 9 * MIN, VERSION_GAP_MS, VERSION_GAP_MS + MIN]);
    expect(put).toEqual(["v:F:0", null, null, `v:F:${VERSION_GAP_MS}`, null]);
    expect(list.map((v) => v.at)).toEqual([0, VERSION_GAP_MS]);
  });

  it("keeps the last five timed versions and drops the oldest", () => {
    const times = Array.from({ length: VERSIONS_KEPT + 2 }, (_, i) => i * VERSION_GAP_MS);
    const { list, dropped } = writes(times);
    expect(list.map((v) => v.at)).toEqual(times.slice(2));
    expect(dropped).toEqual(["v:F:0", `v:F:${VERSION_GAP_MS}`]);
  });

  it("keeps the last one saved by hand besides the five, replacing the one before it", () => {
    const times = [0, { at: MIN, manual: true as const }, ...Array.from({ length: VERSIONS_KEPT }, (_, i) => (i + 1) * VERSION_GAP_MS), { at: 99 * MIN, manual: true as const }];
    const { list, dropped } = writes(times);
    expect(list.filter((v) => v.manual).map((v) => v.at)).toEqual([99 * MIN]);
    expect(list.filter((v) => !v.manual)).toHaveLength(VERSIONS_KEPT);
    expect(dropped).toEqual(["v:F:0", `v:F:m${MIN}`]);
  });

  it("a save by hand doesn't reset the ten-minute clock of the timed ones", () => {
    const { put } = writes([0, { at: 5 * MIN, manual: true }, VERSION_GAP_MS]);
    expect(put).toEqual(["v:F:0", `v:F:m${5 * MIN}`, `v:F:${VERSION_GAP_MS}`]);
  });

  it("reads a stored list, dropping any row that is not a version", () => {
    const good = { key: "v:F:1", at: 1, size: 2 };
    expect(readVersions([good, { key: 1 }, null, { key: "k", at: 2, size: 3, manual: "yes" }, { ...good, manual: true }])).toEqual([good, { ...good, manual: true }]);
    expect(readVersions("nope")).toEqual([]);
  });
});
