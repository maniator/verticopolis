import { telemetryHostAllowed } from "./telemetry";
import { sendException } from "./analyticsRelay";
import { getCommonProps } from "./analytics";
import { createEventThrottle } from "./analyticsThrottle";
import { isBrowserExtensionError } from "./analyticsErrorOrigin";
import { MAX_PLAYER_TEXT, knownPlayerText, mentionsJson, playerTextMatcher, scrubJsonEcho, scrubPlayerText, type PlayerTextMatcher } from "./analyticsPlayerText";

/**
 * Cookieless JavaScript error tracking (spec CAP-2 posture, the S5 follow-up
 * feature). Two global listeners, `error` (uncaught throws) and
 * `unhandledrejection` (dropped promise rejections), post a PostHog `$exception`
 * event through the SAME same-origin relay every other event uses, without
 * shipping `posthog-js` and without a cookie, a persistent id, or a consent
 * banner. The report carries only the per-tab session id every event already
 * carries (so a crash correlates with its play session) plus the boot common
 * props (platform, distribution channel, and the coarse returning / tenure /
 * recency / display buckets), never an identifier.
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
 *   nothing fires on localhost, the e2e preview server, or any other host.
 * - Never-throw: every handler is wrapped, and a report cannot itself trigger a
 *   report (a re-entrancy latch), so a bug in here can never loop the error path.
 * - Deduplicated by fingerprint and hard-capped per session, so an error thrown
 *   every frame (the exact shape of a render-loop crash) sends once, not a flood.
 * - Message and stack are length-bounded before they leave the page.
 *
 * Relay-only, off the adapter seam: `$exception` is a PostHog-only event shape,
 * so it is sent straight through `sendException`.
 *
 * Player text (#607): a thrown message can quote a tower, file or facility name,
 * or a bit of a save that a browser's JSON error echoes. Before a report is sent,
 * its type, message, stack, source and fingerprint go through the scrubber in
 * `analyticsPlayerText.ts`, which replaces every piece of player text the game
 * knows about and blanks a JSON error's quoted input. The 500/2000-char bounds
 * cap payload SIZE; the scrubber covers what the text says. The scrub runs only
 * for a report that passed the cap and dedup, so an error repeating every frame
 * costs nothing more than before.
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
/** Hard cap on `$exception` events one PAGE LIFE sends. Not one session: the
 *  throttle is module memory and a reload re-opens it, while the session id lives
 *  in `sessionStorage` and survives, so one `distinct_id` can carry more than this
 *  across page lives. An error loop should report, not flood; distinct errors past
 *  this are dropped too, which is the safe direction (the relay's own per-IP rate
 *  limit is the outer backstop). */
const MAX_ERRORS_PER_PAGE_LIFE = 10;

/** The cap plus the per-fingerprint dedup, so a repeated error sends once. Its
 *  own instance, deliberately not shared with the gameplay `crash` path's
 *  throttle, so a crash loop cannot spend this budget (see
 *  `analyticsThrottle.ts`, where the guard itself now lives). */
const throttle = createEventThrottle(MAX_ERRORS_PER_PAGE_LIFE);
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
 *  rejected non-Error) degrades to a stringified value with no stack. All three
 *  are returned whole: `report` bounds each one ({@link sentField}) after the
 *  player-text scrub, never before it. */
function describe(value: unknown): { type: string; message: string; stack: string } {
  try {
    if (value instanceof Error) {
      // Reading name/message/stack is wrapped because a hostile subclass can
      // throw from those getters; on a throw we fall through to the generic
      // shape, so `report` still counts a cap/dedup slot rather than looping
      // every frame.
      return {
        type: value.name || "Error",
        message: value.message || "",
        stack: typeof value.stack === "string" ? value.stack : "",
      };
    }
  } catch {
    /* an Error whose name/message/stack getter throws: use the generic shape */
  }
  return { type: "UnhandledRejection", message: safeString(value), stack: "" };
}

/**
 * One text field as it is sent: scrubbed, then bounded to `max`. Only the
 * first `max` + {@link MAX_PLAYER_TEXT} characters are read, so a pathological
 * value never makes the scrub expensive, and a name that straddles the `max`
 * cut is still replaced whole. When the value is longer than that window, the
 * window's own end may cut a name, and earlier replacements that shortened the
 * text could pull that piece below `max`; so a cut value also drops as many
 * trailing characters as the longest known name before the bound. `prepare`
 * runs on the window before the scrub (the JSON echo blanking).
 */
