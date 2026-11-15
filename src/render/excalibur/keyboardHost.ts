/**
 * The object Excalibur's keyboard listens on, instead of `window` (#322).
 *
 * The game reads keys with its own handlers (`src/game/inputKeys.ts`) and
 * never asks Excalibur's `Keyboard` anything. Excalibur still attaches a
 * `keydown`, a `keyup` and a `blur` listener to its `global` for the engine and
 * again for each scene, and `Engine.dispose()` only switches them off. The
 * `blur` one is an anonymous arrow, so nothing outside Excalibur can detach
 * it. On `window`, each in-place context-loss recovery (a new engine) leaves
 * those listeners behind, and each one keeps its dead `Keyboard` alive.
 * Handing the engine this private target keeps them off `window`, so they go
 * away with the engine. `focus` still focuses the window, as Excalibur's
 * `grabWindowFocus` did with the default global.
 */
export function keyboardHost(): GlobalEventHandlers {
  const host = new EventTarget() as EventTarget & { focus(): void };
  host.focus = () => window.focus();
  return host as unknown as GlobalEventHandlers;
}
