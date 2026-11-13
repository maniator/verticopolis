/**
 * A recording stand-in for Tone.js, shared by the tests that run the audio
 * engine's real control flow without an AudioContext (toneAudioEngineGraph and
 * audioFetches). Every Tone class becomes a chainable stub that records what
 * it was built with and where it connected.
 */

/** What the recording mock captures per node: its Tone class, constructor
 *  args, where it connected, whether start() ran, and every trigger call.
 *  Regression tests assert graph SHAPE from this (a no-throw suite would pass
 *  with the whole feature deleted). */
export type NodeRec = {
  kind: string;
  args: unknown[];
  connects: NodeRec[];
  started: boolean;
  disposed: boolean;
  triggers: unknown[][];
  ramps: unknown[][];
};

/** The nodes built since the last reset, and the per-beat callback the mocked
 *  Transport hands back. Tests clear them in beforeEach. */
export const beat: { step: null | ((t: number) => void) } = { step: null };
export const graph: { nodes: NodeRec[] } = { nodes: [] };
/** Every Tone.setContext call, in order: the context passed and whether the
 *  previous one was disposed. Cleared by {@link resetToneFaults}. */
export const contextSwaps: Array<{ context: unknown; disposeOld: boolean }> = [];

/** Ways a test can make the mocked Tone misbehave the way the real one can:
 *  the state every audio context reports, and an error every note trigger
 *  throws (real Tone throws from a mono voice restarted at its own start
 *  time). Tests that turn a knob reset it with {@link resetToneFaults}. */
export const toneFaults: { contextState: string; triggerError: Error | null } = {
  contextState: "running",
  triggerError: null,
};
export function resetToneFaults(): void {
  toneFaults.contextState = "running";
  toneFaults.triggerError = null;
  contextSwaps.length = 0;
}

/** A self-returning chainable stub for a Tone node: any property access or
 *  call yields the same proxy, so `n.connect(x).connect(y)`, `n.gain.rampTo(…)`,
 *  `n.volume.value = …` all no-op safely, while `connect`, `start` and
 *  `triggerAttackRelease` additionally record onto the node's registry entry
 *  (sub-property accesses like `.gain` yield the same proxy, so an edge into a
 *  node's param records as an edge into that node). */
// The proxy is deliberately untyped: it stands in for every Tone class.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function node(kind = "anon", args: unknown[] = []): unknown {
  const rec: NodeRec = { kind, args, connects: [], started: false, disposed: false, triggers: [], ramps: [] };
  graph.nodes.push(rec);
  const p: any = new Proxy(function () {} as unknown as object, {
    get: (_t, prop) => {
      if (prop === Symbol.toPrimitive) return () => 0; // numeric coercion (Tone.now())
      if (prop === "then") return undefined; // never a thenable
      if (prop === "__rec") return rec;
      if (prop === "state" && kind === "Context") return toneFaults.contextState;
      if (prop === "connect")
        return (target: any) => {
          if (target?.__rec) rec.connects.push(target.__rec);
          return p;
        };
      if (prop === "start")
        return () => {
          rec.started = true;
          return p;
        };
      if (prop === "triggerAttackRelease")
        return (...a: unknown[]) => {
          if (toneFaults.triggerError) throw toneFaults.triggerError;
          rec.triggers.push(a);
          return p;
        };
      if (prop === "rampTo")
        return (...a: unknown[]) => {
          rec.ramps.push(a);
          return p;
        };
      if (prop === "dispose")
        return () => {
          rec.disposed = true;
          return p;
        };
      return p;
    },
    apply: () => p,
    set: () => true,
  });
  return p;
}


/** The module object for `vi.mock("tone", async () => (await import("./toneRecordingMock")).toneMock())`. */
export function toneMock() {
  // Regular functions (not arrows) so `new Tone.Gain(...)` works; each returns a
  // node, which `new` then yields as the instance.
  const ctorFor = (kind: string) =>
    function (...args: unknown[]) {
      return node(kind, args);
    };
  return {
    Gain: ctorFor("Gain"),
    Filter: ctorFor("Filter"),
    PolySynth: ctorFor("PolySynth"),
    Synth: ctorFor("Synth"),
    Noise: ctorFor("Noise"),
    Reverb: ctorFor("Reverb"),
    NoiseSynth: ctorFor("NoiseSynth"),
    MembraneSynth: ctorFor("MembraneSynth"),
    Part: ctorFor("Part"),
    LFO: ctorFor("LFO"),
    ToneAudioBuffer: ctorFor("ToneAudioBuffer"),
    ToneBufferSource: ctorFor("ToneBufferSource"),
    Oscillator: ctorFor("Oscillator"),
    Context: ctorFor("Context"),
    setContext: (context: unknown, disposeOld = false) => {
      contextSwaps.push({ context, disposeOld });
    },
    getTransport: () => ({
      bpm: node(), // chainable: supports both `bpm.value = …` and `bpm.rampTo(…)`
      scheduleRepeat: (cb: (t: number) => void) => ((beat.step = cb), 1),
      start: () => {},
      clear: () => {},
      stop: () => {},
    }),
    getContext: () => node("Context"),
    start: () => Promise.resolve(),
    now: () => 0,
  };
}

/** The module object for `vi.mock("./lightSynth", async () => (await import("./toneRecordingMock")).lightSynthMock())`:
 *  the light voices record like any other node, under their own class names,
 *  so a graph test sees every voice, what it was built with, where it
 *  connects and every note it plays. */
export function lightSynthMock() {
  const ctorFor = (kind: string) =>
    function (...args: unknown[]) {
      return node(kind, args);
    };
  return {
    LightPolySynth: ctorFor("LightPolySynth"),
    LightMonoSynth: ctorFor("LightMonoSynth"),
    LightMembraneSynth: ctorFor("LightMembraneSynth"),
  };
}
