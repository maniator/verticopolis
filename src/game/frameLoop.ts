import type { GameApp } from "../main";
import { decideMealRush } from "./mealRush";
import { updateTraffic } from "./trafficHud";
import { tickInstallAffordance } from "./installAffordance";
import { hasBlockingModal, isEditorBusy, isEngineStopped, isSplashUp } from "./interactionState";
import { engineTrapped } from "./engineFault";
import { positionPanels } from "./panelAnchoring";
import { maybeSurfaceUpdatePrompt } from "./updateFlow";
import { gameplaySession } from "../analytics";
import { drainEngineEvents } from "../analyticsEngineBridge";
import { hudSource } from "./hudSource";
import { calendarOf } from "../simport/headerClock";

export { MAX_CATCHUP_MINUTES, advanceOwedMinutes } from "../engine/sim/frameStep";

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

/** Apply the player's speed choice. A change drops the step carry here, at the
 *  seam, so a change undone before the next frame (fastest, pause, fastest)
 *  still never replays minutes owed under the earlier choice: the engine's
 *  own mode check only sees the speed each frame runs at. The carry lives in
 *  `app.accMinutes` (reset by `adoptSim`, and on a steady-clock change by
 *  `toggleSteadyClock`). */
export function applySpeed(app: GameApp, s: number): void {
  if (s !== app.speed) app.accMinutes = 0;
  app.speed = s;
}

