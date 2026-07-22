/**
 * Boot-fallback scene: the no-WebGL screen, staged for real by stubbing the
 * WebGL contexts before the app's scripts run. Part of the SCENES manifest;
 * concatenated in order by `screenshot-scenes.ts`. Exists because this screen
 * shipped invisible once (the live Firefox report, v1.84.3): flow-content
 * placement sank it below the fold behind the dead canvas, and no test or
 * screenshot ever looked at the failure state. Now the gallery pins it.
 * Keep ERASABLE.
 */
import { type Scene } from "../screenshot-env.ts";

export const BOOT_FALLBACK_SCENES: Scene[] = [
  {
    id: "boot-no-webgl",
    outDir: "features",
    expectBootFallback: true,
    // Runs before any page script: hasWebGL() probes a scratch canvas, gets
    // null for both webgl contexts, and the boot takes the fallback path,
    // exactly like a browser with acceleration off or a driver blocklist.
    initScript: () => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        // `includes`, not a prefix match: the legacy "experimental-webgl"
        // alias must stay stubbed too, so a future hasWebGL() hardening that
        // probes it cannot silently un-stage this failure scene.
        if (typeof type === "string" && type.includes("webgl")) return null;
        return (orig as (this: HTMLCanvasElement, t: string, ...r: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof HTMLCanvasElement.prototype.getContext;
    },
    shots: [
      {
        // The overlay IS the subject: full page so the frame proves it covers
        // the whole viewport (chrome included), not just the stage.
        name: "boot-no-webgl",
        fullPage: true,
        wait: 400,
      },
    ],
  },
];
