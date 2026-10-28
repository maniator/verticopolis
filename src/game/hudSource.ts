import type { GameApp } from "../main";
import type { HudSource } from "../ui/uiStatus";

const sources = new WeakMap<object, HudSource>();

/** What the HUD pump reads from the app: the engine port, the shared reader
 *  and the port's codes, each read from the app on every access so a swapped
 *  engine or reader is never held stale. One source per app. */
export function hudSource(app: Pick<GameApp, "enginePort" | "reader" | "portCodes">): HudSource {
  let s = sources.get(app);
  if (!s) {
    s = {
      get reader() {
        return app.reader;
      },
      get port() {
        return app.enginePort;
      },
      get codes() {
        return app.portCodes;
      },
    };
    sources.set(app, s);
  }
  return s;
}
