// The calendar moved to `src/shared/` so the web can read it without importing
// the TypeScript engine. The engine and its tests keep this path.
export {
  CANON,
  REAL_WORLD,
  coerceCalendarKind,
  resolveCalendar,
  type Calendar,
  type CalendarKind,
} from "../shared/calendar";
