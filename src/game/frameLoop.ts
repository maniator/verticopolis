import type { GameApp } from "../main";
import { paceFactor } from "../engine/timePacing";
import { decideMealRush } from "./mealRush";
import { updateTraffic } from "./trafficHud";
import { positionPanels } from "./panelAnchoring";
import { maybeSurfaceUpdatePrompt } from "./updateFlow";
import { gameplaySession } from "../analytics";

/**
 * The per-frame simulation + throttled UI/audio refresh, split out of the
 * `GameApp` class. `runFrame(app, dtMs)` is called from the engine's `onUpdate`
 * (wrapped in the frame-error guard in engineWiring). It reads and writes
 * frame-loop latch state (`accMinutes`, `lastStar`, `shownWin`, `lastMealRushDay`)
 * ON `app`, so `adoptSim`'s reset of those fields stays authoritative. Behavior
 * unchanged from the former `GameApp.update`/`emitMealRushes`.
 */

/** Game speeds → in-game minutes advanced per real second. */
export const SPEEDS = [0, 10, 30, 120];

/** Hard cap on owed-but-unsimulated minutes carried between frames. At the
 *  fastest speed (120 min/s) a device that can't simulate that fast in real
 *  time accrues debt every frame; without a cap each frame does more work than
 *  the last until frames run seconds long (see the clamp in runFrame). 30
 *  minutes is 15 ideal frames of fastest-speed debt (2 sim-minutes per 60fps
 *  frame), generous headroom for hitches, while keeping the largest single
 *  frame's sim work bounded near two 20-minute tick chunks. */
const MAX_CATCHUP_MINUTES = 30;

export function runFrame(app: GameApp, dtMs: number): void {
  // Sample the rendered frame-rate for the session_fps signal (#538). noteFrame
  // reads its OWN wall-clock delta (not the `dtMs` the engine passes: that value
  // is spike-clamped to 1ms for any frame over 200ms, which would hide the very
  // hitches this metric exists to catch). Foreground-gated and best-effort
  // inside; done first so it captures every rendered frame, including the ones a
  // modal freeze returns early on below (fps is a render metric, not a sim-tick
  // one).
  gameplaySession.noteFrame();
  // While a blocking modal is open, freeze time so nothing changes under it:
  // an emergency choice (canon: the modal pauses the game) must not auto-resolve
  // out from under the player, and the update prompt must not let a distracted
  // player lose game-hours at high speed while it waits for their answer.
  if (app.shownChoice || app.shownUpdate) {
    app.accMinutes = 0;
    return;
  }
  const minutesPerSecond = SPEEDS[app.speed] ?? 0;
  // The 1994 "breathing clock": scale how fast REAL time feeds sim-minutes by
  // the canon pacing curve (lunch dilates ~10x, night sprints) unless the
  // player opted out. Presentation-only: the sim still ticks uniform minutes,
  // and paceFactor is normalized so a full day costs the same real time, so
  // the speed buttons keep their meaning.
  const pace = app.prefs.steadyClock ? 1 : paceFactor(app.sim.clock.minuteOfDay);
  app.accMinutes += (dtMs / 1000) * minutesPerSecond * pace;
  // A non-finite dtMs (a NaN/Infinity timestamp delta from a hung or restored
  // frame source) would poison accMinutes to NaN, and NaN fails every
  // comparison below, so the sim would stop ticking FOREVER with no recovery.
  // Reset to 0 and skip this frame's catch-up; the next finite frame resumes.
  if (!Number.isFinite(app.accMinutes)) app.accMinutes = 0;
  // Cap the catch-up debt. Owed minutes grow with real frame time, so on a
  // device that can't simulate the fastest speed in real time every frame
  // would carry ever more sim work, stretching frames toward seconds of
  // sustained CPU+GPU load, the profile under which Android reclaims the
  // WebGL context (the Pixel 8a "random crash"). Dropping the excess trades
  // clock accuracy for survival: the game visibly runs slower than the
  // speed button promises on hardware that can't keep up, and a tab restored
  // from the background resumes with one bounded step instead of replaying
  // the whole absence.
  if (app.accMinutes > MAX_CATCHUP_MINUTES) app.accMinutes = MAX_CATCHUP_MINUTES;
  // Step the simulation in small chunks so hourly/daily boundaries fire.
  const minutesBeforeTicks = app.sim.clock.minutes;
  let guard = 0;
  while (app.accMinutes >= 1 && guard++ < 2000) {
    const step = Math.min(20, app.accMinutes);
    app.sim.tick(step);
    app.accMinutes -= step;
  }
  emitMealRushes(app, minutesBeforeTicks);

  // Throttle the comparatively expensive DOM/audio updates (~6Hz) so a busy
  // tower never makes panning feel sluggish.
  const now = globalThis.performance ? performance.now() : 0;
  if (now - app.lastUiUpdate > 160) {
    app.lastUiUpdate = now;
    app.audio.update(app.engine.focus());
    app.ui.update(app.sim);
    updateTraffic(app);
    app.onboarding.tick(); // advance the first-run checklist on real progress (no-op when inactive)
    // Keep the open editor's live stats fresh. Refresh now patches only the
    // volatile cells in place (never the buttons or rename input), so this is
    // safe while renaming; the pointer guard still skips the rare full rebuild
    // during an active press.
    if (app.selected && app.ui.isEditorOpen() && !app.ui.isEditorBusy()) {
      app.refreshEditor();
    }
    // A jingle on every star promotion (2★–5★), not just the TOWER win.
    if (app.sim.star > app.lastStar) {
      app.lastStar = app.sim.star;
      gameplaySession.noteStar(app.sim.star); // progression depth signal
      if (app.sim.star < 6) app.audio.sfx("promote");
    }
    // Auto-surfaced modals must never stack over the boot/return splash. A
    // loaded save can carry a pending emergency (or an already-won TOWER), and
    // now that returning players see the splash, opening one behind it would be
    // a wrong greeting, and resolving an emergency MUTATES the sim (pays money /
    // applies the outcome) while the title screen is up. That breaks the
    // "nothing changes behind the splash" invariant autosave relies on. The
    // splash pauses the sim, so nothing is lost by waiting: these surface on the
    // next calm tick once the player dismisses it. (The update prompt already
    // self-guards on the splash via updateCoastClear.)
    const splashUp = !!document.getElementById("splash");
    // Interactive emergency choice (fire rescue / bomb ransom).
    const pc = app.sim.pendingChoice;
    if (pc && !app.shownChoice && !splashUp) {
      app.shownChoice = true;
      app.audio.sfx("error");
      app.ui.showEventChoice(pc.message, `$${pc.cost.toLocaleString()}`, (opt) => {
        app.sim.resolveChoice(opt);
        app.shownChoice = false;
      });
    }
    // No `else` to clear shownChoice when the sim auto-resolves a choice: the
    // freeze guard at the top of runFrame returns whenever shownChoice is set,
    // so the sim can't tick a pending choice away while the modal is up. The
    // callback above is the only path that clears the flag.
    // A new build is waiting: auto-surface the update prompt once, but only at
    // a calm moment (mirrors how the emergency choice is surfaced above). The
    // chip is already visible from the instant the build was found, so if a
    // calm moment never comes the player still has a way in.
    maybeSurfaceUpdatePrompt(app);
    if (app.sim.evaluatedTower && !app.shownWin && !splashUp) {
      app.shownWin = true;
      app.audio.sfx("promote");
      app.ui.congratsTower();
    }
  }

  // World-anchor the editor card and inspector tooltip every frame (cheap,
  // just writes left/top), so they ride the tower as the camera pans/zooms.
  positionPanels(app);
}

