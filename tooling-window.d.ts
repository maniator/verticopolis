/**
 * The `window.game` handle a dev serve or a `VC_TOOLING=1` build publishes
 * (src/bootstrap.ts): the running GameApp. The e2e specs and the screenshot
 * scenes drive it from `page.evaluate`, so this file types it for them. A
 * production build publishes nothing; these types are for the tooling code
 * that only runs against a build that does.
 */
import type { EngineBootState } from "./src/engineHost/engineBoot";
import type { RustEngineHandle } from "@verticopolis/engine/host/rustEngine";
import type { Engine as ToolingBinding } from "@verticopolis/engine/tooling";
import type { ToolingTower, ToolingTowerClass } from "./src/game/toolingTower";
import type { GameApp } from "./src/main";
import type { OverviewMapWindow } from "./src/ui/overviewMapWindow";

/** The app as a tooling build runs it: its harness tower is always there
 *  (with the constructors that make a detached one, which `sim =` adopts),
 *  and its engine is the tooling binding, with the setters the port leaves out. */
type ToolingGame = Omit<GameApp, "sim" | "enginePort"> & {
  get sim(): ToolingTower & { constructor: ToolingTowerClass };
  set sim(sim: ToolingTower);
  enginePort: GameApp["enginePort"] & ToolingBinding;
};

declare global {
  interface Window {
    game: ToolingGame;
    /** The Rust engine boot published (`publishRustEngine`), on the tooling binding. */
    __vcEngine?: RustEngineHandle & { port: ToolingBinding };
    /** Where boot settled (`publishBootState`). */
    __vcEngineBoot?: EngineBootState;
    /** The open overview MAP window, for the browser perf test (src/game/overviewMapWiring.ts). */
    overviewMap?: OverviewMapWindow;
  }
}
