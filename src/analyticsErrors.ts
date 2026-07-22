import { telemetryHostAllowed } from "./telemetry";
import { sendException } from "./analyticsRelay";
import { getCommonProps } from "./analytics";

/**
 * Cookieless JavaScript error tracking (spec CAP-2 posture, the S5 follow-up
 * feature). Two global listeners, `error` (uncaught throws) and
 * `unhandledrejection` (dropped promise rejections), post a PostHog `$exception`
 * event through the SAME same-origin relay every other event uses, without
 * shipping `posthog-js` and without a cookie, a persistent id, or a consent
 * banner. The report carries only the per-tab session id every event already
 * carries (so a crash correlates with its play session) plus the boot common
 * props (platform / build version), never an identifier.
 *
 * What this captures, and what it does NOT: only GENUINELY uncaught errors that
 * reach `window`, which the game today has no visibility into: a throw during
 * boot, in an event handler, or in an async callback, and an unhandled promise
 * rejection. It does NOT see two crash classes that never become uncaught window
 * errors, and that is deliberate, not a gap: a throw inside the render frame loop
 * is swallowed by the frame-error guard (`engineWiring.ts`) and never escapes to
 * `window`; and a WebGL context loss (the Pixel 8a / #538 failure) is not a throw
 * at all, it is handled and already reported by the typed `crash` gameplay event.
 * So `$exception` complements `crash`, it does not duplicate it: the two paths are
 * disjoint.
 *
 * Guardrails, because this runs on the error path:
 * - Host-gated by `telemetryHostAllowed`, exactly like the gameplay events, so
 *   nothing fires on localhost, the e2e preview server, or the native shell.
 * - Never-throw: every handler is wrapped, and a report cannot itself trigger a
 *   report (a re-entrancy latch), so a bug in here can never loop the error path.
 * - Deduplicated by fingerprint and hard-capped per session, so an error thrown
 *   every frame (the exact shape of a render-loop crash) sends once, not a flood.
 * - Message and stack are length-bounded before they leave the page.
 *
 * Relay-only (not the dual-write adapter): `$exception` is a PostHog-only event
 * shape with no Vercel Web Analytics equivalent, so it is sent straight through
 * `sendException`, never to Vercel.
 *
 * Privacy note: an exception `value` is the thrown message, which the game builds
 * from its own strings and could occasionally interpolate a player-authored tower
 * name. The 500/2000-char bounds cap payload SIZE, not sensitivity: a tower name
 * within the bound is forwarded verbatim. It stays acceptable because there is no
 * IP (the relay disables GeoIP and forwards none), no persistent id, and no
 * cross-session linkage, so a leaked free-text string is not bound to any stable
 * identity and does not de-anonymize. Redacting known player-authored fields from
 * the outgoing message is a tracked follow-up (backlog), alongside the frame
 * parsing below.
 * Structured stack FRAMES are deliberately not parsed in this first version: with
 * no source maps uploaded they would point at minified positions, so the bounded
 * raw stack string carries the same debugging value at far less code. Frame
 * parsing plus source maps is the natural follow-up.
 */

/** Longest exception type kept (characters). `error.name` is normally a short
 *  identifier, but it is the one field an adversarial Error subclass could bloat,
 *  so it is bounded like every other field to keep the body under the relay cap. */
const MAX_TYPE_LEN = 100;
/** Longest exception message kept (characters). Generous for a real message,
 *  short enough that a pathological one cannot bloat the payload. */
const MAX_MESSAGE_LEN = 500;
/** Longest raw stack string kept (characters). Fits well inside the relay's 8 KB
 *  body cap alongside the rest of the payload. */
const MAX_STACK_LEN = 2_000;
/** Hard cap on `$exception` events one page (session) sends. A crash loop should
 *  report, not flood; distinct errors past this are dropped too, which is the
 *  safe direction (the relay's own per-IP rate limit is the outer backstop). */
const MAX_ERRORS_PER_SESSION = 10;

/** Fingerprints already reported this page, so a repeated error sends once. */
const seen = new Set<string>();
let reported = 0;
/** Re-entrancy latch: a throw while building or sending a report must not
 *  recurse into the `error` handler and spiral. */
let reporting = false;
let installed = false;

/** Clamp a value to a maximum length, appending an ellipsis marker when cut. */
function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** Normalize an arbitrary thrown value into `{ type, message, stack }`. A real
 *  `Error` gives its name, message, and stack; anything else (a string, a
 *  rejected non-Error) degrades to a stringified value with no stack. */
