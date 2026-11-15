/**
 * The first gesture both starts the audio and fires its own cue (a click, a
 * build), but the context only runs once `Tone.start()` settles, so that cue
 * used to be dropped and the very first click was silent (#554). The latch
 * holds the latest cue fired while the unlock is settling and hands it back
 * when it lands. It holds nothing at any other time: a cue dropped by a
 * backgrounded tab must not burst out when the player comes back.
 */
export class FirstCueLatch<T> {
  private open = false;
  private cue: T | null = null;

  /** The unlock started. */
  begin(): void {
    this.open = true;
    this.cue = null;
  }

  /** Keep `cue` while the unlock is settling. */
  hold(cue: T): void {
    if (this.open) this.cue = cue;
  }

  /** The unlock settled (or was torn down): close, handing back the held cue. */
  release(): T | null {
    const cue = this.cue;
    this.open = false;
    this.cue = null;
    return cue;
  }
}