export function runFrame(app: GameApp, dtMs: number): void {
  // The game stopped on its engine (a wasm-only build's engine that did not
  // start, or a Rust engine that trapped): no engine holds the tower, so
  // time stops for good (the speed buttons and keys cannot restart it), and
  // a stopped game samples no frames for the session either. Events the
  // engine emitted before it stopped still reach analytics, unless it
  // trapped.
  if (isEngineStopped()) {
    // A trapped engine is never called again (engineFault.ts).
    if (!engineTrapped()) drainEngineEvents(app.events);
    app.accMinutes = 0;
    return;
  }
  // Sample the rendered frame-rate for the session_fps signal (#538). noteFrame
  // reads its OWN wall-clock delta (not the `dtMs` the engine passes: that value
  // is spike-clamped to 1ms for any frame over 200ms, which would hide the very
  // hitches this metric exists to catch). Foreground-gated and best-effort
  // inside; done first so it captures every rendered frame, including the ones a
  // modal freeze returns early on below (fps is a render metric, not a sim-tick
  // one).
  gameplaySession.noteFrame();
  // Fold the engine's gameplay events into analytics (#873 phase 2): builds,
  // stars, emergencies and their answers, pricing and capacity. Drained every
  // frame and ahead of the modal freeze below, so an emergency answered in a
  // modal reports on the next frame rather than when the freeze lifts.
  drainEngineEvents(app.events);
  // While a blocking modal is open, freeze time so nothing changes under it:
  // an emergency choice (canon: the modal pauses the game) must not auto-resolve
  // out from under the player, and the update prompt must not let a distracted
  // player lose game-hours at high speed while it waits for their answer.
  if (hasBlockingModal(app)) {
    app.accMinutes = 0;
    return;
  }
  const minutesPerSecond = SPEEDS[app.speed] ?? 0;
  // The 1994 "breathing clock": scale how fast REAL time feeds sim-minutes by
  // the canon pacing curve (lunch dilates ~10x, night sprints) unless the
  // player opted out. Presentation-only: the sim still ticks uniform minutes,
  // and paceFactor is normalized so a full day costs the same real time, so
  // the speed buttons keep their meaning.
  const steadyClock = app.prefs.steadyClock === true;
  // The clock as the last frame left it. A swap since then (a load, an undo)
  // is a different clock, and no meal rush is judged across it.
  const minutesBeforeTicks = app.reader.generation === app.enginePort.generation() ? app.reader.header.minutes : NaN;
  try {
    app.accMinutes = app.enginePort.advance(app.accMinutes, dtMs, minutesPerSecond, steadyClock, true)[1];
  } catch (err) {
    // A step threw (the frame-error guard catches it). The carry is dropped,
    // so the steps that already ran are never owed again.
    app.accMinutes = 0;
    throw err;
  }
  // The view follows every frame, so the header, the HUD and the painters
  // read this frame's tower.
  app.reader.update();
  emitMealRushes(app, minutesBeforeTicks);

  // Throttle the comparatively expensive DOM/audio updates (~6Hz) so a busy
  // tower never makes panning feel sluggish.
  const now = globalThis.performance ? performance.now() : 0;
  if (now - app.lastUiUpdate > 160) {
    app.lastUiUpdate = now;
    app.audio.update(app.engine.focus());
    app.ui.update(hudSource(app));
    updateTraffic(app);
    app.onboarding.tick(); // advance the first-run checklist on real progress (no-op when inactive)
    gameplaySession.notePlaying(); // this session played: it reports session_emergencies
    tickInstallAffordance(app); // surface the install chip once the play-gate trips (self-terminating)
    app.scheduleReview.tick(); // once per loaded tower, mention elevators that run fewer cars than they have (#1548)
    // Keep the open editor's live stats fresh. Refresh now patches only the
    // volatile cells in place (never the buttons or rename input), so this is
    // safe while renaming; the pointer guard still skips the rare full rebuild
    // during an active press.
    if (app.selected && app.ui.isEditorOpen() && !isEditorBusy(app)) {
      // Live stat updates reuse the last engine diagnostic until its inputs change.
      app.refreshEditor(false);
    }
    // A jingle on every star promotion (2★–5★), not just the TOWER win. The
    // analytics side is the engine's star_reached, through the bridge. The
    // header is this frame's.
    const header = app.reader.header;
    if (header.star > app.lastStar) {
      app.lastStar = header.star;
      if (header.star < 6) app.audio.sfx("promote");
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
    const splashUp = isSplashUp();
    // Interactive emergency choice (fire rescue / bomb ransom).
    const pc = header.pendingChoice;
    if (pc && !hasBlockingModal(app) && !splashUp) {
      app.shownChoice = true;
      app.audio.sfx("error");
      app.ui.showEventChoice(pc.message, `$${pc.cost.toLocaleString()}`, (opt) => {
        // The player answered (accept/decline). The engine reports the
        // resolution (emergency_resolved, source player) and the bridge sends
        // emergency_choice from it; a timed-out auto-decline carries source
        // timeout and reports nothing. The freeze latch holds until the engine
        // has answered (the port answers at once), so no frame sees the choice still pending and asks again.
        try {
          app.enginePort.answerChoice(opt === "accept");
          // Refresh the header now: the reader fetches the choice text only
          // when the pending flag rises, so a second choice raised before the
          // next update would otherwise show this one's text.
          app.reader.update();
        } finally {
          app.shownChoice = false;
        }
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
    // The congratulations replace the shared dialog, so they wait for a later
    // pass while the emergency choice or the update prompt is up. Opened over
    // either one they would wipe its buttons and strand the freeze latch it
    // owns (`shownChoice` or `shownUpdate`), and time would never move again.
    // Both can be latched by the lines above in this very pass: the win day
    // rolls an emergency, and a loaded TOWER save may carry an open one.
    if (!app.shownWin && !splashUp && !hasBlockingModal(app) && app.enginePort.evaluatedTower()) {
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
  const after = app.reader.header.minutes;
  // A tampered save can seed the clock with non-finite minutes (deserialize
  // passes data.minutes to Clock un-hardened); without this, dayOfKind is NaN,
  // the once-per-day latch never sticks (NaN !== NaN), and the bulletin spams
  // every frame. Same defensive posture as timePacing's finite guards.
  if (!Number.isFinite(after) || !Number.isFinite(minutesBeforeTicks)) return;
  const cal = calendarOf(app.reader.header);
  let tenants: number | undefined;
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
    // Tenant-count floor: silence bulletins in a very small tower (1-star lot
    // with a handful of rooms), so the log does not chatter through the early
    // game. 30 occupied tenants is a modest bar; a mid-star tower clears it.
    // The header's population is the census `totalPopulation()` counts, as
    // of this frame's update.
    if (tenants === undefined) tenants = app.reader.header.population;
    if (tenants < 30) return;
    app.lastMealRushDay[kind] = dayOfKind;
    app.enginePort.logLine(text, app.portCodes.code("logKinds", "info"));
  };
  // Breakfast at 07:00, dinner at 18:00, lunch at 12:00. Order matches the
  // day so a slow-motion frame that crosses two boundaries emits both.
  emit("breakfast", 7, "Breakfast rush! Guests head down for the buffet.", false);
  emit("lunch", 12, "Lunch rush! Midday plays out in slow motion, just like 1994.", true);
  emit("dinner", 18, "Dinner rush! Elevators fill for the evening service.", true);
}
