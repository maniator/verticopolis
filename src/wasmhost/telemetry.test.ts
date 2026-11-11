import { describe, it, expect } from "vitest";
import { telemetryDocument, type TelemetryStores } from "./telemetry";

/** Two shafts, so the document's order and per-shaft split both show. */
const FIRST_SHAFT = 7;
const SECOND_SHAFT = 3;
const LOBBY = 0;
const OFFICE_FLOOR = 12;

function stores(): TelemetryStores {
  return {
    elevatorUtil: new Map([
      [FIRST_SHAFT, 0.25],
      [SECOND_SHAFT, 0.75],
    ]),
    elevatorHourly: new Map([
      [FIRST_SHAFT, { weekday: [1, 2, 3], weekend: [4] }],
      [SECOND_SHAFT, { weekday: [], weekend: [5, 6] }],
    ]),
    elevatorOrigins: new Map([
      [
        FIRST_SHAFT,
        {
          weekday: [
            new Map([[LOBBY, 9]]),
            new Map([
              [OFFICE_FLOOR, 2],
              [LOBBY, 1],
            ]),
          ],
          weekend: [new Map()],
        },
      ],
    ]),
  };
}

describe("telemetryDocument", () => {
  it("lists every store as [shaft id, value] pairs in insertion order", () => {
    const doc = telemetryDocument(stores());
    expect(doc.util).toEqual([
      [FIRST_SHAFT, 0.25],
      [SECOND_SHAFT, 0.75],
    ]);
    expect(doc.hourly).toEqual([
      [FIRST_SHAFT, { weekday: [1, 2, 3], weekend: [4] }],
      [SECOND_SHAFT, { weekday: [], weekend: [5, 6] }],
    ]);
  });

  it("turns each origin slot into [floor, count] pairs, keeping empty slots", () => {
    const doc = telemetryDocument(stores());
    expect(doc.origins).toEqual([
      [
        FIRST_SHAFT,
        {
          weekday: [
            [[LOBBY, 9]],
            [
              [OFFICE_FLOOR, 2],
              [LOBBY, 1],
            ],
          ],
          weekend: [[]],
        },
      ],
    ]);
  });

  it("copies the rings, so a later sample does not reach a document already sent", () => {
    const tower = stores();
    const doc = telemetryDocument(tower);
    tower.elevatorHourly.get(FIRST_SHAFT)?.weekday.push(99);
    tower.elevatorOrigins.get(FIRST_SHAFT)?.weekday[0].set(OFFICE_FLOOR, 4);
    expect(doc.hourly[0][1].weekday).toEqual([1, 2, 3]);
    expect(doc.origins[0][1].weekday[0]).toEqual([[LOBBY, 9]]);
  });
});
