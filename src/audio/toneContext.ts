import * as Tone from "tone";

/**
 * Point Tone at the one audio context the game plays through. Call it before
 * any node is built.
 *
 * The context asks for large buffers over low latency: this is a sim, not an
 * instrument, and the default interactive hint underruns on phones (heard as
 * random crackles).
 *
 * Importing Tone already opened a default low-latency context, which nothing
 * plays through, so it is closed. While it stayed open, an operating system
 * that sets one buffer size per output device (macOS does) ran the device at
 * the small size it asked for, and the playback context then had to render
 * its large buffers inside those short deadlines.
 */
export function usePlaybackContext(): void {
  try {
    const unused = Tone.getContext();
    Tone.setContext(new Tone.Context({ latencyHint: "playback" }));
    closeContext(unused);
  } catch {
    /* keep the default context */
  }
}

/** Close a context nothing plays through. Its close is caught apart so a
 *  rejection is swallowed rather than reported as unhandled; dispose then
 *  stops its clock. A failure here leaves the swap already made in place. */
function closeContext(ctx: Tone.BaseContext): void {
  try {
    if (ctx instanceof Tone.Context) void ctx.close().catch(() => {});
    ctx.dispose();
  } catch {
    /* already closed */
  }
}

/**
 * Puts the playback context to sleep once a fade has played, and wakes it.
 * While it sleeps the audio clock stops: the music holds its place, no note is
 * built and nothing renders, so a page the player left costs no audio work.
 */
export class ContextSleep {
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** Suspend the context after `fadeMs`, the fade that leads into it. */
  sleepAfter(fadeMs: number): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        // The game's context is always a live (online) one, whose suspend
        // takes no time argument.
        void (Tone.getContext().rawContext as AudioContext).suspend().catch(() => {});
      } catch {
        /* the context is already gone */
      }
    }, fadeMs);
  }

  /** Cancel a pending sleep and start the clock again. Resuming can reject
   *  (no gesture yet), so it is caught; the next gesture retries it. */
  wake(): void {
    this.cancel();
    Tone.getContext().resume().catch(() => {});
  }

  /** Drop a pending sleep without waking. */
  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
