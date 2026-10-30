import { catalogFacility } from "../engine/catalogTypes";
import type { AudioEngine } from "../audio/Audio";
import type { UI } from "../ui/UI";
import type { ReviewRow } from "../ui/templates/scheduleReview";
import { keepAct, recoverAct, reviewAct } from "../ui/templates/scheduleReview";
import { floorTag } from "../ui/format";
import type { EnginePort } from "../simport/enginePort";
import { outcome } from "../simport/portCodes";
import { scheduleSlots } from "../simport/scheduleSlots";
import type { ViewReader } from "../simport/viewReader";
import { isDialogOpen, isSplashUp } from "./interactionState";
import type { CardKit } from "./cardKit";
import {
  acknowledgementKey,
  browserAcknowledgements,
  isElevator,
  recoveredSchedule,
  shortFleets,
  type Acknowledgements,
  type ShaftFacts,
  type ShortFleet,
} from "./scheduleRecovery";

/**
 * The elevator schedule review (#1548). Older towers can hold elevators whose
 * schedule keeps some installed cars off shift (#1546). This controller finds
 * them, offers the player a notice once, and runs the review dialog: for a flat
 * schedule a one-click "Use all installed cars" that goes through the ordinary
 * schedule command (so Undo and the save behave as for any schedule edit), and
 * for every short shaft a way into the schedule dialog. Nothing is rewritten
 * unless the player chooses it. What the player decided is remembered in the
 * browser per tower and shaft (`scheduleRecovery.ts`), never in the save.
 */
export interface ScheduleReviewDeps {
  engine(): EnginePort;
  reader(): ViewReader;
  kit(): CardKit;
  ui: Pick<UI, "toast" | "sayVisibly" | "showScheduleReview">;
  audio: Pick<AudioEngine, "sfx">;
  captureUndo(label: string): void;
  commitUndo(): void;
  refreshEditor(): void;
  announce(message: string): void;
  /** Open one shaft's schedule dialog without touching the selection. */
  openSchedule(shaftId: number): void;
  /** Where the player's answers live; the browser's by default. */
  acknowledgements?: Acknowledgements;
}

export class ScheduleReview {
  /** The engine generation last offered the notice, so a tower is looked at once per load. */
  private offeredAt = -1;

  private readonly acks: Acknowledgements;

  constructor(private readonly deps: ScheduleReviewDeps) {
    this.acks = deps.acknowledgements ?? browserAcknowledgements();
  }

  /** The elevators of the tower in play whose schedule leaves a car idle. */
  findings(): ShortFleet[] {
    const shafts: ShaftFacts[] = this.deps
      .reader()
      .tower.transports.filter((t) => isElevator(t.kind))
      .map((t) => ({
        id: t.id,
        kind: t.kind,
        x: t.x,
        bottom: t.bottom,
        top: t.top,
        cars: t.cars,
      }));
    return shortFleets(shafts, (id) => this.deps.kit().currentSchedule(id));
  }

  private keyOf(finding: ShortFleet): string {
    const { sceneSeed, mode } = this.deps.reader().header;
    return acknowledgementKey({ seed: sceneSeed, mode }, finding.shaft);
  }

  /** Once per loaded tower, say that some elevators run fewer cars than they have, if any flat schedule has not
   *  been mentioned or decided on yet. Called from the ~6 Hz UI pass; it waits until the title screen and any dialog are
   *  gone, since a toast cannot be seen behind either. */
  tick(): void {
    if (isSplashUp() || isDialogOpen()) return;
    const generation = this.deps.engine().generation();
    if (generation === this.offeredAt) return;
    this.offeredAt = generation;
    const unmentioned = this.findings().filter((f) => f.flatAt !== null && this.acks.get(this.keyOf(f)) === undefined);
    if (unmentioned.length === 0) return;
    for (const f of unmentioned) this.acks.set(this.keyOf(f), "told");
    const many = unmentioned.length > 1;
    const who = many
      ? `${unmentioned.length} elevators have more cars than their schedules put`
      : "An elevator has more cars than its schedule puts";
    this.deps.ui.toast(
      `${who} on shift. Open Full Statistics to review ${many ? "them" : "it"}. Nothing changes unless you choose it.`,
      "info",
    );
  }