function describe(value: unknown): { type: string; message: string; stack: string } {
  try {
    if (value instanceof Error) {
      return {
        // `type` is clamped like every other field: `error.name` is the one lever
        // an adversarial Error could use to push the body past the relay's size
        // cap. Reading name/message/stack is wrapped because a hostile subclass can
        // throw from those getters; on a throw we fall through to the generic shape,
        // so `report` still counts a cap/dedup slot rather than looping every frame.
        type: clamp(value.name || "Error", MAX_TYPE_LEN),
        message: clamp(value.message || "", MAX_MESSAGE_LEN),
        stack: clamp(typeof value.stack === "string" ? value.stack : "", MAX_STACK_LEN),
      };
    }
  } catch {
    /* an Error whose name/message/stack getter throws: use the generic shape */
  }
  return { type: "UnhandledRejection", message: clamp(safeString(value), MAX_MESSAGE_LEN), stack: "" };
}

/** Stringify an arbitrary rejection reason without ever throwing (a value with a
 *  throwing `toString`, a circular object). */
function safeString(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    return String(value);
  } catch {
    return "(unstringifiable rejection)";
  }
}

/**
 * Build and send one `$exception`. Guarded on the host gate, the re-entrancy
 * latch, the per-session cap, and per-fingerprint dedup, in that order, then
 * emits the canonical `$exception_list` plus a bounded raw stack. Never throws.
 */
function report(value: unknown, extra?: { source?: string; lineno?: number; colno?: number }): void {
  if (reporting) return; // a report is already in flight: do not recurse
  if (!telemetryHostAllowed()) return;
  reporting = true;
  try {
    if (reported >= MAX_ERRORS_PER_SESSION) return;
    const { type, message, stack } = describe(value);
    // Fingerprint on type + message + the first stack line, so the same crash
    // (repeated every frame) collapses to one report while two different errors
    // stay distinct. The first stack line pins the throw site. Each PART is
    // bounded separately (not the joined whole) so the throw-site frame always
    // survives: clamping the join could cut the frame off for a long message and
    // merge two genuinely distinct crashes that share that message.
    const firstFrame = stack.split("\n", 2)[1]?.trim() ?? "";
    const fingerprint = `${type}|${clamp(message, 180)}|${clamp(firstFrame, 100)}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    reported++;

    const properties: Record<string, unknown> = {
      ...getCommonProps(), // platform / build version / returning buckets
      // Canonical PostHog Error Tracking shape. Frames are left empty in this
      // first version (no source maps); the raw stack below carries the trace.
      $exception_list: [
        {
          type,
          value: message,
          mechanism: { handled: false, synthetic: false },
          stacktrace: { type: "raw", frames: [] },
        },
      ],
      $exception_fingerprint: fingerprint,
      $exception_stack_trace_raw: stack,
      handled: false,
    };
    // Location from the ErrorEvent, when the browser supplied it. Omitted for a
    // rejection (no location) and for a cross-origin "Script error." with none.
    if (extra?.source) properties.source = clamp(extra.source, MAX_MESSAGE_LEN);
    if (Number.isFinite(extra?.lineno)) properties.lineno = extra?.lineno;
    if (Number.isFinite(extra?.colno)) properties.colno = extra?.colno;

    sendException(properties);
  } catch {
    /* the error path must never throw; a failed report is simply dropped */
  } finally {
    reporting = false;
  }
}

/** `error` handler. Prefers the real `Error` object (full stack); falls back to
 *  the event message for a cross-origin script error that carries no `error`. A
 *  resource-load failure (an `<img>`/`<script>` 404) is an `error` event whose
 *  target is an element and which carries no `error`/`message`; skip it, since it
 *  is not a JavaScript exception. */
function onError(event: ErrorEvent): void {
  try {
    if (event.error != null) {
      report(event.error, { source: event.filename, lineno: event.lineno, colno: event.colno });
      return;
    }
    if (typeof event.message === "string" && event.message.length > 0) {
      report(new Error(event.message), { source: event.filename, lineno: event.lineno, colno: event.colno });
    }
    // else: a resource-load error with no script detail; not a JS exception.
  } catch {
    /* never-throw */
  }
}

/** `unhandledrejection` handler. The reason is whatever the promise rejected
 *  with, an `Error` or any other value. */
function onRejection(event: PromiseRejectionEvent): void {
  try {
    report(event.reason);
  } catch {
    /* never-throw */
  }
}

/**
 * Install the global error listeners once. Idempotent, and a no-op without a
 * `window` (a server-side or worker context). Cheap enough to call before the
 * host gate is known: the gate is re-checked per report, so nothing is sent on a
 * dark host, only two passive listeners are registered. Called as early in the
 * boot body as possible so a throw during the REST of boot is captured; a throw
 * during module evaluation itself (before this line runs) fires before any
 * listener exists and is inherently out of reach.
 */
export function installErrorTracking(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
}

/** Test-only reset of the module's per-session latches and listeners, so each
 *  test starts from a clean cap/dedup state and no leaked handlers, without a
 *  fresh module import. The handler refs are stable, so `removeEventListener`
 *  detaches exactly what `installErrorTracking` attached. */
export function resetErrorTrackingForTest(): void {
  if (typeof window !== "undefined") {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  }
  seen.clear();
  reported = 0;
  reporting = false;
  installed = false;
}
