import { clockOf as clockAt, type ClockView } from "@verticopolis/components/presentation/clockOf";
import { ClockReads } from "@verticopolis/engine/port/clockView";
import type { HeaderView } from "@verticopolis/engine/port/view";

export type { ClockView } from "@verticopolis/components/presentation/clockOf";

/** The header fields a clock reading needs. */
export type ClockHeader = Pick<
  HeaderView,
  "minutes" | "day" | "dayOfWeek" | "isWeekend" | "quarter" | "year" | "weekDays" | "weekendDays"
>;

/** A panel's clock for a view header: its date fields, and the engine's clock
 *  set to its minute. */
export function clockOf(h: ClockHeader): ClockView {
  return clockAt(h, new ClockReads().set(h));
}