  /** Open the review dialog on the elevators short right now. Opening it counts as telling the player. */
  open(focus?: string): void {
    this.deps.reader().update();
    const found = this.findings();
    for (const f of found) if (f.flatAt !== null && this.acks.get(this.keyOf(f)) === undefined) this.acks.set(this.keyOf(f), "told");
    const handlers: Record<string, () => void> = {};
    for (const f of found) {
      const id = f.shaft.id;
      handlers[reviewAct(id)] = () => this.review(id);
      if (f.flatAt === null) continue;
      handlers[recoverAct(id)] = () => this.recover(id);
      if (this.acks.get(this.keyOf(f)) !== "kept") handlers[keepAct(id)] = () => this.keep(id);
    }
    this.deps.ui.showScheduleReview(
      found.map((f) => this.rowOf(f)),
      handlers,
      focus,
    );
  }

  private rowOf(f: ShortFleet): ReviewRow {
    const { shaft } = f;
    const name = catalogFacility(this.deps.kit().catalog(), shaft.kind).name;
    return {
      id: shaft.id,
      title: `${name}, floors ${floorTag(shaft.bottom)}–${floorTag(shaft.top)}`,
      facts: `${cars(shaft.cars)} installed. ${onShift(f)}`,
      preview:
        f.flatAt === null
          ? undefined
          : `Using all ${shaft.cars} cars puts ${shaft.cars} on shift in every hour instead of ${f.flatAt}. Floors served, stops and home floors stay as they are.`,
      kept: f.flatAt !== null && this.acks.get(this.keyOf(f)) === "kept",
    };
  }

  /** Open one elevator's schedule dialog, or say so when an Undo has taken the elevator away since the list was drawn. */
  private review(shaftId: number): void {
    if (this.deps.kit().cards.shaft(shaftId)) return this.deps.openSchedule(shaftId);
    this.open();
    this.deps.ui.sayVisibly("That elevator is gone.", "info");
  }

  /** Put every on-shift hour of a flat, short schedule on the whole fleet. One undo step. */
  recover(shaftId: number): void {
    const finding = this.findings().find((f) => f.shaft.id === shaftId);
    if (!finding || finding.flatAt === null) {
      this.open();
      return this.deps.ui.sayVisibly("That elevator already uses all of its cars.", "info");
    }
    const engine = this.deps.engine();
    this.deps.captureUndo("Use all elevator cars");
    const res = outcome(engine, engine.scheduleShaft(shaftId, scheduleSlots(recoveredSchedule(finding))));
    this.deps.commitUndo();
    this.deps.kit().cards.forget();
    if (res.ok) {
      this.deps.audio.sfx("build");
      this.deps.announce(
        `Elevator floors ${floorTag(finding.shaft.bottom)} to ${floorTag(finding.shaft.top)} now uses all ${finding.shaft.cars} cars.`,
      );
      this.deps.refreshEditor();
    } else {
      this.deps.audio.sfx("error");
    }
    // The dialog is redrawn first: a notice raised before it would be wiped with the old one.
    // Focus stays on the row that failed, and moves on only when that row is gone.
    this.open(res.ok ? this.nextFocus(shaftId) : recoverAct(shaftId));
    if (!res.ok) this.deps.ui.sayVisibly(res.reason ?? "That schedule could not be saved.", "bad");
  }

  /** The player's choice to leave a schedule as it is. */
  keep(shaftId: number): void {
    const finding = this.findings().find((f) => f.shaft.id === shaftId);
    if (finding) this.acks.set(this.keyOf(finding), "kept");
    this.deps.announce(
      finding
        ? `Kept the schedule of the elevator on floors ${floorTag(finding.shaft.bottom)} to ${floorTag(finding.shaft.top)} as it is.`
        : "Kept the schedule as it is.",
    );
    this.open(finding ? recoverAct(shaftId) : this.nextFocus(shaftId));
  }

  /** Where focus goes after a redraw: the first elevator still listed, since the one acted on may be gone. */
  private nextFocus(actedOn: number): string | undefined {
    const next = this.findings().find((f) => f.shaft.id !== actedOn) ?? this.findings()[0];
    if (!next) return undefined;
    return next.flatAt === null ? reviewAct(next.shaft.id) : recoverAct(next.shaft.id);
  }
}

const cars = (n: number): string => `${n} ${n === 1 ? "car" : "cars"}`;
const areOnShift = (n: number): string => (n === 1 ? "1 is on shift" : `${n} are on shift`);

/** How many cars the schedule puts on shift, in the player's words. */
function onShift(f: ShortFleet): string {
  if (f.flatAt !== null) return `${areOnShift(f.flatAt)} in every hour, weekdays and weekends.`;
  if (f.most === 0) return "No cars are on shift at any hour.";
  if (f.least === f.most) return `${areOnShift(f.least)} in the hours it runs.`;
  return `Between ${f.least} and ${f.most} are on shift, depending on the hour and the day.`;
}