function sentField(raw: string, max: number, known: PlayerTextMatcher, prepare?: (window: string) => string): string {
  const head = raw.slice(0, max + MAX_PLAYER_TEXT);
  const scrubbed = scrubPlayerText(prepare ? prepare(head) : head, known);
  if (raw.length <= head.length) return clamp(scrubbed, max);
  const safe = scrubbed.slice(0, Math.max(0, scrubbed.length - known.longest));
  return `${safe.slice(0, max)}...`;
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

/** Per-report options. The defaults reproduce the uncaught-error path exactly;
 *  the crash path (see {@link reportCrashException}) overrides them to mark the
 *  event handled + synthetic, pin a stable fingerprint, and attach crash flags. */
interface ReportOpts {
  /** Was the error caught by the app? Default false (a genuinely uncaught error). */
  handled?: boolean;
  /** Is this a manufactured exception rather than a real thrown one? Default false.
   *  A synthetic report drops the raw stack (it would be the reporter's own stack,
   *  not the incident's). */
  synthetic?: boolean;
  /** Override the computed fingerprint, so a synthetic incident groups by a stable
   *  key rather than a stack it does not have. */
  fingerprint?: string;
  /** Extra top-level props (e.g. the crash flags) merged into the payload. */
  extraProps?: Record<string, unknown>;
}

/**
 * Build and send one `$exception`. Guarded on the host gate, the re-entrancy
 * latch, the per-session cap, and per-fingerprint dedup, in that order, then
 * emits the canonical `$exception_list` plus a bounded raw stack. Never throws.
 */
function report(
  value: unknown,
  extra?: { source?: string; lineno?: number; colno?: number },
  opts: ReportOpts = {},
): void {
  if (reporting) return; // a report is already in flight: do not recurse
  if (!telemetryHostAllowed()) return;
  reporting = true;
  try {
    if (throttle.exhausted) return;
    const { type, message, stack: fullStack } = describe(value);
    const handled = opts.handled ?? false;
    const synthetic = opts.synthetic ?? false;
    // An error thrown by a browser extension's own script (a wallet injector's
    // rejected promise) is not the game's to fix. Drop it before it spends a
    // cap or dedup slot. A synthetic report's stack is the reporter's own, so
    // it is never judged by it.
    if (!synthetic && isBrowserExtensionError(fullStack, extra?.source)) return;
    // A synthetic report has no meaningful stack (it would be the reporter's own),
    // so drop it and rely on the explicit fingerprint below.
    const stack = synthetic ? "" : fullStack;
    // Fingerprint on type + message + the first stack line, so the same crash
    // (repeated every frame) collapses to one report while two different errors
    // stay distinct. The first stack line pins the throw site. Each PART is
    // bounded separately (not the joined whole) so the throw-site frame always
    // survives: clamping the join could cut the frame off for a long message and
    // merge two genuinely distinct crashes that share that message. A synthetic
    // incident overrides this with a stable key (it has no throw site to pin).
    //
    // Dedup and the cap key on the RAW parts, which stay in this module's memory
    // and are never sent, so a repeat is dropped before any scrubbing. Only a
    // report that will go out pays for the scrub, and the fingerprint it sends is
    // rebuilt from the scrubbed parts.
    const key = (t: string, m: string, f: string) => `${clamp(t, MAX_TYPE_LEN)}|${clamp(m, 180)}|${clamp(f, 100)}`;
    const firstFrame = fullStack.split("\n", 2)[1]?.trim() ?? "";
    if (!throttle.allow(opts.fingerprint ?? key(type, message, firstFrame))) return;

    // Replace every piece of player text the game knows about in every field
    // that carries text. A JSON error's echoed input is blanked first, in the
    // message and where V8's stack repeats the message on its first line.
    const known = playerTextMatcher(knownPlayerText());
    const messageHead = message.slice(0, MAX_MESSAGE_LEN + MAX_PLAYER_TEXT);
    const aboutJson = mentionsJson(messageHead);
    const jsonMessage = aboutJson ? scrubJsonEcho(messageHead) : messageHead;
    const sentType = sentField(type, MAX_TYPE_LEN, known);
    const sentMessage = sentField(message, MAX_MESSAGE_LEN, known, aboutJson ? scrubJsonEcho : undefined);
    const echo = aboutJson && messageHead ? (head: string) => head.split(messageHead).join(jsonMessage) : undefined;
    const sentStack = sentField(stack, MAX_STACK_LEN, known, echo);
    const fingerprint = opts.fingerprint ?? key(sentType, sentMessage, scrubPlayerText(synthetic ? "" : firstFrame, known));

    const properties: Record<string, unknown> = {
      ...getCommonProps(), // version / platform / distribution_channel / returning / tenure / recency / display
      // Canonical PostHog Error Tracking shape. Frames are left empty in this
      // first version (no source maps); the raw stack below carries the trace.
      $exception_list: [
        {
          type: sentType,
          value: sentMessage,
          mechanism: { handled, synthetic },
          stacktrace: { type: "raw", frames: [] },
        },
      ],
      // Also a top-level copy so a dashboard trend can break errors down by type
      // without reaching into the nested `$exception_list`.
      $exception_type: sentType,
      $exception_fingerprint: fingerprint,
      $exception_stack_trace_raw: sentStack,
      handled,
      ...opts.extraProps,
    };
    // Location from the ErrorEvent, when the browser supplied it. Omitted for a
    // rejection (no location) and for a cross-origin "Script error." with none.
    if (extra?.source) properties.source = sentField(extra.source, MAX_MESSAGE_LEN, known);
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
      // The Error is made here, so its stack is this listener's own frame, not
      // where the error happened. Sending it pointed every cross-origin
      // "Script error." at the game's bundle and put the listener's minified,
      // per-build name in the V8 fingerprint. A message-only error has no stack.
      const fromMessage = new Error(event.message);
      fromMessage.stack = "";
      report(fromMessage, { source: event.filename, lineno: event.lineno, colno: event.colno });
    }
    // else: a resource-load error with no script detail; not a JS exception.
  } catch {
    /* never-throw */
  }
}