/** Once per weekday, when this frame's ticks actually CROSSED noon with the
 *  breathing clock on, drop a flavor line in the bulletin. It doubles as the
 *  only in-game explanation of why midday plays out in slow motion (UX call:
 *  the clock itself is the indicator; no HUD gauges). Crossing detection
 *  (rather than sampling `hour === 12` after the loop) means loading a save
 *  that already sits inside the noon hour stays quiet, a frozen clock stays
 *  quiet, and a single huge frame that leaps from 11:5x past 13:00 still
 *  fires. Transient, like the log. */
export function emitMealRushes(app: GameApp, minutesBeforeTicks: number): void {
  if (app.prefs.steadyClock) return;
  const after = app.sim.clock.minutes;
  // A tampered save can seed the clock with non-finite minutes (deserialize
  // passes data.minutes to Clock un-hardened); without this, dayOfKind is NaN,
  // the once-per-day latch never sticks (NaN !== NaN), and the bulletin spams
  // every frame. Same defensive posture as timePacing's finite guards.
  if (!Number.isFinite(after) || !Number.isFinite(minutesBeforeTicks)) return;
  const cal = app.sim.clock.calendar;
  // Tenant-count floor: silence bulletins in a very small tower (1-star lot
  // with a handful of rooms), so the log does not chatter through the early
  // game. 30 occupied tenants is a modest bar; a mid-star tower clears it.
  const tenants = app.sim.tower.totalPopulation();
  if (tenants < 30) return;
  // Emit each meal's bulletin once per day at the START of its window.
  // Anchoring on the frame START keeps the crossing check correct for a
  // single huge frame that leaps past the hour boundary; the calendar-aware
  // weekend gate skips weekends for the workday meals only (lunch and
  // dinner). Breakfast fires every day (hotels serve breakfast on weekends).
  const emit = (kind: "breakfast" | "lunch" | "dinner", hour: number, text: string, skipWeekend: boolean): void => {
    const { fire, dayOfKind } = decideMealRush({
      hour,
      skipWeekend,
      before: minutesBeforeTicks,
      after,
      weekDays: cal.weekDays,
      weekendDays: cal.weekendDays,
      lastFiredDay: app.lastMealRushDay[kind],
    });
    if (!fire) return;
    app.lastMealRushDay[kind] = dayOfKind;
    app.sim.emit(text, "info");
  };
  // Breakfast at 07:00, dinner at 18:00, lunch at 12:00. Order matches the
  // day so a slow-motion frame that crosses two boundaries emits both.
  emit("breakfast", 7, "Breakfast rush! Guests head down for the buffet.", false);
  emit("lunch", 12, "Lunch rush! Midday plays out in slow motion, just like 1994.", true);
  emit("dinner", 18, "Dinner rush! Elevators fill for the evening service.", true);
}
