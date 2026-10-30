import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountAppDom, makeUI } from "../uiFixture";
import { CLASSIC_RULES } from "../../engine/gameRules";
import type { ScheduleDialogCtx } from "../../ui/uiElevatorSchedule";

/**
 * The schedule dialog's "All cars, all hours" button
 * through the real controller (#1546): the click fills BOTH day rows, OK saves
 * them, a reopen starts from the saved rows, and Cancel discards the edit.
 */

const dialog = (): HTMLDialogElement => document.getElementById("modal") as HTMLDialogElement;
const press = (sel: string): void => dialog().querySelector<HTMLButtonElement>(sel)!.click();

const stops = () => ({
  read: () =>
    [4, 3, 2, 1].map((floor) => ({ floor, served: true, lobby: floor === 1, endpoint: floor === 1 || floor === 4 })),
  setServe: vi.fn(async () => {}),
  expressStops: vi.fn(async () => {}),
  allStops: vi.fn(async () => {}),
});

/** A 4-car shaft whose saved schedule runs one car every hour of both day types. */
const ctx = (current?: ScheduleDialogCtx["current"]): ScheduleDialogCtx => ({
  title: "Schedule: Service elevator (floors 1-4)",
  ux: CLASSIC_RULES.elevatorScheduleUX(),
  isExpress: false,
  cars: 4,
  bottom: 1,
  top: 4,
  stops: stops(),
  initialWeekend: false,
  current,
});
const oneCar = { activeCars: { weekday: Array(24).fill(1), weekend: Array(24).fill(1) } };

beforeEach(() => mountAppDom());

describe("schedule dialog: run all cars", () => {
  it("saves a full fleet for every hour of both day types", async () => {
    const { ui } = makeUI();
    const apply = vi.fn(async (_s: any) => {});
    ui.showElevatorScheduleDialog(ctx(oneCar), { apply });
    press(".es-allcars");
    press('[data-act="apply"]');
    expect(apply).toHaveBeenCalledOnce();
    const saved = apply.mock.calls[0][0];
    expect(saved.activeCars.weekday).toEqual(Array(24).fill(4));
    expect(saved.activeCars.weekend).toEqual(Array(24).fill(4));
    await apply.mock.results[0].value;
  });

  it("a reopen from the saved rows shows the full fleet and the button changes nothing", async () => {
    const { ui } = makeUI();
    const apply = vi.fn(async (_s: any) => {});
    ui.showElevatorScheduleDialog(
      ctx({ activeCars: { weekday: Array(24).fill(4), weekend: Array(24).fill(4) } }),
      { apply },
    );
    press(".es-allcars");
    press('[data-act="apply"]');
    expect(apply.mock.calls[0][0].activeCars).toEqual({ weekday: Array(24).fill(4), weekend: Array(24).fill(4) });
    await apply.mock.results[0].value;
  });

  it("Cancel discards the edit, after the discard prompt", () => {
    const { ui } = makeUI();
    const apply = vi.fn(async (_s: any) => {});
    ui.showElevatorScheduleDialog(ctx(oneCar), { apply });
    press(".es-allcars");
    press('[data-act="close"]'); // arms Discard changes?
    expect(dialog().open).toBe(true);
    press('[data-act="close"]');
    expect(dialog().open).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
});