/** A PascalCase exception type for a crash kind (`"webgl-context-lost"` becomes
 *  `"WebGLContextLost"`). WebGL is special-cased for the right capitalization;
 *  any other kind title-cases its hyphen segments. */
function crashType(kind: string): string {
  if (kind === "webgl-context-lost") return "WebGLContextLost";
  const joined = kind
    .split("-")
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  return joined || "Crash";
}

/** The flattened crash description this reporter reads (a subset of the typed
 *  `crash` event; the analytics event carries the rest). */
export interface CrashExceptionInfo {
  kind: string;
  repeat?: boolean;
  recoveryFailed?: boolean;
  saveFlushed?: boolean;
  behindSplash?: boolean;
}

/**
 * Report a game crash (today only a lost WebGL context) into PostHog Error
 * Tracking as a SYNTHETIC `$exception`, so the crash that matters most (the
 * #538 GPU death) shows up as a grouped issue alongside the uncaught JS errors.
 * This is ADDITIVE: the typed `crash` analytics event still fires from the same
 * call site and keeps the structured fields; the `$exception` is the Error
 * Tracking lens on the same incident, not a second count of a different thing.
 *
 * It routes through the same {@link report} machinery (host gate, re-entrancy
 * latch, per-session cap, dedup, common props, never-throw) as the uncaught
 * path, marked `handled` + `synthetic` with a stable fingerprint so every WebGL
 * loss groups into one issue. The crash flags ride along as top-level context.
 */
export function reportCrashException(info: CrashExceptionInfo): void {
  try {
    const kind = String(info?.kind ?? "");
    const type = crashType(kind);
    const notes: string[] = [];
    if (info?.recoveryFailed) notes.push("recovery failed");
    if (info?.repeat) notes.push("repeat within 90s");
    if (info?.behindSplash) notes.push("at boot");
    const value = notes.length ? `WebGL context lost (${notes.join(", ")})` : "WebGL context lost";
    // A plain Error carries the message and type cleanly through `describe`; its
    // stack is the reporter's own and is dropped by the synthetic flag.
    const synthetic = new Error(value);
    synthetic.name = type;
    report(synthetic, undefined, {
      handled: true, // the game catches the context loss and shows the crash screen
      synthetic: true,
      fingerprint: type, // one Error Tracking issue for all WebGL losses
      extraProps: {
        crash_kind: kind,
        repeat: !!info?.repeat,
        recoveryFailed: !!info?.recoveryFailed,
        saveFlushed: !!info?.saveFlushed,
        behindSplash: !!info?.behindSplash,
      },
    });
  } catch {
    /* never-throw: crash reporting must never break crash recovery */
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
  throttle.reset();
  reporting = false;
  installed = false;
}
