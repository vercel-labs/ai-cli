/**
 * Manages terminal output with a locking mechanism for modal UI elements.
 *
 * When unlocked, `write()` passes text straight to `process.stdout`.
 * When locked (e.g. during a confirm prompt), `write()` silently drops
 * the text so that status-bar updates, stream chunks, and other transient
 * writes cannot corrupt the cursor position of the modal.
 *
 * The lock holder receives a `write` function that bypasses the gate,
 * plus a `release` function to hand control back.
 */
export class Output {
  private _locked = false;

  /** Whether a modal currently owns the output. */
  get locked(): boolean {
    return this._locked;
  }

  /** Write to stdout. Silently dropped while output is locked. */
  write(text: string): void {
    if (this._locked) return;
    process.stdout.write(text);
  }

  /**
   * Acquire exclusive output.  Returns a handle whose `write` always
   * reaches stdout and whose `release` unlocks the output for everyone.
   * Returns `null` if the output is already locked (prevents re-entrancy).
   */
  lock(): { write: (text: string) => void; release: () => void } | null {
    if (this._locked) return null;
    this._locked = true;
    return {
      write: (text: string) => process.stdout.write(text),
      release: () => {
        this._locked = false;
      },
    };
  }
}
