import * as ex from "excalibur";
import type { TowerEngine } from "./TowerEngine";
import { skyColor } from "../sprites/sky";
import * as overlayFx from "./towerOverlay";
import { displayLit, drainSceneSync } from "./towerSyncSchedule";

/**
 * The per-frame work that runs before the host's `onUpdate` hook: the
 * decorative clock, the event visuals, the lighting state and the sky. Split
 * from `TowerEngine.tick` to keep that file under the line ceiling; the order
 * of these steps is the frame's contract.
 */
export function beginFrame(engine: TowerEngine, elapsedMs: number): void {
    const c = engine.sim.clock;
    // Advance the decorative animation clock by the frame's elapsed time, but
    // only while the game is running: paused (speed 0) freezes the walkers,
    // train and street just like the simulated crowd and elevators. `elapsedMs`
    // comes from the engine clock, not wall time, so a manually stepped clock
    // (the screenshot generator swaps in Excalibur's TestClock) advances the
    // decorations deterministically; under the standard clock it is the real
    // per-frame delta, so live play is effectively unchanged. The one visible
    // difference from the old performance.now() delta: Excalibur clamps a frame
    // longer than 200ms (a tab switch or stall) to 1ms, so the decorations
    // resume from where they froze instead of jumping ahead. That is a slight
    // improvement, and it never affects a screenshot (the clock is stepped).
    // Freeze the decorative clock when paused OR reduced-motion is on; functional
    // motion (cars, routed crowd) advances from sim state, not this clock.
    const animating = !engine.paused && !engine.reducedMotion;
    if (animating) engine.animClock += elapsedMs / 1000;
    engine.d.anim = engine.animClock;
    overlayFx.syncEventFx(engine, animating);
    engine.d.hour = c.hour;
    engine.d.lit = displayLit(c);
    // Deferred-reconcile drain: before the crane check and the sim advance
    // in onUpdate (re-stack rationale: drainSceneSync's doc).
    drainSceneSync(engine);
    // Garage/waste display fractions (engine.d.parkingUse / recycleFill) are
    // refreshed inside syncScene — the same moment the sprites that read them
    // re-bake — so they're never staler than the sprite, and the flood-fill /
    // scans stay off this per-frame path.
    // The crane repaints while the decorative clock moves (trolley, hook,
    // beacon); the lighting flip (cab window) rides the scene sync instead,
    // so it lands once, aligned with the room repaint (towerSyncSchedule).
    if (engine.craneGfx && animating) engine.craneGfx.flagDirty();
    engine.d.stress = Math.max(0, Math.min(1, engine.sim.congestion() - 1));
    // Read-only queue + car-fill projection for the transport render path.
    // Memoized on the (step, revision) key in the engine, so this per-frame read
    // returns the cached snapshot without re-scanning the crowd, except on the
    // first call after the sim steps or the tower structure changes (for example
    // a paused structural edit), which rebuilds once. The queue render that draws
    // from it is a follow-up story.
    engine.d.elevatorQueue = engine.sim.crowd.queueView(engine.sim.tower);
    engine.engine.backgroundColor = ex.Color.fromHex(skyColor(c.hour));
}
